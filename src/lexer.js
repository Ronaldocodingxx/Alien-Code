// Source text -> tokens.
// Token: { t: "num"|"str"|"id"|"kw"|"op"|"nl"|"eof", v, line, col, pos, end }
// Newlines are statement separators, except directly inside ( ) or [ ].

import { AlienError } from "./errors.js";

export const KEYWORDS = new Set([
  "fn", "ret", "if", "else", "for", "in", "while", "break", "continue", "match",
  "try", "catch", "throw", "use", "as", "pub", "test", "new", "await", "true", "false", "nil",
]);

// longest first
const OPS = [
  "...", "..=", "|>", "?.", "??", "**", "//", "==", "!=", "<=", ">=", "&&", "||", ":=",
  "+=", "-=", "*=", "/=", "=>", "..", "+", "-", "*", "/", "%", "<", ">", "!", "=", ".",
  ",", ":", "(", ")", "[", "]", "{", "}", "|", ";",
];

const ESC = { n: "\n", t: "\t", r: "\r", "0": "\0", "\\": "\\", '"': '"', "{": "{", "}": "}" };

const isDigit = (c) => c >= "0" && c <= "9";
const isIdStart = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isId = (c) => isIdStart(c) || isDigit(c);

export function lex(src, file = "<input>", base = { line: 1, col: 1, pos: 0 }) {
  const toks = [];
  const stack = [];
  let i = 0, line = base.line, col = base.col;

  const err = (code, msg, l = line, c = col, hint) => new AlienError(code, msg, file, l, c, hint);
  const adv = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === "\n") { line++; col = 1; } else col++;
      i++;
    }
  };
  const push = (t, v, l, c, s) => toks.push({ t, v, line: l, col: c, pos: s + base.pos, end: i + base.pos });
  const pushNL = (l, c, s) => {
    if (toks.length && toks[toks.length - 1].t !== "nl") push("nl", "\n", l, c, s);
  };

  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r") { adv(); continue; }
    if (c === "#") { while (i < src.length && src[i] !== "\n") adv(); continue; }
    const l = line, cl = col, s = i;

    if (c === "\n") {
      adv();
      const top = stack[stack.length - 1];
      if (top !== "(" && top !== "[") pushNL(l, cl, s);
      continue;
    }

    // ".5" is a number unless it follows a value (then "." is member access, which never takes digits)
    const prev = toks[toks.length - 1];
    const afterValue = prev && (prev.t === "id" || prev.t === "num" || prev.t === "str" || (prev.t === "op" && (prev.v === ")" || prev.v === "]" || prev.v === "}")));
    if (c === "." && isDigit(src[i + 1] ?? "") && src[i - 1] !== "." && !afterValue) {
      adv();
      while (i < src.length && (isDigit(src[i]) || src[i] === "_")) adv();
      push("num", `0${src.slice(s, i).replace(/_/g, "")}`, l, cl, s);
      continue;
    }

    if (isDigit(c)) {
      let raw;
      if (c === "0" && (src[i + 1] === "x" || src[i + 1] === "b" || src[i + 1] === "o")) {
        adv(2);
        while (i < src.length && /[0-9a-fA-F_]/.test(src[i])) adv();
        raw = src.slice(s, i);
      } else {
        while (i < src.length && (isDigit(src[i]) || src[i] === "_")) adv();
        if (src[i] === "." && isDigit(src[i + 1] ?? "")) {
          adv();
          while (i < src.length && (isDigit(src[i]) || src[i] === "_")) adv();
        }
        if ((src[i] === "e" || src[i] === "E") && (isDigit(src[i + 1] ?? "") || ((src[i + 1] === "-" || src[i + 1] === "+") && isDigit(src[i + 2] ?? "")))) {
          adv(2);
          while (i < src.length && isDigit(src[i])) adv();
        }
        raw = src.slice(s, i);
      }
      if (isIdStart(src[i] ?? "")) throw err("E001", `invalid number literal '${raw}${src[i]}'`, l, cl);
      push("num", raw.replace(/_/g, ""), l, cl, s);
      continue;
    }

    if (isIdStart(c)) {
      while (i < src.length && isId(src[i])) adv();
      const w = src.slice(s, i);
      push(KEYWORDS.has(w) ? "kw" : "id", w, l, cl, s);
      continue;
    }

    if (c === '"') {
      adv();
      const parts = [];
      let buf = "";
      for (;;) {
        if (i >= src.length) throw err("E002", "unterminated string", l, cl, "close the string with \"");
        const ch = src[i];
        if (ch === '"') { adv(); break; }
        if (ch === "\\") {
          const n = src[i + 1];
          if (n === "u" && src[i + 2] === "{") {
            const close = src.indexOf("}", i);
            if (close < 0) throw err("E002", "bad unicode escape");
            buf += String.fromCodePoint(parseInt(src.slice(i + 3, close), 16));
            adv(close - i + 1);
            continue;
          }
          if (!(n in ESC)) throw err("E002", `unknown escape '\\${n}'`, line, col, "valid escapes: \\n \\t \\r \\0 \\\\ \\\" \\{ \\} \\u{hex}");
          buf += ESC[n];
          adv(2);
          continue;
        }
        if (ch === "{") {
          adv();
          const el = line, ec = col, start = i;
          let depth = 1;
          while (i < src.length) {
            if (src[i] === '"') {
              adv();
              while (i < src.length && src[i] !== '"') { if (src[i] === "\\") adv(); adv(); }
              adv();
              continue;
            }
            if (src[i] === "{") depth++;
            else if (src[i] === "}" && --depth === 0) break;
            adv();
          }
          if (i >= src.length) throw err("E002", "unterminated interpolation in string", el, ec, "close it with } or write \\{ for a literal brace");
          if (buf) { parts.push(buf); buf = ""; }
          parts.push({ src: src.slice(start, i), line: el, col: ec, pos: start + base.pos });
          adv();
          continue;
        }
        buf += ch;
        adv();
      }
      if (buf || !parts.length) parts.push(buf);
      push("str", parts, l, cl, s);
      continue;
    }

    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw err("E001", `unexpected character '${c}'`, l, cl);
    adv(op.length);
    if (op === ";") { pushNL(l, cl, s); continue; }
    if (op === "(" || op === "[" || op === "{") stack.push(op);
    else if (op === ")" || op === "]" || op === "}") stack.pop();
    push("op", op, l, cl, s);
  }
  push("eof", null, line, col, i);
  return toks;
}
