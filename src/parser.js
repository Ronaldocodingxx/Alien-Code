// Tokens -> AST. Every node: { k: Kind, line, col, pos, end, ...fields }.
// Grammar summary lives in docs/SPEC.md; keep both in sync.

import { lex } from "./lexer.js";
import { AlienError } from "./errors.js";

// binary operator precedence, lowest first. `|>` sits below all of these.
const PREC = [["??"], ["||"], ["&&"], ["==", "!="], ["<", "<=", ">", ">="], ["..", "..="], ["+", "-"], ["*", "/", "//", "%"]];
const RANGE_LEVEL = 5;
const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/="]);

const desc = (t) => (t.t === "eof" ? "end of file" : t.t === "nl" ? "newline" : t.t === "str" ? "string" : `'${t.v}'`);

export function parse(src, file = "<input>") {
  return new Parser(lex(src, file), file).program();
}

class Parser {
  constructor(toks, file) {
    this.toks = toks;
    this.i = 0;
    this.file = file;
  }

  get tok() { return this.toks[this.i]; }
  peek(n = 1) { return this.toks[Math.min(this.i + n, this.toks.length - 1)]; }
  next() {
    const t = this.toks[this.i];
    if (t.t !== "eof") this.i++;
    return t;
  }
  is(t, v) { const k = this.tok; return k.t === t && (v === undefined || k.v === v); }
  isOp(v) { return this.is("op", v); }
  isKw(v) { return this.is("kw", v); }
  eat(t, v) { return this.is(t, v) ? this.next() : null; }
  expect(t, v, what, hint) {
    if (this.is(t, v)) return this.next();
    throw this.err("E010", `expected ${what || `'${v}'`}, found ${desc(this.tok)}`, this.tok, hint);
  }
  err(code, msg, tok = this.tok, hint) { return new AlienError(code, msg, this.file, tok.line, tok.col, hint); }
  skipNL() { while (this.tok.t === "nl") this.i++; }
  node(k, t, fields) { return { k, line: t.line, col: t.col, pos: t.pos, end: t.end, ...fields }; }
  done(n) { n.end = this.toks[Math.max(0, this.i - 1)].end; return n; }

  // continuation: an operator/keyword at the start of the next line continues the expression
  cont(t, vals) {
    if (this.tok.t === t && vals.includes(this.tok.v)) return true;
    if (this.tok.t !== "nl") return false;
    let j = this.i;
    while (this.toks[j].t === "nl") j++;
    const n = this.toks[j];
    if (n.t === t && vals.includes(n.v)) { this.i = j; return true; }
    return false;
  }

  // ---------- statements ----------

  program() {
    const body = [];
    this.skipNL();
    while (!this.is("eof")) {
      body.push(this.stmt(true));
      this.endStmt();
    }
    return { k: "Program", body };
  }

  endStmt() {
    if (this.is("nl")) return this.skipNL();
    if (this.is("eof") || this.isOp("}")) return;
    throw this.err("E010", `expected newline or ';' after statement, found ${desc(this.tok)}`, this.tok,
      "put each statement on its own line or separate them with ';'");
  }

  atStmtEnd() { return this.is("nl") || this.is("eof") || this.isOp("}"); }

  block() {
    const t = this.expect("op", "{", "'{'", "block bodies are always wrapped in { }");
    this.skipNL();
    const body = [];
    while (!this.isOp("}")) {
      if (this.is("eof")) throw this.err("E010", "unclosed '{'", t, "add the matching '}'");
      body.push(this.stmt(false));
      this.endStmt();
    }
    this.next();
    return this.done(this.node("Block", t, { body }));
  }

  stmt(top) {
    const t = this.tok;
    if (t.t === "kw") {
      switch (t.v) {
        case "use":
          if (!top) throw this.err("E011", "'use' is only allowed at the top level of a file");
          return this.useStmt();
        case "pub": {
          if (!top) throw this.err("E011", "'pub' is only allowed at the top level of a file");
          this.next();
          const s = this.stmt(true);
          if (s.k !== "FnDecl" && !(s.k === "Let" && s.target.k === "PId"))
            throw this.err("E011", "'pub' must be followed by 'fn name(...)' or 'name := value'", t);
          s.pub = true;
          return s;
        }
        case "fn":
          if (this.peek().t === "id") return this.fnDecl();
          break;
        case "test": {
          if (!top) throw this.err("E011", "'test' blocks are only allowed at the top level of a file");
          this.next();
          const name = this.expect("str", undefined, "test name string");
          if (name.v.some((p) => typeof p !== "string")) throw this.err("E010", "test name cannot contain interpolation", name);
          return this.done(this.node("Test", t, { name: name.v.join(""), body: this.block() }));
        }
        case "ret": {
          this.next();
          return this.done(this.node("Ret", t, { value: this.atStmtEnd() ? null : this.expr() }));
        }
        case "break":
        case "continue":
          this.next();
          return this.node(t.v === "break" ? "Break" : "Continue", t, {});
        case "throw":
          this.next();
          return this.done(this.node("Throw", t, { value: this.expr() }));
        case "while": {
          this.next();
          const cond = this.expr();
          return this.done(this.node("While", t, { cond, body: this.block() }));
        }
        case "for": {
          this.next();
          const pat = this.pattern(false);
          this.expect("kw", "in", "'in'", "write: for x in list { ... }");
          const iter = this.expr();
          return this.done(this.node("For", t, { pat, iter, body: this.block() }));
        }
      }
    }

    const e = this.expr();
    if (this.isOp(":=")) {
      this.next();
      this.skipNL();
      const target = this.toPattern(e);
      return this.done(this.node("Let", t, { target, value: this.expr() }));
    }
    if (this.tok.t === "op" && ASSIGN_OPS.has(this.tok.v)) {
      const op = this.next().v;
      if (!["Id", "Member", "Index"].includes(e.k) || (e.k === "Member" && e.opt))
        throw this.err("E040", "invalid assignment target", t, "assign to a name, obj.field or list[index]");
      if (e.k === "Id" && e.name === "_") throw this.err("E040", "cannot assign to '_'", t);
      this.skipNL();
      return this.done(this.node("Assign", t, { op, target: e, value: this.expr() }));
    }
    return this.done(this.node("ExprStmt", t, { expr: e }));
  }

  useStmt() {
    const t = this.next();
    const p = this.expect("str", undefined, "module path string", 'write: use "./file.aln" as name   or   use "node:fs" {readFileSync}');
    if (p.v.some((x) => typeof x !== "string")) throw this.err("E010", "module path cannot contain interpolation", p);
    const path = p.v.join("");
    let alias = null, names = null;
    if (this.eat("kw", "as")) alias = this.expect("id", undefined, "alias name").v;
    else if (this.isOp("{")) {
      this.next();
      names = [];
      while (!this.isOp("}")) {
        this.skipNL();
        if (this.isOp("}")) break;
        const n = this.expect("id", undefined, "imported name").v;
        const as = this.eat("kw", "as") ? this.expect("id", undefined, "alias name").v : n;
        names.push({ name: n, as });
        this.skipNL();
        if (!this.eat("op", ",")) break;
      }
      this.skipNL();
      this.expect("op", "}");
    } else throw this.err("E010", "expected 'as name' or '{names}' after module path", this.tok, 'use "./x.aln" as x');
    return this.done(this.node("Use", t, { path, alias, names }));
  }

  fnDecl() {
    const t = this.next();
    const name = this.next().v;
    const params = this.params();
    return this.done(this.node("FnDecl", t, { name, params, body: this.fnBody() }));
  }

  params() {
    this.expect("op", "(", "'('");
    const ps = [];
    while (!this.isOp(")")) {
      if (this.eat("op", "...")) ps.push({ rest: true, pat: this.pattern(false), def: null });
      else {
        const pat = this.pattern(false);
        const def = this.eat("op", "=") ? this.expr() : null;
        ps.push({ rest: false, pat, def });
      }
      if (!this.eat("op", ",")) break;
    }
    this.expect("op", ")", "')' or ','");
    return ps;
  }

  // `{` starting an object literal rather than a block: { key: ..., { key, ..., { "key": ..., { ...x
  // (none of these can begin a statement, so the choice is unambiguous)
  looksLikeObject() {
    if (!this.isOp("{")) return false;
    let j = this.i + 1;
    while (this.toks[j].t === "nl") j++;
    const a = this.toks[j], b = this.toks[j + 1];
    if (a.t === "op" && a.v === "...") return true;
    if (a.t === "id" || a.t === "kw" || a.t === "str" || a.t === "num") return b.t === "op" && (b.v === ":" || (b.v === "," && a.t === "id"));
    return false;
  }

  fnBody() {
    if (this.looksLikeObject()) return this.object();
    if (this.isOp("{")) return this.block();
    if (this.atStmtEnd()) throw this.err("E010", "missing function body", this.tok, "write fn f(x) x * 2   or   fn f(x) { ... } (body starts on the same line)");
    if (this.tok.t === "kw" && ["for", "while", "ret", "break", "continue", "throw"].includes(this.tok.v))
      throw this.err("E010", `'${this.tok.v}' is a statement and cannot be a single-expression body`, this.tok, `wrap the body in braces: fn f(x) { ${this.tok.v} ... }`);
    return this.expr();
  }

  // Patterns: used by :=, for, fn params (binding) and match (literals allowed).
  pattern(allowLit) {
    const t = this.tok;
    if (t.t === "id") { this.next(); return this.node(t.v === "_" ? "PWild" : "PId", t, { name: t.v }); }
    if (this.isOp("[")) {
      this.next();
      const items = [];
      let rest = null;
      while (!this.isOp("]")) {
        if (this.eat("op", "...")) {
          // [...] / [..._]: any further items, unnamed
          rest = this.is("id") ? this.next().v : "_";
          break;
        }
        items.push(this.pattern(allowLit));
        if (!this.eat("op", ",")) break;
      }
      this.expect("op", "]", "']'");
      return this.done(this.node("PArr", t, { items, rest }));
    }
    if (this.isOp("{")) {
      this.next();
      const props = [];
      while (true) {
        this.skipNL();
        if (this.isOp("}")) break;
        const kt = this.tok;
        let key;
        if (kt.t === "id" || kt.t === "kw") key = this.next().v;
        else if (kt.t === "str" && kt.v.every((x) => typeof x === "string")) key = this.next().v.join("");
        else throw this.err("E010", `expected field name in pattern, found ${desc(kt)}`);
        let pat;
        if (this.eat("op", ":")) pat = this.pattern(allowLit);
        else {
          if (kt.t !== "id") throw this.err("E010", `field '${key}' needs ': name' in pattern`, kt);
          pat = this.node("PId", kt, { name: key });
        }
        props.push({ key, pat });
        this.skipNL();
        if (!this.eat("op", ",")) break;
      }
      this.skipNL();
      this.expect("op", "}", "'}'");
      return this.done(this.node("PObj", t, { props }));
    }
    if (allowLit) {
      if (t.t === "num") { this.next(); return this.node("PLit", t, { js: t.v }); }
      if (this.isOp("-") && this.peek().t === "num") { this.next(); const n = this.next(); return this.node("PLit", t, { js: `-${n.v}` }); }
      if (t.t === "str") {
        if (t.v.some((x) => typeof x !== "string")) throw this.err("E010", "string patterns cannot contain interpolation");
        this.next();
        return this.node("PLit", t, { js: JSON.stringify(t.v.join("")) });
      }
      if (t.t === "kw" && (t.v === "true" || t.v === "false")) { this.next(); return this.node("PLit", t, { js: t.v }); }
      if (t.t === "kw" && t.v === "nil") { this.next(); return this.node("PLit", t, { js: "null", nil: true }); }
    }
    if (t.t === "num" || t.t === "str" || (t.t === "kw" && ["true", "false", "nil"].includes(t.v)))
      throw this.err("E041", "literal patterns are only allowed in match arms", t, "bind a name here, then compare it");
    throw this.err("E010", `expected ${allowLit ? "pattern" : "name or [ ]/{ } pattern"}, found ${desc(t)}`);
  }

  // convert an already-parsed expression (left of :=) into a binding pattern
  toPattern(e) {
    const bad = () => new AlienError("E040", "invalid left side of ':='", this.file, e.line, e.col,
      "declare a name (x := 1) or destructure ([a, b] := xs, {a, b} := obj)");
    const at = (k, f) => ({ k, line: e.line, col: e.col, pos: e.pos, end: e.end, ...f });
    switch (e.k) {
      case "Id": return at(e.name === "_" ? "PWild" : "PId", { name: e.name });
      case "Arr": {
        const items = [];
        let rest = null;
        e.items.forEach((x, idx) => {
          if (x.k === "Spread") {
            if (idx !== e.items.length - 1 || x.value.k !== "Id") throw bad();
            rest = x.value.name;
          } else items.push(this.toPattern(x));
        });
        return at("PArr", { items, rest });
      }
      case "Obj":
        return at("PObj", {
          props: e.props.map((p) => {
            if (p.spread || p.computed) throw bad();
            return { key: p.key, pat: this.toPattern(p.value) };
          }),
        });
      default: throw bad();
    }
  }

  // ---------- expressions ----------

  expr() {
    let left = this.binary(0);
    while (this.cont("op", ["|>"])) {
      const t = this.next();
      this.skipNL();
      const right = this.binary(0);
      left = this.pipe(left, right, t);
    }
    return left;
  }

  pipe(left, right, t) {
    if (right.k === "Call") {
      const idx = right.args.findIndex((a) => a.k === "Id" && a.name === "_");
      const args = right.args.slice();
      if (idx >= 0) args[idx] = left;
      else args.unshift(left);
      return { ...right, args, line: left.line, col: left.col, pos: left.pos };
    }
    if (right.k !== "Id" && right.k !== "Member" && right.k !== "Fn")
      throw this.err("E012", "right side of |> must be a function or a call", t, "write: xs |> map(fn(x) x * 2)");
    return { k: "Call", callee: right, args: [left], line: left.line, col: left.col, pos: left.pos, end: right.end };
  }

  binary(level) {
    if (level === PREC.length) return this.unary();
    let left = this.binary(level + 1);
    const ops = PREC[level];
    while (level <= 2 ? this.cont("op", ops) : this.tok.t === "op" && ops.includes(this.tok.v)) {
      const op = this.next().v;
      this.skipNL();
      const right = this.binary(level + 1);
      left = { k: "Bin", op, left, right, line: left.line, col: left.col, pos: left.pos, end: right.end };
      if (level === RANGE_LEVEL) break;
    }
    return left;
  }

  unary() {
    const t = this.tok;
    if (this.isOp("-") || this.isOp("!")) {
      this.next();
      const e = this.unary();
      return { k: "Un", op: t.v, e, line: t.line, col: t.col, pos: t.pos, end: e.end };
    }
    if (this.isKw("await")) {
      this.next();
      const e = this.unary();
      return { k: "Await", e, line: t.line, col: t.col, pos: t.pos, end: e.end };
    }
    const base = this.postfix();
    if (this.isOp("**")) {
      this.next();
      this.skipNL();
      const exp = this.unary();
      return { k: "Bin", op: "**", left: base, right: exp, line: base.line, col: base.col, pos: base.pos, end: exp.end };
    }
    return base;
  }

  postfix() {
    let e = this.primary();
    for (;;) {
      if (this.isOp("(")) {
        const args = this.args(")");
        e = { k: "Call", callee: e, args, line: e.line, col: e.col, pos: e.pos, end: this.toks[this.i - 1].end };
      } else if (this.isOp("[")) {
        this.next();
        const index = this.expr();
        const close = this.expect("op", "]", "']'");
        e = { k: "Index", obj: e, index, line: e.line, col: e.col, pos: e.pos, end: close.end };
      } else if (this.cont("op", [".", "?."])) {
        const opt = this.next().v === "?.";
        // x?.[i] and f?.(args)
        if (opt && this.isOp("[")) {
          this.next();
          const index = this.expr();
          const close = this.expect("op", "]", "']'");
          e = { k: "Index", obj: e, index, opt: true, line: e.line, col: e.col, pos: e.pos, end: close.end };
          continue;
        }
        if (opt && this.isOp("(")) {
          const args = this.args(")");
          e = { k: "Call", callee: e, args, opt: true, line: e.line, col: e.col, pos: e.pos, end: this.toks[this.i - 1].end };
          continue;
        }
        const n = this.tok;
        if (n.t !== "id" && n.t !== "kw") throw this.err("E010", `expected field name after '.', found ${desc(n)}`);
        this.next();
        e = { k: "Member", obj: e, name: n.v, opt, line: e.line, col: e.col, pos: e.pos, end: n.end };
      } else return e;
    }
  }

  args(close) {
    this.next();
    const list = [];
    for (;;) {
      this.skipNL();
      if (this.isOp(close)) break;
      const st = this.tok;
      if (this.eat("op", "...")) {
        const v = this.expr();
        list.push({ k: "Spread", value: v, line: st.line, col: st.col, pos: st.pos, end: v.end });
      } else list.push(this.expr());
      this.skipNL();
      if (!this.eat("op", ",")) break;
    }
    this.skipNL();
    this.expect("op", close, `'${close}' or ','`);
    return list;
  }

  primary() {
    const t = this.tok;
    switch (t.t) {
      case "num":
        this.next();
        return this.node("Num", t, { v: t.v });
      case "str":
        this.next();
        return this.str(t);
      case "id":
        this.next();
        return this.node("Id", t, { name: t.v });
      case "kw":
        switch (t.v) {
          case "true":
          case "false":
            this.next();
            return this.node("Bool", t, { v: t.v });
          case "nil":
            this.next();
            return this.node("Nil", t, {});
          case "fn": {
            this.next();
            const params = this.params();
            return this.done(this.node("Fn", t, { params, body: this.fnBody() }));
          }
          case "if": return this.ifExpr();
          case "match": return this.matchExpr();
          case "try": {
            this.next();
            const body = this.block();
            if (!this.cont("kw", ["catch"])) throw this.err("E010", "'try' needs a 'catch' block", this.tok, "try { ... } catch e { ... }");
            this.next();
            const param = this.is("id") ? this.next().v : null;
            return this.done(this.node("Try", t, { body, param, handler: this.block() }));
          }
          case "new": {
            this.next();
            const ct = this.expect("id", undefined, "class name");
            let callee = this.node("Id", ct, { name: ct.v });
            while (this.isOp(".")) {
              this.next();
              const n = this.expect("id", undefined, "name");
              callee = { k: "Member", obj: callee, name: n.v, opt: false, line: t.line, col: t.col, pos: t.pos, end: n.end };
            }
            if (!this.isOp("(")) throw this.err("E010", "expected '(' after class name in 'new'", this.tok, "new Map()");
            const args = this.args(")");
            return this.done(this.node("New", t, { callee, args }));
          }
        }
        break;
      case "op":
        if (t.v === "(") {
          this.next();
          this.skipNL();
          const e = this.expr();
          this.skipNL();
          this.expect("op", ")", "')'");
          return e;
        }
        if (t.v === "[") {
          const items = this.args("]");
          return this.done(this.node("Arr", t, { items }));
        }
        if (t.v === "{") return this.object();
        if (t.v === "...") throw this.err("E013", "'...' is only allowed inside [ ], { } and call arguments", t);
        break;
    }
    let hint;
    if (t.t === "op" && t.v === "=") hint = "declare with name := value; reassign with name = value";
    if (t.t === "kw" && (t.v === "else" || t.v === "catch")) hint = `'${t.v}' must follow the closing '}' of its block`;
    if (t.t === "nl" || t.t === "eof") hint = "an expression is missing here";
    throw this.err("E010", `unexpected ${desc(t)}`, t, hint);
  }

  object() {
    const t = this.next();
    const props = [];
    for (;;) {
      this.skipNL();
      if (this.isOp("}")) break;
      const kt = this.tok;
      if (this.eat("op", "...")) props.push({ spread: true, value: this.expr() });
      else if (this.isOp("[")) {
        this.next();
        const key = this.expr();
        this.expect("op", "]", "']'");
        this.expect("op", ":", "':'");
        this.skipNL();
        props.push({ computed: true, key, value: this.expr() });
      } else {
        let key;
        if (kt.t === "id" || kt.t === "kw") key = this.next().v;
        else if (kt.t === "num") key = this.next().v;
        else if (kt.t === "str" && kt.v.every((x) => typeof x === "string")) key = this.next().v.join("");
        else throw this.err("E010", `expected field name, found ${desc(kt)}`, kt, "objects look like {name: value, other}");
        if (this.eat("op", ":")) {
          this.skipNL();
          props.push({ key, value: this.expr() });
        } else {
          if (kt.t !== "id") throw this.err("E010", `field '${key}' needs ': value'`, kt);
          props.push({ key, value: this.node("Id", kt, { name: key }) });
        }
      }
      this.skipNL();
      if (!this.eat("op", ",")) break;
    }
    this.skipNL();
    this.expect("op", "}", "'}' or ','");
    return this.done(this.node("Obj", t, { props }));
  }

  ifExpr() {
    const t = this.next();
    const cond = this.expr();
    const then = this.block();
    let els = null;
    if (this.cont("kw", ["else"])) {
      this.next();
      els = this.isKw("if") ? this.ifExpr() : this.block();
    }
    return this.done(this.node("If", t, { cond, then, els }));
  }

  matchExpr() {
    const t = this.next();
    const subject = this.expr();
    this.expect("op", "{", "'{'");
    const arms = [];
    for (;;) {
      this.skipNL();
      if (this.isOp("}")) break;
      const at = this.tok;
      const pats = [this.pattern(true)];
      while (this.eat("op", "|")) pats.push(this.pattern(true));
      if (pats.length > 1 && pats.some((p) => p.k !== "PLit"))
        throw this.err("E010", "alternatives with '|' may only combine literal patterns", at);
      const guard = this.eat("kw", "if") ? this.expr() : null;
      this.expect("op", "=>", "'=>'", "match arms look like: pattern => value");
      this.skipNL();
      let body;
      if (this.looksLikeObject()) body = this.object();
      else if (this.isOp("{")) body = this.block();
      else if (this.tok.t === "kw" && ["ret", "break", "continue", "throw"].includes(this.tok.v)) {
        const st = this.tok;
        body = this.done(this.node("Block", st, { body: [this.stmt(false)] }));
      } else body = this.expr();
      arms.push({ pats, guard, body, line: at.line });
      if (this.eat("op", ",")) continue;
      if (!this.is("nl") && !this.isOp("}")) throw this.err("E010", `expected newline, ',' or '}' after match arm, found ${desc(this.tok)}`);
    }
    this.expect("op", "}");
    if (!arms.length) throw this.err("E010", "match needs at least one arm", t);
    return this.done(this.node("Match", t, { subject, arms }));
  }

  str(t) {
    const parts = t.v;
    if (parts.every((p) => typeof p === "string")) return this.node("Str", t, { v: parts.join("") });
    return this.node("Tpl", t, {
      parts: parts.map((p) => {
        if (typeof p === "string") return p;
        const sub = new Parser(lex(p.src, this.file, p), this.file);
        sub.skipNL();
        if (sub.is("eof")) throw sub.err("E010", "empty interpolation '{}' in string", sub.tok, "write \\{\\} for literal braces");
        const e = sub.expr();
        sub.skipNL();
        if (!sub.is("eof")) throw sub.err("E010", `unexpected ${desc(sub.tok)} in string interpolation`);
        return e;
      }),
    });
  }
}
