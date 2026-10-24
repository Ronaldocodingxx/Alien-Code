// Alien runtime: the prelude (functions every Alien file can use without `use`)
// plus internal helpers that generated code calls as $rt.<name>.
// Adding a prelude function: export it here (src/prelude.js picks it up automatically),
// document it in docs/SPEC.md and add a test in tests/.

// No static node: imports, so this file also runs in the browser (alien:web client code).
// Node-only prelude functions load their builtin on first use.
const node = (m) => globalThis.process?.getBuiltinModule?.(m) ?? (() => { throw new Error(`'${m}' is not available here (browser?)`); })();

// ---------- internals ----------

export const tests = [];
export function test(name, fn, file, line) { tests.push({ name, fn, file, line }); }

export class AssertError extends Error {
  constructor(msg, loc) { super(msg); this.name = "AssertError"; this.loc = loc; }
}

export function err(x) {
  if (x instanceof Error) return x;
  const e = new Error(typeof x === "string" ? x : repr(x));
  e.data = x;
  return e;
}

// `here`: directory of the current .aln file
export function dirOf(url) {
  const p = decodeURIComponent(new URL(url).pathname);
  return (/^\/[A-Za-z]:/.test(p) ? p.slice(1) : p).replace(/\/[^/]*$/, "");
}

export function noMatch(v, loc) { return new Error(`no match arm for value ${repr(v)} (${loc})`); }

export function show(v) { if (v !== undefined) print(v); }

export function eq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== "object" || typeof b !== "object") return a !== a && b !== b; // NaN == NaN
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
    return true;
  }
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (a instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !eq(v, b.get(k))) return false;
    return true;
  }
  if (a instanceof Set) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.hasOwn(b, k) || !eq(a[k], b[k])) return false;
  return true;
}

export function repr(x, seen = new Set()) {
  if (x === null || x === undefined) return "nil";
  switch (typeof x) {
    case "string": return JSON.stringify(x);
    case "number": return Object.is(x, -0) ? "0" : String(x);
    case "bigint": return `${x}n`;
    case "function": return `<fn ${x.name || "anonymous"}>`;
    case "symbol": return x.toString();
    case "boolean": return String(x);
  }
  if (seen.has(x)) return "<cycle>";
  seen.add(x);
  try {
    if (Array.isArray(x)) return `[${x.map((v) => repr(v, seen)).join(", ")}]`;
    if (x instanceof Error) return `${x.name}: ${x.message}`;
    if (x instanceof Date) return x.toISOString();
    if (x instanceof Map) return `Map{${[...x].map(([k, v]) => `${repr(k, seen)}: ${repr(v, seen)}`).join(", ")}}`;
    if (x instanceof Set) return `Set{${[...x].map((v) => repr(v, seen)).join(", ")}}`;
    const proto = Object.getPrototypeOf(x);
    const tag = proto && proto !== Object.prototype && proto.constructor?.name ? proto.constructor.name : "";
    if (tag && x.toString !== Object.prototype.toString) return `${tag}(${JSON.stringify(String(x))})`;
    const body = Object.keys(x).map((k) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${repr(x[k], seen)}`);
    return `${tag}{${body.join(", ")}}`;
  } finally {
    seen.delete(x);
  }
}

const toList = (xs) => (Array.isArray(xs) ? xs : xs == null ? [] : Array.from(xs));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------- prelude: core ----------

export function print(...xs) { console.log(xs.map(str).join(" ")); }
export function str(x) {
  if (typeof x === "string") return x;
  // objects with their own text form (URL, URLSearchParams, Error, class instances) use it; repr() keeps the debug view
  if (x && typeof x === "object" && !Array.isArray(x) && !(x instanceof Date) && x.toString !== Object.prototype.toString) return String(x);
  return repr(x);
}
export function num(x) { if (x == null || typeof x === "boolean") return null; const n = typeof x === "number" ? x : Number(typeof x === "string" ? x.trim() || NaN : x); return Number.isNaN(n) ? null : n; }
export function int(x) { const n = num(x); return n === null ? null : Math.trunc(n); }
export function type(x) {
  if (x == null) return "nil";
  if (Array.isArray(x)) return "list";
  switch (typeof x) {
    case "number": return "num";
    case "string": return "str";
    case "boolean": return "bool";
    case "function": return "fn";
    case "bigint": return "big";
  }
  return "obj";
}
export function len(x) {
  if (x == null) return 0;
  if (typeof x === "string" || Array.isArray(x)) return x.length;
  if (x instanceof Map || x instanceof Set) return x.size;
  return Object.keys(x).length;
}
export function assert(v, text = "assert", loc = "") { if (!v) throw new AssertError(`assertion failed: ${text}`, loc); return true; }
export function assertEq(a, b, text, loc) {
  if (!eq(a, b)) throw new AssertError(`assertion failed: ${text}\n  left:  ${repr(a)}\n  right: ${repr(b)}`, loc);
  return true;
}


// ---------- prelude: lists ----------

export function range(a, b, step = 1) {
  if (b === undefined) { b = a; a = 0; }
  if (!step) throw new Error("range step must not be 0");
  const out = [];
  if (step > 0) for (let i = a; i < b; i += step) out.push(i);
  else for (let i = a; i > b; i += step) out.push(i);
  return out;
}
export function map(xs, f) { return toList(xs).map((x, i) => f(x, i)); }
export function filter(xs, f) { return toList(xs).filter((x, i) => f(x, i)); }
export function reduce(xs, f, init) {
  const l = toList(xs);
  return arguments.length < 3 ? l.reduce((a, x) => f(a, x)) : l.reduce((a, x) => f(a, x), init);
}
export function each(xs, f) { let i = 0; for (const x of toList(xs)) f(x, i++); }
export function find(xs, f) { const r = toList(xs).find((x) => f(x)); return r === undefined ? null : r; }
export function index(xs, f) { const i = toList(xs).findIndex(typeof f === "function" ? f : (x) => eq(x, f)); return i < 0 ? null : i; }
export function any(xs, f = Boolean) { return toList(xs).some((x) => f(x)); }
export function all(xs, f = Boolean) { return toList(xs).every((x) => f(x)); }
export function count(xs, f) { if (!f) return len(xs); let n = 0; for (const x of toList(xs)) if (f(x)) n++; return n; }
export function sum(xs, f) { let s = 0; for (const x of toList(xs)) s += f ? f(x) : x; return s; }
export function min(...a) { const l = a.length === 1 ? toList(a[0]) : a; if (!l.length) return null; let m = l[0]; for (const x of l) if (x < m) m = x; return m; }
export function max(...a) { const l = a.length === 1 ? toList(a[0]) : a; if (!l.length) return null; let m = l[0]; for (const x of l) if (x > m) m = x; return m; }
export function sort(xs, key, desc = false) {
  const l = toList(xs).slice(), s = desc ? -1 : 1;
  return key ? l.sort((a, b) => s * cmp(key(a), key(b))) : l.sort((a, b) => s * cmp(a, b));
}
export function rev(xs) { return typeof xs === "string" ? [...xs].reverse().join("") : toList(xs).slice().reverse(); }
export function uniq(xs) { return [...new Set(toList(xs))]; }
export function flat(xs, depth = 1) { return toList(xs).flat(depth); }
export function zip(...ls) { const n = Math.min(...ls.map(len)); const out = []; for (let i = 0; i < n; i++) out.push(ls.map((l) => l[i])); return out; }
export function indexed(xs) { return toList(xs).map((x, i) => [i, x]); }
export function take(xs, n) { return xs.slice(0, n); }
export function drop(xs, n) { return xs.slice(n); }
export function first(xs) { return xs?.[0] ?? null; }
export function last(xs) { return xs?.length ? xs[xs.length - 1] : null; }
export function push(xs, ...vs) { xs.push(...vs); return xs; }
export function pop(xs) { return xs.length ? xs.pop() : null; }
export function slice(x, a, b) { return x.slice(a, b); }
export function join(xs, sep = "") { return toList(xs).map(str).join(sep); }
export function group(xs, f) {
  const out = {};
  for (const x of toList(xs)) (out[f(x)] ??= []).push(x);
  return out;
}
export function tally(xs, f) {
  const out = {};
  for (const x of toList(xs)) { const k = f ? f(x) : x; out[k] = (out[k] ?? 0) + 1; }
  return out;
}
export function chunk(xs, n) { const l = toList(xs), out = []; for (let i = 0; i < l.length; i += n) out.push(l.slice(i, i + n)); return out; }

// ---------- prelude: objects ----------

export function keys(o) { return o instanceof Map ? [...o.keys()] : Object.keys(o ?? {}); }
export function vals(o) { return o instanceof Map ? [...o.values()] : Object.values(o ?? {}); }
export function entries(o) { return o instanceof Map ? [...o.entries()] : Object.entries(o ?? {}); }
export function has(c, x) {
  if (c == null) return false;
  if (typeof c === "string") return c.includes(x);
  if (Array.isArray(c)) return c.some((v) => eq(v, x));
  if (c instanceof Map || c instanceof Set) return c.has(x);
  return Object.hasOwn(c, x);
}
export function get(o, k, d = null) { const v = o instanceof Map ? o.get(k) : o?.[k]; return v === undefined ? d : v; }
// removes keys from an object or Map (mutates) and returns it
export function del(o, ...ks) { for (const k of ks) o instanceof Map ? o.delete(k) : delete o[k]; return o; }
export function merge(...os) { return Object.assign({}, ...os); }
export function copy(x) { return structuredClone(x); }

// ---------- prelude: strings ----------

export function split(s, sep = "") { return s.split(sep); }
export function lines(s) { return s.split(/\r?\n/); }
export function trim(s) { return s.trim(); }
export function upper(s) { return s.toUpperCase(); }
export function lower(s) { return s.toLowerCase(); }
export function replace(s, a, b) { return s.replaceAll(a, b); }
export function starts(s, p) { return s.startsWith(p); }
export function ends(s, p) { return s.endsWith(p); }
export function chars(s) { return [...s]; }

// ---------- prelude: math ----------

export const abs = Math.abs, floor = Math.floor, ceil = Math.ceil, sqrt = Math.sqrt;
export function round(x, digits = 0) { const f = 10 ** digits; return Math.round(x * f) / f; }
export function rand() { return Math.random(); }
export function randint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

// ---------- prelude: data, io, system ----------

export function json(s) { return JSON.parse(s); }
export function tojson(x, pretty = false) { return JSON.stringify(x, null, pretty ? 2 : undefined); }
export function read(path) { return node("node:fs").readFileSync(path, "utf8"); }
export function write(path, s) { node("node:fs").writeFileSync(path, typeof s === "string" ? s : str(s)); return null; }
export function exists(path) { return node("node:fs").existsSync(path); }
export function sh(cmd) { return node("node:child_process").execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).replace(/\r?\n$/, ""); }
export function env(name, d = null) { return process.env[name] ?? d; }
export function exit(code = 0) { process.exit(code); }
export function now() { return Date.now(); }
export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
// live binding: the CLI calls setArgs() before running a program; built .mjs files keep argv
export let args = globalThis.process?.argv?.slice(2) ?? [];
export function setArgs(a) { args = a; }
