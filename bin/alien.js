#!/usr/bin/env node
// Alien CLI. `alien help` lists commands. Every command accepts --json for
// machine-readable output (one JSON object on stdout).

import { registerHooks } from "node:module";
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, relative, dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { compile } from "../src/compile.js";
import { AlienError } from "../src/errors.js";
import { mapSource, findPart, replacePart } from "../src/map.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const RUNTIME = join(ROOT, "src", "runtime.js");
const RUNTIME_URL = pathToFileURL(RUNTIME).href;
const STD = join(ROOT, "std");
const stdSpec = (n) => pathToFileURL(join(STD, `${n}.aln`)).href;

const HELP = `alien ${VERSION} - a programming language for AI agents

usage:
  alien run <file.aln> [args...]   compile + run (args available as \`args\`)
  alien eval "<code>"              run code, print value of last expression
  alien test [file|dir ...]        run test blocks (dir: *_test.aln + files with tests)
  alien check <file|dir ...>       compile only, report all errors
  alien map <file|dir>             index of a file's parts: lines, size, uses / used by
  alien show <file> <name...>      print only these parts (name or a line number)
  alien put <file> <name>          replace part <name> with code from stdin (or --code "..."),
                                   append if new, --delete to remove; refuses if it breaks the build
  alien emit <file.aln>            print generated JavaScript
  alien build <file.aln> [-o dir]  write standalone .mjs files (default dir: dist)
  alien spec                       print the language spec (read this first)
  alien version

flags:
  --json    machine-readable output for agents`;

const sources = new Map(); // displayFile -> source, for error snippets
const virtual = new Map(); // url -> source (alien eval)
let printLastUrl = null;

const disp = (p) => {
  const r = relative(process.cwd(), p);
  return (r && !r.startsWith("..") && !/^[A-Za-z]:/.test(r) ? r : p).replace(/\\/g, "/");
};

function compileFile(abs, src, extra = {}) {
  const displayFile = disp(abs);
  sources.set(displayFile, src);
  return compile(src, { displayFile, runtimeUrl: RUNTIME_URL, stdSpec, sourceUrl: pathToFileURL(abs).href, ...extra });
}

let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  process.setSourceMapsEnabled(true);
  registerHooks({
    resolve(spec, ctx, next) {
      if (virtual.has(spec)) return { url: spec, shortCircuit: true };
      return next(spec, ctx);
    },
    load(url, ctx, next) {
      if (!url.endsWith(".aln")) return next(url, ctx);
      const abs = fileURLToPath(url);
      const src = virtual.get(url) ?? readFileSync(abs, "utf8");
      return { format: "module", source: compileFile(abs, src, { printLast: url === printLastUrl }).code, shortCircuit: true };
    },
  });
}

// ---------- error reporting ----------

function frames(e) {
  const out = [], seen = new Set();
  for (const m of String(e?.stack ?? "").matchAll(/(file:\/\/[^\s)]+?\.aln|[A-Za-z]:\\[^\s)]+?\.aln|\/[^\s)]+?\.aln):(\d+):(\d+)/g)) {
    const f = { file: disp(m[1].startsWith("file:") ? fileURLToPath(m[1]) : m[1]), line: +m[2] };
    const key = `${f.file}:${f.line}`;
    if (!seen.has(key)) { seen.add(key); out.push(f); }
  }
  return out;
}

function errorInfo(e) {
  if (e instanceof AlienError) return { kind: "compile", ...e.toJSON() };
  if (e?.code === "ERR_MODULE_NOT_FOUND") return { kind: "compile", code: "E050", msg: e.message.split("\n")[0], hint: "check the path in your use statement" };
  return { kind: "runtime", error: e?.name ?? "Error", msg: e?.message ?? String(e), at: frames(e) };
}

function formatError(e) {
  if (e instanceof AlienError) return e.format(sources.get(e.file));
  const info = errorInfo(e);
  if (info.kind === "compile") return `error[${info.code}]: ${info.msg}\n  hint: ${info.hint}`;
  let s = `runtime error: ${info.error}: ${info.msg}`;
  for (const f of info.at) {
    const text = sources.get(f.file)?.split("\n")[f.line - 1];
    s += `\n  at ${f.file}:${f.line}${text ? `   ${text.trim()}` : ""}`;
  }
  return s;
}

let JSON_OUT = false;
function fail(e) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, errors: [errorInfo(e)] }));
  else { if (process.env.ALIEN_DEBUG) console.error(e?.stack); console.error(formatError(e)); }
  process.exit(1);
}

// ---------- files ----------

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".") || ent.name === "node_modules" || ent.name === "dist") continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith(".aln")) out.push(p);
  }
  return out;
}

function expand(targets, filter) {
  const files = [];
  for (const t of targets.length ? targets : ["."]) {
    const abs = resolve(t);
    if (!existsSync(abs)) throw new AlienError("E050", `file not found: ${t}`, t, 1, 1);
    if (statSync(abs).isDirectory()) files.push(...walk(abs).filter(filter ?? (() => true)));
    else files.push(abs);
  }
  return [...new Set(files)];
}

const hasTests = (f) => f.endsWith("_test.aln") || /^\s*test\s+"/m.test(readFileSync(f, "utf8"));

// compile a file and all .aln files it uses; returns { files: [abs], errors: [AlienError], results: Map }
function compileGraph(entries, extra = {}) {
  const seen = new Set(), errors = [], results = new Map();
  const visit = (abs, from) => {
    if (seen.has(abs)) return;
    seen.add(abs);
    if (!existsSync(abs)) {
      errors.push(from ? new AlienError("E050", `module not found: ${from.path}`, from.file, from.line, from.col, "check the path; it is relative to the importing file")
        : new AlienError("E050", `file not found: ${disp(abs)}`, disp(abs), 1, 1));
      return;
    }
    try {
      const r = compileFile(abs, readFileSync(abs, "utf8"), extra);
      results.set(abs, r);
      for (const d of r.deps) {
        if (d.std != null) visit(join(STD, `${d.std}.aln`), { ...d, file: disp(abs) });
        else if (d.path.startsWith(".")) visit(resolve(dirname(abs), d.path), { ...d, file: disp(abs) });
      }
    } catch (e) {
      if (e instanceof AlienError) errors.push(e);
      else throw e;
    }
  };
  for (const e of entries) visit(e, null);
  return { files: [...seen], errors, results };
}

// ---------- commands ----------

async function cmdRun([file, ...rest]) {
  if (!file) throw new AlienError("E050", "missing file: alien run <file.aln>", "<cli>", 1, 1);
  const abs = resolve(file);
  if (!existsSync(abs)) throw new AlienError("E050", `file not found: ${file}`, file, 1, 1);
  (await import(RUNTIME_URL)).setArgs(rest);
  hook();
  await import(pathToFileURL(abs).href);
}

async function cmdEval([code]) {
  if (code === undefined) throw new AlienError("E050", 'missing code: alien eval "1 + 2"', "<cli>", 1, 1);
  const url = pathToFileURL(join(process.cwd(), "__eval__.aln")).href;
  virtual.set(url, code);
  printLastUrl = url;
  (await import(RUNTIME_URL)).setArgs([]);
  hook();
  await import(url);
}

function cmdCheck(targets) {
  const { files, errors } = compileGraph(expand(targets));
  if (JSON_OUT) console.log(JSON.stringify({ ok: !errors.length, files: files.length, errors: errors.map((e) => e.toJSON()) }));
  else {
    for (const e of errors) console.error(e.format(sources.get(e.file)) + "\n");
    console.log(errors.length ? `${errors.length} error(s) in ${files.length} file(s)` : `ok (${files.length} file(s))`);
  }
  if (errors.length) process.exitCode = 1;
}

// ---------- code map: read and edit big files part by part ----------

function readAln(file) {
  const abs = resolve(file ?? "");
  if (!file || !existsSync(abs)) throw new AlienError("E050", `file not found: ${file ?? "(missing)"}`, file ?? "<cli>", 1, 1);
  const src = readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
  sources.set(disp(abs), src);
  return { abs, src, display: disp(abs) };
}

function fmtPart(p) {
  const range = p.from === p.to ? `${p.from}` : `${p.from}-${p.to}`;
  const sig = p.kind === "fn" ? (/fn\s+(\w+\([^)]*\))/.exec(p.sig)?.[1] ?? p.name) : p.kind === "stmt" ? `${p.name}  ${p.sig}` : p.name;
  let s = `  ${range.padEnd(8)} ${p.kind.padEnd(4)} ${sig}  ~${p.tok}`;
  if (p.uses.length) s += `  uses:${p.uses.join(",")}`;
  if (p.usedBy.length) s += `  by:${p.usedBy.join(",")}`;
  if (p.doc) s += `  # ${p.doc.slice(0, 80)}`;
  return s;
}

function cmdMap(targets) {
  const maps = expand(targets).map((abs) => { const { src, display } = readAln(abs); return mapSource(src, display); });
  if (JSON_OUT) return console.log(JSON.stringify(maps.length === 1 ? maps[0] : maps));
  for (const m of maps) console.log(`${m.file}  ${m.lines} lines ~${m.tok} tok\n${m.parts.map(fmtPart).join("\n")}`);
}

function cmdShow([file, ...names]) {
  const { src, display } = readAln(file);
  const m = mapSource(src, display);
  const lines = src.split("\n");
  const out = [];
  for (const n of names) {
    const p = findPart(m, n);
    if (!p) throw new AlienError("E060", `no part named '${n}' in ${display}`, display, 1, 1, "run alien map to list part names");
    out.push({ name: p.name, from: p.from, to: p.to, code: lines.slice(p.from - 1, p.to).join("\n") });
  }
  if (JSON_OUT) console.log(JSON.stringify(out));
  else console.log(out.map((p) => `# ${display}:${p.from}-${p.to} ${p.name}\n${p.code}`).join("\n\n"));
}

// replace one part by name (or append when the name is new); only writes if the whole file still compiles
async function cmdPut(argv) {
  const [file, name] = argv;
  const del = argv.includes("--delete");
  const ci = argv.indexOf("--code");
  let code = ci >= 0 ? argv[ci + 1] : null;
  if (!name) throw new AlienError("E060", "usage: alien put <file.aln> <name> [--code \"...\" | --delete]  (code from stdin otherwise)", "<cli>", 1, 1);
  if (del) code = "";
  if (code === null) { const chunks = []; for await (const c of process.stdin) chunks.push(c); code = Buffer.concat(chunks).toString("utf8"); }
  const { abs, src, display } = readAln(file);
  const next = del ? replacePart(src, display, name, "").replace(/\n\n\n+/g, "\n\n") : replacePart(src, display, name, code);
  compileFile(abs, next); // throws -> file stays unchanged
  writeFileSync(abs, next);
  const p = del ? null : findPart(mapSource(next, display), /^\d+$/.test(name) ? name : code.match(/^\s*(?:pub\s+)?fn\s+(\w+)|^\s*(?:pub\s+)?(\w+)\s*:=/m)?.slice(1).find(Boolean) ?? name);
  const info = { ok: true, file: display, part: p ? { name: p.name, from: p.from, to: p.to } : null, deleted: del };
  if (JSON_OUT) console.log(JSON.stringify(info));
  else console.log(del ? `ok: deleted ${name} from ${display}` : `ok: ${display}:${p ? `${p.from}-${p.to} ${p.name}` : name}`);
}

function cmdEmit([file]) {
  const abs = resolve(file ?? "");
  const r = compileFile(abs, readFileSync(abs, "utf8"), { map: false });
  process.stdout.write(r.code);
}

function cmdBuild(argv) {
  let out = "dist";
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-o") out = argv[++i];
    else files.push(argv[i]);
  }
  if (!files.length) throw new AlienError("E050", "missing file: alien build <file.aln> [-o dir]", "<cli>", 1, 1);
  const outDir = resolve(out);
  const base = dirname(resolve(files[0]));
  // layout: <out>/<your files>.mjs, <out>/_alien/std/*.mjs (alien: modules), <out>/_alien/src/ (runtime + compiler)
  const lib = join(outDir, "_alien");
  const spec = (fromDir, to) => { const r = relative(fromDir, to).replace(/\\/g, "/"); return r.startsWith(".") ? r : `./${r}`; };
  const written = [];
  const { errors, results } = compileGraph(files.map((f) => resolve(f)), { alnExt: ".mjs" });
  if (errors.length) throw errors[0];
  for (const abs of results.keys()) {
    const inStd = !relative(STD, abs).startsWith("..");
    const rel = relative(inStd ? STD : base, abs);
    if (rel.startsWith("..")) throw new AlienError("E051", `cannot build ${disp(abs)}: it is outside ${disp(base)}`, disp(abs), 1, 1);
    const target = join(inStd ? join(lib, "std") : outDir, rel.replace(/\.aln$/, ".mjs"));
    const dir = dirname(target);
    const r = compileFile(abs, readFileSync(abs, "utf8"), {
      alnExt: ".mjs",
      runtimeUrl: spec(dir, join(lib, "src", "runtime.js")),
      stdSpec: (n) => spec(dir, join(lib, "std", `${n}.mjs`)),
    });
    mkdirSync(dir, { recursive: true });
    writeFileSync(target, r.code);
    written.push(disp(target));
  }
  mkdirSync(join(lib, "src"), { recursive: true });
  for (const f of readdirSync(join(ROOT, "src"))) copyFileSync(join(ROOT, "src", f), join(lib, "src", f));
  writeFileSync(join(lib, "package.json"), JSON.stringify({ type: "module" }));
  written.push(disp(join(lib, "src")) + "/ (runtime)");
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, files: written }));
  else console.log(`built:\n  ${written.join("\n  ")}\nrun with: node ${written[0]}`);
}

async function cmdTest(targets) {
  const files = expand(targets, hasTests);
  (await import(RUNTIME_URL)).setArgs([]);
  hook();
  const RT = await import(RUNTIME_URL);
  const results = [], loadErrors = [];
  for (const f of files) {
    try { await import(pathToFileURL(f).href); } catch (e) { loadErrors.push({ file: disp(f), ...errorInfo(e), text: formatError(e) }); }
  }
  const t0 = performance.now();
  for (const t of RT.tests) {
    const start = performance.now();
    try {
      await t.fn();
      results.push({ name: t.name, file: t.file, line: t.line, ok: true, ms: +(performance.now() - start).toFixed(2) });
    } catch (e) {
      results.push({ name: t.name, file: t.file, line: t.line, ok: false, msg: e?.message ?? String(e), at: e?.loc ? [e.loc] : frames(e).map((f) => `${f.file}:${f.line}`) });
    }
  }
  const failed = results.filter((r) => !r.ok).length + loadErrors.length;
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: !failed, passed: results.length - failed + loadErrors.length, failed, tests: results, loadErrors: loadErrors.map(({ text, ...x }) => x) }));
  } else {
    for (const le of loadErrors) console.log(`LOAD ${le.file}\n  ${le.text.replace(/\n/g, "\n  ")}`);
    for (const r of results) {
      if (r.ok) console.log(`ok   ${r.name}  (${r.file}:${r.line})`);
      else console.log(`FAIL ${r.name}  (${r.file}:${r.line})\n  ${r.msg.replace(/\n/g, "\n  ")}${r.at.length ? `\n  at ${r.at.join(", ")}` : ""}`);
    }
    console.log(`\n${results.length - (failed - loadErrors.length)} passed, ${failed} failed (${files.length} file(s), ${(performance.now() - t0).toFixed(0)}ms)`);
  }
  if (failed) process.exitCode = 1;
}

// ---------- main ----------

const argv = process.argv.slice(2);
const cmd = argv.shift();
// flags are only read before the file for `run`, so program args pass through untouched
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--json" && (cmd !== "run" || rest.length === 0)) JSON_OUT = true;
  else if (cmd === "run" && rest.length === 0 && argv[i] === "--") continue;
  else rest.push(argv[i]);
}

process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

try {
  switch (cmd) {
    case "run": await cmdRun(rest); break;
    case "eval": await cmdEval(rest); break;
    case "test": await cmdTest(rest); break;
    case "check": cmdCheck(rest); break;
    case "emit": cmdEmit(rest); break;
    case "map": cmdMap(rest); break;
    case "show": cmdShow(rest); break;
    case "put": await cmdPut(rest); break;
    case "build": cmdBuild(rest); break;
    case "spec": process.stdout.write(readFileSync(join(ROOT, "docs", "SPEC.md"), "utf8")); break;
    case "version": case "--version": case "-v": console.log(VERSION); break;
    case undefined: case "help": case "--help": case "-h": console.log(HELP); break;
    default:
      if (cmd.endsWith(".aln")) await cmdRun([cmd, ...rest]);
      else { console.error(`unknown command '${cmd}'\n\n${HELP}`); process.exitCode = 1; }
  }
} catch (e) {
  fail(e);
}
