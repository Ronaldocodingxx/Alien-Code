// Code map for agents: split a file into its top-level parts (functions, values, tests, statements)
// so an agent can read the index, fetch only the parts it needs and replace one part by name.
//   mapSource(src, file) -> { file, lines, parts: [{name, kind, from, to, sig, doc, tok, uses, usedBy}] }
//   replacePart(src, file, name, code) -> new source (throws AlienError if `name` is unknown)
// `from` includes the part's leading # comment lines; ranges are 1-based and inclusive.

import { parse } from "./parser.js";
import { AlienError } from "./errors.js";

const tokEstimate = (s) => Math.ceil(s.length / 3.5);

function idsIn(n, out = new Set()) {
  if (!n || typeof n !== "object") return out;
  if (Array.isArray(n)) { for (const x of n) idsIn(x, out); return out; }
  if (n.k === "Id") out.add(n.name);
  for (const key in n) if (n[key] && typeof n[key] === "object") idsIn(n[key], out);
  return out;
}

// names bound inside a node (params, locals, loop and match variables) — they shadow top-level parts
function boundIn(n, out = new Set()) {
  if (!n || typeof n !== "object") return out;
  if (Array.isArray(n)) { for (const x of n) boundIn(x, out); return out; }
  if (n.k === "PId") out.add(n.name);
  if (n.k === "PArr" && n.rest) out.add(n.rest);
  if (n.k === "FnDecl") out.add(n.name);
  if (n.k === "Try" && n.param) out.add(n.param);
  for (const key in n) if (n[key] && typeof n[key] === "object") boundIn(n[key], out);
  return out;
}

function stmtName(s) {
  const e = s.k === "ExprStmt" ? s.expr : s.k === "Assign" ? s.target : null;
  let c = e?.k === "Call" ? e.callee : e;
  const path = [];
  while (c?.k === "Member") { path.unshift(c.name); c = c.obj; }
  if (c?.k === "Id") path.unshift(c.name);
  if (!path.length) return null;
  return path.join(".") + (e?.k === "Call" ? "()" : s.k === "Assign" ? "=" : "");
}

function patternNames(p) {
  switch (p.k) {
    case "PId": return [p.name];
    case "PArr": return [...p.items.flatMap(patternNames), ...(p.rest && p.rest !== "_" ? [p.rest] : [])];
    case "PObj": return p.props.flatMap((x) => patternNames(x.pat));
  }
  return [];
}

function partName(s) {
  switch (s.k) {
    case "FnDecl": return { name: s.name, kind: "fn", declares: [s.name] };
    case "Let": {
      const names = patternNames(s.target);
      return { name: names.join(",") || `line:${s.line}`, kind: "val", declares: names };
    }
    case "Use": return { name: s.path, kind: "use", declares: s.alias ? [s.alias] : s.names.map((x) => x.as) };
    case "Test": return { name: `test:${s.name}`, kind: "test", declares: [] };
    default: return { name: stmtName(s) ?? `line:${s.line}`, kind: "stmt", declares: [] };
  }
}

export function mapSource(src, file) {
  const prog = parse(src, file);
  const lines = src.split("\n");
  const lineOf = (pos) => src.slice(0, pos).split("\n").length;
  const parts = [];
  const seen = new Map();
  let prevEnd = 0;
  for (const s of prog.body) {
    let { name, kind, declares } = partName(s);
    // unnamed statements: keep names unique and stable (serve(), serve()#2)
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    if (n > 1) name = `${name}#${n}`;
    let from = s.line;
    const to = lineOf(s.end);
    // attach directly preceding comment lines (no blank line between) as documentation
    while (from - 1 > prevEnd && /^\s*#/.test(lines[from - 2])) from--;
    const doc = lines.slice(from - 1, s.line - 1).map((l) => l.replace(/^\s*#\s?/, "")).join(" ").trim();
    const text = lines.slice(from - 1, to).join("\n");
    const own = new Set(declares);
    const bound = [...boundIn(s)].filter((x) => !own.has(x));
    const ids = new Set([...idsIn(s)].filter((x) => !bound.includes(x)));
    parts.push({ name, kind, from, to, sig: lines[s.line - 1].trim().slice(0, 90), doc, tok: tokEstimate(text), declares, ids });
    prevEnd = to;
  }
  const owner = new Map();
  for (const p of parts) if (p.kind !== "use") for (const d of p.declares) owner.set(d, p.name);
  for (const p of parts) {
    p.uses = [...new Set([...p.ids].filter((i) => owner.has(i) && owner.get(i) !== p.name).map((i) => owner.get(i)))];
    delete p.ids;
  }
  for (const p of parts) p.usedBy = parts.filter((q) => q.uses.includes(p.name)).map((q) => q.name);
  for (const p of parts) delete p.declares;
  return { file, lines: lines.length, tok: tokEstimate(src), parts };
}

export function findPart(map, name) {
  return map.parts.find((p) => p.name === name || (/^\d+$/.test(name) && p.from <= +name && +name <= p.to));
}

export function replacePart(src, file, name, code) {
  const map = mapSource(src, file);
  const p = findPart(map, name);
  const lines = src.split("\n");
  const body = code.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  if (!p) {
    if (/^(line:|test:)|^\d+$/.test(name)) throw new AlienError("E060", `no part named '${name}' in ${file}`, file, 1, 1, "run alien map to list part names");
    // unknown name: append as a new part
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return [...lines, "", ...body, ""].join("\n");
  }
  return [...lines.slice(0, p.from - 1), ...body, ...lines.slice(p.to)].join("\n");
}
