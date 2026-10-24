// AST -> JavaScript (ES module) + source map.
// Also performs name resolution, so unknown names and misuse of ret/break are
// compile errors instead of runtime surprises.
//
// Core idea: Alien is expression-oriented, JS is not. `into(expr, sink)` compiles an
// expression whose value goes somewhere (return it, assign it, discard it). if/match/try
// distribute the sink into their branches, so they become plain JS statements.
// Only when they are nested inside a larger expression do we fall back to a ternary
// (simple if) or an arrow IIFE.

import { AlienError } from "./errors.js";
import { PRELUDE } from "./prelude.js";

const JS_RESERVED = new Set([
  "arguments", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "eval", "export", "extends", "false", "finally", "for", "function", "if",
  "implements", "import", "in", "instanceof", "interface", "let", "new", "null", "package", "private",
  "protected", "public", "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof",
  "var", "void", "while", "with", "yield", "undefined", "NaN", "Infinity", "globalThis",
]);

const JS_GLOBALS = new Set([
  "Math", "JSON", "Object", "Array", "Number", "String", "Boolean", "Symbol", "BigInt", "Date", "RegExp",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "Proxy", "Reflect", "Intl", "Error", "TypeError",
  "RangeError", "SyntaxError", "ArrayBuffer", "DataView", "Uint8Array", "Int8Array", "Uint16Array",
  "Int16Array", "Uint32Array", "Int32Array", "Float32Array", "Float64Array", "BigInt64Array",
  "BigUint64Array", "console", "process", "Buffer", "URL", "URLSearchParams", "TextEncoder", "TextDecoder",
  "fetch", "Request", "Response", "Headers", "FormData", "Blob", "AbortController", "AbortSignal",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask",
  "structuredClone", "crypto", "performance", "parseInt", "parseFloat", "isNaN", "isFinite",
  "encodeURIComponent", "decodeURIComponent", "atob", "btoa", "WebSocket", "Infinity", "NaN",
  // browser (alien:web client code)
  "document", "window", "location", "history", "navigator", "localStorage", "sessionStorage", "alert",
  "confirm", "requestAnimationFrame", "Event", "CustomEvent", "EventSource", "HTMLElement", "Image",
]);

const CONTROL = new Set(["If", "Match", "Try"]);
const NUMERIC_OPS = new Set(["+", "-", "*", "/", "//", "%", "**", "<", "<=", ">", ">=", "==", "!="]);
const RETURN = (v) => `return ${v};`;

const mangle = (n) => (JS_RESERVED.has(n) ? `${n}$` : n);
const propKey = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) || /^\d+$/.test(k) ? k : JSON.stringify(k));

// is the value of this expression always a primitive? then == can be ===
function isPrim(e) {
  switch (e.k) {
    case "Num": case "Str": case "Tpl": case "Bool": case "Un": return true;
    case "Bin": return NUMERIC_OPS.has(e.op);
  }
  return false;
}

function hasAwait(n) {
  if (!n || typeof n !== "object") return false;
  if (Array.isArray(n)) return n.some(hasAwait);
  if (n.k === "Fn" || n.k === "FnDecl") return false;
  if (n.k === "Await") return true;
  for (const key in n) if (n[key] && typeof n[key] === "object" && hasAwait(n[key])) return true;
  return false;
}

// a ret/break/continue that would escape an expression-position if/match/try
function findEscape(n, loops) {
  if (!n || typeof n !== "object") return null;
  if (Array.isArray(n)) {
    for (const x of n) { const r = findEscape(x, loops); if (r) return r; }
    return null;
  }
  switch (n.k) {
    case "Fn": case "FnDecl": return null;
    case "Ret": return n;
    case "Break": case "Continue": return loops ? null : n;
    case "For": return findEscape(n.iter, loops) || findEscape(n.body, loops + 1);
    case "While": return findEscape(n.cond, loops) || findEscape(n.body, loops + 1);
  }
  for (const key in n) {
    if (n[key] && typeof n[key] === "object") { const r = findEscape(n[key], loops); if (r) return r; }
  }
  return null;
}

function patNames(p) {
  switch (p.k) {
    case "PId": return [p.name];
    case "PArr": return [...p.items.flatMap(patNames), ...(p.rest ? [p.rest] : [])];
    case "PObj": return p.props.flatMap((x) => patNames(x.pat));
  }
  return [];
}

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function suggest(n, names) {
  let best = null, bd = n.length > 4 ? 3 : 2;
  for (const c of new Set(names)) {
    const dist = lev(n.toLowerCase(), c.toLowerCase());
    if (dist < bd) { bd = dist; best = c; }
  }
  return best;
}

class Scope {
  constructor(parent) { this.parent = parent; this.vars = new Set(); }
  has(n) { for (let s = this; s; s = s.parent) if (s.vars.has(n)) return true; return false; }
  all() { const r = []; for (let s = this; s; s = s.parent) r.push(...s.vars); return r; }
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function vlq(n) {
  let v = n < 0 ? (-n << 1) | 1 : n << 1, s = "";
  do { let d = v & 31; v >>>= 5; if (v) d |= 32; s += B64[d]; } while (v);
  return s;
}

class Gen {
  constructor(o) {
    this.o = o;
    this.file = o.displayFile;
    this.src = o.src;
    this.out = [];
    this.ind = 0;
    this.n = 0;
    this.line = 1;
    this.prelude = new Set();
    this.deps = [];
    this.ctx = { fn: false, loop: 0 };
  }

  err(code, msg, node, hint) { return new AlienError(code, msg, this.file, node.line, node.col, hint); }
  tmp() { return `$t${++this.n}`; }

  // lines produced by capture() carry \x01<line>\x01 markers so source lines survive nesting
  emit(s) {
    const pad = "  ".repeat(this.ind);
    for (let l of s.split("\n")) {
      let line = this.line;
      const m = /^\x01(\d+)\x01/.exec(l);
      if (m) { line = +m[1]; l = l.slice(m[0].length); }
      this.out.push([pad + l, line]);
    }
  }

  capture(f) {
    const out = this.out, ind = this.ind, line = this.line;
    this.out = [];
    this.ind = 0;
    f();
    const r = this.out;
    this.out = out; this.ind = ind; this.line = line;
    return r.map(([c, l]) => `\x01${l}\x01${c}`).join("\n");
  }

  declare(name, scope, node) {
    if (scope.vars.has(name))
      throw this.err("E022", `'${name}' is already declared in this scope`, node, `reassign with ${name} = ..., or pick a new name`);
    scope.vars.add(name);
  }

  predeclare(stmts, scope) {
    for (const s of stmts) {
      if (s.k === "FnDecl") this.declare(s.name, scope, s);
      else if (s.k === "Let") for (const n of patNames(s.target)) this.declare(n, scope, s.target);
    }
  }

  id(node, scope) {
    const n = node.name;
    if (n === "_") throw this.err("E020", "'_' is a placeholder, not a value", node, "use _ in patterns or as the |> argument slot: x |> f(a, _)");
    if (scope.has(n)) return mangle(n);
    if (PRELUDE.has(n)) { this.prelude.add(n); return `$${n}`; }
    if (n === "js") return "globalThis";
    if (n === "here") return "$rt.dirOf(import.meta.url)";
    if (JS_GLOBALS.has(n)) return n;
    const s = suggest(n, [...scope.all(), ...PRELUDE, ...JS_GLOBALS]);
    throw this.err("E020", `unknown name '${n}'`, node, s ? `did you mean '${s}'?` : `declare it with ${n} := ...  (other JS globals: js.${n})`);
  }

  // ---------- module ----------

  program(prog) {
    const scope = new Scope(null);
    const head = [`import * as $rt from ${JSON.stringify(this.o.runtimeUrl)};`];
    const imports = prog.body.filter((s) => s.k === "Use").map((s) => this.use(s, scope));
    const sink = this.o.printLast ? (v) => `$rt.show(${v});` : null;
    this.body(prog.body.filter((s) => s.k !== "Use"), scope, sink);
    const pre = [...this.prelude].sort();
    if (pre.length) head.push(`import { ${pre.map((n) => `${n} as $${n}`).join(", ")} } from ${JSON.stringify(this.o.runtimeUrl)};`);
    const lines = [...[...head, ...imports].flatMap((l) => l.split("\n")).map((l) => [l, 1]), ...this.out];
    let code = lines.map((l) => l[0]).join("\n") + "\n";
    if (this.o.map !== false) {
      let prev = 0;
      const mappings = lines.map(([, line]) => { const s = "AA" + vlq(line - 1 - prev) + "A"; prev = line - 1; return s; }).join(";");
      const map = { version: 3, sources: [this.o.sourceUrl ?? this.file], sourcesContent: [this.src], names: [], mappings };
      code += `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}\n`;
    }
    return { code, deps: this.deps };
  }

  use(s, scope) {
    // "alien:name" = standard library module std/name.aln; the CLI decides its real location
    const std = s.path.startsWith("alien:") ? s.path.slice(6) : null;
    const aln = std !== null || s.path.endsWith(".aln");
    if (aln) this.deps.push({ path: s.path, std, line: s.line, col: s.col });
    if (std !== null && !this.o.stdSpec) throw this.err("E050", `standard module '${s.path}' is not available here`, s);
    const spec = JSON.stringify(std !== null ? this.o.stdSpec(std) : aln && this.o.alnExt ? s.path.slice(0, -4) + this.o.alnExt : s.path);
    if (s.alias) {
      this.declare(s.alias, scope, s);
      const a = mangle(s.alias);
      if (aln) return `import * as ${a} from ${spec};`;
      return `import * as $ns_${a} from ${spec};\nconst ${a} = $ns_${a}.default ?? $ns_${a};`;
    }
    const names = s.names.map(({ name, as }) => {
      this.declare(as, scope, s);
      const src = aln ? mangle(name) : name;
      return src === mangle(as) ? src : `${src} as ${mangle(as)}`;
    });
    return `import { ${names.join(", ")} } from ${spec};`;
  }

  // ---------- statements ----------

  body(stmts, scope, sink) {
    this.predeclare(stmts, scope);
    if (!stmts.length) { if (sink) this.emit(sink("null")); return; }
    stmts.forEach((s, i) => {
      if (i < stmts.length - 1 || !sink) return this.stmt(s, scope);
      if (s.k === "ExprStmt") { this.line = s.line; return this.into(s.expr, scope, sink); }
      this.stmt(s, scope);
      if (!["Ret", "Throw", "Break", "Continue"].includes(s.k)) this.emit(sink("null"));
    });
  }

  inner(block, scope, sink) {
    this.ind++;
    this.body(block.body, new Scope(scope), sink);
    this.ind--;
  }

  loop(f) { const c = this.ctx; c.loop++; f(); c.loop--; }

  stmt(s, scope) {
    this.line = s.line;
    switch (s.k) {
      case "ExprStmt": return this.into(s.expr, scope, null);
      case "Let": return this.let(s, scope);
      case "Assign": return this.assign(s, scope);
      case "FnDecl": return this.emit((s.pub ? "export " : "") + this.fn(s, scope, mangle(s.name)));
      case "Ret":
        if (!this.ctx.fn) throw this.err("E030", "'ret' outside of a function", s);
        if (!s.value) return this.emit("return;");
        return this.into(s.value, scope, RETURN);
      case "Break":
      case "Continue":
        if (!this.ctx.loop) throw this.err("E031", `'${s.k.toLowerCase()}' outside of a loop`, s);
        return this.emit(s.k === "Break" ? "break;" : "continue;");
      case "Throw": return this.emit(`throw $rt.err(${this.expr(s.value, scope)});`);
      case "While":
        this.emit(`while (${this.expr(s.cond, scope)}) {`);
        this.loop(() => this.inner(s.body, scope, null));
        return this.emit("}");
      case "For": return this.forStmt(s, scope);
      case "Test": {
        const save = this.ctx;
        this.ctx = { fn: true, loop: 0 };
        const body = this.capture(() => { this.ind = 1; this.body(s.body.body, new Scope(scope), null); });
        this.ctx = save;
        return this.emit(`$rt.test(${JSON.stringify(s.name)}, async () => {\n${body}\n}, ${JSON.stringify(this.file)}, ${s.line});`);
      }
    }
    throw this.err("E099", `internal: cannot compile statement ${s.k}`, s);
  }

  let(s, scope) {
    const kw = s.pub ? "export let" : "let";
    if (CONTROL.has(s.value.k)) {
      if (s.target.k === "PId") {
        const n = mangle(s.target.name);
        this.emit(`${kw} ${n};`);
        return this.into(s.value, scope, (v) => `${n} = ${v};`);
      }
      const t = this.tmp();
      this.emit(`let ${t};`);
      this.into(s.value, scope, (v) => `${t} = ${v};`);
      return this.emit(`${kw} ${this.bindPat(s.target, scope, false)} = ${t};`);
    }
    this.emit(`${kw} ${this.bindPat(s.target, scope, false)} = ${this.expr(s.value, scope)};`);
  }

  assign(s, scope) {
    const t = s.target;
    let target;
    if (t.k === "Id") {
      if (!scope.has(t.name)) {
        if (PRELUDE.has(t.name) || JS_GLOBALS.has(t.name))
          throw this.err("E021", `cannot assign to built-in '${t.name}'`, t, `declare your own: ${t.name} := ...`);
        throw this.err("E021", `'${t.name}' is not declared`, t, `declare it first: ${t.name} := ...`);
      }
      target = mangle(t.name);
    } else target = this.expr(t, scope);
    if (s.op === "=" && CONTROL.has(s.value.k)) return this.into(s.value, scope, (v) => `${target} = ${v};`);
    this.emit(`${target} ${s.op} ${this.expr(s.value, scope)};`);
  }

  forStmt(s, scope) {
    const inner = new Scope(scope);
    const it = s.iter;
    if (s.pat.k === "PId" && it.k === "Bin" && (it.op === ".." || it.op === "..=")) {
      const a = this.expr(it.left, scope), b = this.expr(it.right, scope);
      this.declare(s.pat.name, inner, s.pat);
      const v = mangle(s.pat.name), end = this.tmp();
      this.emit(`for (let ${v} = ${a}, ${end} = ${b}; ${v} ${it.op === ".." ? "<" : "<="} ${end}; ${v}++) {`);
    } else {
      const src = this.expr(it, scope);
      this.emit(`for (let ${this.bindPat(s.pat, inner, true)} of ${src}) {`);
    }
    this.loop(() => { this.ind++; this.body(s.body.body, inner, null); this.ind--; });
    this.emit("}");
  }

  // compile expression e, handing its value to sink (null = discard)
  into(e, scope, sink) {
    switch (e.k) {
      case "If": {
        this.emit(`if (${this.expr(e.cond, scope)}) {`);
        this.inner(e.then, scope, sink);
        let els = e.els;
        while (els && els.k === "If") {
          this.emit(`} else if (${this.expr(els.cond, scope)}) {`);
          this.inner(els.then, scope, sink);
          els = els.els;
        }
        if (els) { this.emit("} else {"); this.inner(els, scope, sink); }
        else if (sink) { this.emit("} else {"); this.ind++; this.emit(sink("null")); this.ind--; }
        return this.emit("}");
      }
      case "Match": return this.match(e, scope, sink);
      case "Try": {
        this.emit("try {");
        this.inner(e.body, scope, sink);
        const cs = new Scope(scope);
        let p = "$e";
        if (e.param) { this.declare(e.param, cs, e); p = mangle(e.param); }
        this.emit(`} catch (${p}) {`);
        this.ind++;
        this.body(e.handler.body, cs, sink);
        this.ind--;
        return this.emit("}");
      }
    }
    const js = this.expr(e, scope);
    this.emit(sink ? sink(js) : (js.startsWith("{") ? `(${js})` : js) + ";");
  }

  match(e, scope, sink) {
    let subj;
    if (e.subject.k === "Id") subj = this.expr(e.subject, scope);
    else {
      subj = this.tmp();
      this.emit(`const ${subj} = ${this.expr(e.subject, scope)};`);
    }
    // arms that return need no break, so the label is only emitted for other sinks
    const label = sink === RETURN ? null : `$m${++this.n}`;
    if (label) { this.emit(`${label}: {`); this.ind++; }
    let catchAll = false;
    for (const arm of e.arms) {
      this.line = arm.line;
      const s = new Scope(scope);
      const conds = [], binds = [];
      if (arm.pats.length > 1) conds.push(arm.pats.map((p) => (p.nil ? `${subj} == null` : `${subj} === ${p.js}`)).join(" || "));
      else this.patTest(arm.pats[0], subj, conds, binds, s);
      const finish = () => {
        if (arm.body.k === "Block") this.body(arm.body.body, new Scope(s), sink);
        else this.into(arm.body, s, sink);
        if (label) this.emit(`break ${label};`);
      };
      this.emit(conds.length ? `if (${conds.join(" && ")}) {` : "{");
      this.ind++;
      for (const [n, acc] of binds) this.emit(`const ${n} = ${acc};`);
      if (arm.guard) {
        this.emit(`if (${this.expr(arm.guard, s)}) {`);
        this.ind++; finish(); this.ind--;
        this.emit("}");
      } else finish();
      this.ind--;
      this.emit("}");
      if (!conds.length && !arm.guard) { catchAll = true; break; }
    }
    if (!catchAll) this.emit(`throw $rt.noMatch(${subj}, ${JSON.stringify(`${this.file}:${e.line}`)});`);
    if (label) { this.ind--; this.emit("}"); }
  }

  patTest(p, acc, conds, binds, scope) {
    switch (p.k) {
      case "PWild": return;
      case "PId":
        this.declare(p.name, scope, p);
        return binds.push([mangle(p.name), acc]);
      case "PLit": return conds.push(p.nil ? `${acc} == null` : `${acc} === ${p.js}`);
      case "PArr":
        conds.push(`Array.isArray(${acc})`, `${acc}.length ${p.rest ? ">=" : "==="} ${p.items.length}`);
        p.items.forEach((x, i) => this.patTest(x, `${acc}[${i}]`, conds, binds, scope));
        if (p.rest) { this.declare(p.rest, scope, p); binds.push([mangle(p.rest), `${acc}.slice(${p.items.length})`]); }
        return;
      case "PObj":
        conds.push(`${acc} != null && typeof ${acc} === "object"`);
        for (const { key, pat } of p.props) {
          conds.push(`${JSON.stringify(key)} in ${acc}`);
          this.patTest(pat, `${acc}[${JSON.stringify(key)}]`, conds, binds, scope);
        }
    }
  }

  bindPat(p, scope, declare) {
    switch (p.k) {
      case "PId":
        if (declare) this.declare(p.name, scope, p);
        return mangle(p.name);
      case "PWild": return `$_${++this.n}`;
      case "PArr": {
        const items = p.items.map((x) => (x.k === "PWild" ? "" : this.bindPat(x, scope, declare)));
        if (p.rest) {
          if (declare) this.declare(p.rest, scope, p);
          items.push(`...${mangle(p.rest)}`);
        }
        return `[${items.join(", ")}]`;
      }
      case "PObj":
        return `{ ${p.props.map(({ key, pat }) => {
          const k = propKey(key);
          if (pat.k === "PId" && pat.name === k && !JS_RESERVED.has(k)) {
            if (declare) this.declare(pat.name, scope, pat);
            return k;
          }
          return `${k}: ${this.bindPat(pat, scope, declare)}`;
        }).join(", ")} }`;
      case "PLit": throw this.err("E041", "literal patterns are only allowed in match arms", p);
    }
  }

  fn(node, scope, name) {
    const fs = new Scope(scope);
    const save = this.ctx;
    this.ctx = { fn: true, loop: 0 };
    const params = node.params.map((p) =>
      (p.rest ? "..." : "") + this.bindPat(p.pat, fs, true) + (p.def ? ` = ${this.expr(p.def, fs)}` : ""));
    const a = hasAwait(node.body) ? "async " : "";
    let body;
    if (node.body.k === "Block") body = `{\n${this.capture(() => { this.ind = 1; this.body(node.body.body, fs, RETURN); })}\n}`;
    else if (CONTROL.has(node.body.k)) body = `{\n${this.capture(() => { this.ind = 1; this.into(node.body, fs, RETURN); })}\n}`;
    else {
      const e = this.expr(node.body, fs);
      body = name ? `{ return ${e}; }` : e.startsWith("{") ? `(${e})` : e;
    }
    this.ctx = save;
    const ps = params.join(", ");
    return name ? `${a}function ${name}(${ps}) ${body}` : `(${a}(${ps}) => ${body})`;
  }

  // ---------- expressions ----------

  arg(x, scope) { return x.k === "Spread" ? `...${this.expr(x.value, scope)}` : this.expr(x, scope); }

  expr(e, scope) {
    switch (e.k) {
      case "Num": return e.v;
      case "Str": return JSON.stringify(e.v);
      case "Tpl":
        return "`" + e.parts.map((p) => typeof p === "string"
          ? p.replace(/[`\\$]/g, (c) => "\\" + c).replace(/[\x00-\x1f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
          : `\${$rt.str(${this.expr(p, scope)})}`).join("") + "`";
      case "Bool": return e.v;
      case "Nil": return "null";
      case "Id": return this.id(e, scope);
      case "Arr": return `[${e.items.map((x) => this.arg(x, scope)).join(", ")}]`;
      case "Obj":
        return `{${e.props.map((p) => p.spread ? `...${this.expr(p.value, scope)}`
          : p.computed ? `[${this.expr(p.key, scope)}]: ${this.expr(p.value, scope)}`
          : `${propKey(p.key)}: ${this.expr(p.value, scope)}`).join(", ")}}`;
      case "Un": return `(${e.op}${this.expr(e.e, scope)})`;
      case "Await": return `(await ${this.expr(e.e, scope)})`;
      case "Bin": return this.bin(e, scope);
      case "Call": return this.call(e, scope);
      case "Member": {
        const o = this.expr(e.obj, scope);
        return `${e.obj.k === "Num" ? `(${o})` : o}${e.opt ? "?." : "."}${e.name}`;
      }
      case "Index": return `${this.expr(e.obj, scope)}[${this.expr(e.index, scope)}]`;
      case "Fn": return this.fn(e, scope, null);
      case "New": return `new ${this.expr(e.callee, scope)}(${e.args.map((x) => this.arg(x, scope)).join(", ")})`;
      case "If": return this.simpleIf(e) ? this.ternary(e, scope) : this.iife(e, scope);
      case "Match":
      case "Try": return this.iife(e, scope);
      case "Spread": throw this.err("E013", "'...' is only allowed inside [ ], { } and call arguments", e);
    }
    throw this.err("E099", `internal: cannot compile expression ${e.k}`, e);
  }

  bin(e, scope) {
    const { op, left, right } = e;
    if (op === "==" || op === "!=") {
      const neg = op === "!=";
      if (left.k === "Nil" || right.k === "Nil") {
        const o = left.k === "Nil" ? right : left;
        return `(${this.expr(o, scope)} ${neg ? "!=" : "=="} null)`;
      }
      const a = this.expr(left, scope), b = this.expr(right, scope);
      if (isPrim(left) || isPrim(right)) return `(${a} ${neg ? "!==" : "==="} ${b})`;
      return `${neg ? "!" : ""}$rt.eq(${a}, ${b})`;
    }
    const a = this.expr(left, scope), b = this.expr(right, scope);
    switch (op) {
      case "..": return `$rt.range(${a}, ${b})`;
      case "..=": return `$rt.range(${a}, ${b} + 1)`;
      case "//": return `Math.floor(${a} / ${b})`;
    }
    return `(${a} ${op} ${b})`;
  }

  call(e, scope) {
    const c = e.callee;
    if (c.k === "Id" && c.name === "assert" && !scope.has("assert") && e.args.length >= 1 && e.args.length <= 2 && e.args[0].k !== "Spread") {
      const a0 = e.args[0];
      const text = e.args[1] ? this.expr(e.args[1], scope) : JSON.stringify(this.src.slice(a0.pos, a0.end));
      const loc = JSON.stringify(`${this.file}:${e.line}`);
      if (a0.k === "Bin" && a0.op === "==") return `$rt.assertEq(${this.expr(a0.left, scope)}, ${this.expr(a0.right, scope)}, ${text}, ${loc})`;
      return `$rt.assert(${this.expr(a0, scope)}, ${text}, ${loc})`;
    }
    return `${this.expr(c, scope)}(${e.args.map((x) => this.arg(x, scope)).join(", ")})`;
  }

  simpleBlock(b) { return b.body.length === 0 || (b.body.length === 1 && b.body[0].k === "ExprStmt"); }
  simpleIf(e) {
    return this.simpleBlock(e.then) && (!e.els || (e.els.k === "If" ? this.simpleIf(e.els) : this.simpleBlock(e.els)));
  }
  blockVal(b, scope) { return b.body.length ? this.expr(b.body[0].expr, new Scope(scope)) : "null"; }
  ternary(e, scope) {
    const els = !e.els ? "null" : e.els.k === "If" ? this.ternary(e.els, scope) : this.blockVal(e.els, scope);
    return `(${this.expr(e.cond, scope)} ? ${this.blockVal(e.then, scope)} : ${els})`;
  }

  iife(e, scope) {
    const bad = findEscape(e, 0);
    if (bad) throw this.err("E032", `'${bad.k.toLowerCase()}' cannot jump out of an if/match/try that is used as a value`, bad,
      "store the value in a variable first (x := if ...), or use the if/match as a statement");
    const a = hasAwait(e);
    const save = this.ctx;
    this.ctx = { fn: true, loop: 0 };
    const body = this.capture(() => { this.ind = 1; this.into(e, scope, RETURN); });
    this.ctx = save;
    const code = `(${a ? "async " : ""}() => {\n${body}\n})()`;
    return a ? `(await ${code})` : code;
  }
}

export function generate(prog, opts) {
  return new Gen(opts).program(prog);
}
