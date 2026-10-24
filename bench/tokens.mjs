// Token benchmark: the same tasks in Alien, Python and JavaScript (bench/tokens/<task>.{aln,py,js}).
// Run: npm run bench:tokens   (add --json for machine-readable output)
// Tokenizer: OpenAI o200k_base as a public proxy; Claude's tokenizer differs in detail but not in trend.
// Rule for language changes: the Alien total must not get worse (see AGENTS.md).

import { getEncoding } from "js-tiktoken";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "tokens");
const enc = getEncoding("o200k_base");
const count = (f) => enc.encode(readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n").trim()).length;
const LANGS = ["aln", "py", "js"];

const tasks = [...new Set(readdirSync(dir).map((f) => f.replace(/\.\w+$/, "")))].sort();
const rows = tasks.map((t) => ({ task: t, ...Object.fromEntries(LANGS.map((l) => [l, count(`${t}.${l}`)])) }));
const total = Object.fromEntries(LANGS.map((l) => [l, rows.reduce((s, r) => s + r[l], 0)]));

if (process.argv.includes("--json")) console.log(JSON.stringify({ rows, total }));
else {
  const pct = (a, b) => `${a <= b ? "" : "+"}${Math.round((a / b - 1) * 100)}%`;
  console.log("task".padEnd(12), "alien".padStart(6), "python".padStart(7), "js".padStart(6), "  alien vs py / js");
  for (const r of [...rows, { task: "TOTAL", ...total }])
    console.log(r.task.padEnd(12), String(r.aln).padStart(6), String(r.py).padStart(7), String(r.js).padStart(6), `  ${pct(r.aln, r.py)} / ${pct(r.aln, r.js)}`);
}
