// Test suite for the Alien compiler. Run: npm test
//   tests/cases/*.aln   run, stdout must equal the matching .out file (files without .out are helpers)
//   tests/errors/*.aln  `alien check --json` must report the code in the first line: "# expect: E020"
//   tests/unit, examples  `alien test` must pass
// Update expected output after an intentional change: node tests/run.js --update

import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin", "alien.js");
const UPDATE = process.argv.includes("--update");
const alien = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8" });
const norm = (s) => s.replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`ok   ${name}`); };
const bad = (name, why) => { fail++; console.log(`FAIL ${name}\n  ${why.replace(/\n/g, "\n  ")}`); };

for (const f of readdirSync(join(ROOT, "tests/cases")).filter((f) => f.endsWith(".aln")).sort()) {
  const outFile = join(ROOT, "tests/cases", f.replace(/\.aln$/, ".out"));
  const r = alien("run", `tests/cases/${f}`);
  if (UPDATE && r.status === 0) { writeFileSync(outFile, norm(r.stdout)); ok(`case ${f} (updated)`); continue; }
  if (!existsSync(outFile)) continue;
  if (r.status !== 0) { bad(`case ${f}`, `exit ${r.status}\n${r.stderr}`); continue; }
  const want = norm(readFileSync(outFile, "utf8"));
  if (norm(r.stdout) === want) ok(`case ${f}`);
  else bad(`case ${f}`, `--- want\n${want}--- got\n${norm(r.stdout)}`);
}

for (const f of readdirSync(join(ROOT, "tests/errors")).filter((f) => f.endsWith(".aln")).sort()) {
  const src = readFileSync(join(ROOT, "tests/errors", f), "utf8");
  const want = /# expect: (E\d+)/.exec(src)?.[1];
  const r = alien("check", "--json", `tests/errors/${f}`);
  let got;
  try { got = JSON.parse(r.stdout).errors.map((e) => e.code); } catch { got = [`unparseable: ${r.stdout}${r.stderr}`]; }
  if (got.includes(want)) ok(`error ${f} -> ${want}`);
  else bad(`error ${f}`, `want ${want}, got ${got.join(",") || "no error"}`);
}

for (const dir of ["tests/unit", "examples"]) {
  const r = alien("test", "--json", dir);
  let res;
  try { res = JSON.parse(r.stdout); } catch { bad(`alien test ${dir}`, r.stdout + r.stderr); continue; }
  for (const t of res.tests) t.ok ? ok(`test ${t.name}`) : bad(`test ${t.name} (${t.file}:${t.line})`, t.msg);
  for (const e of res.loadErrors) bad(`load ${e.file}`, e.msg);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
