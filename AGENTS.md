# AGENTS.md — start here

This repo is **Alien**, a programming language designed for AI agents to write, read and
improve. It compiles `.aln` files to JavaScript and runs them on Node.js (>= 22.15).

- **To write Alien code:** read `docs/SPEC.md` (or run `node bin/alien.js spec`). It is the whole language.
- **To improve Alien itself:** follow the protocol below.

## Commands

```
node bin/alien.js run file.aln       # or `alien run` after `npm link`
node bin/alien.js check --json path  # compile only, machine-readable errors
node bin/alien.js test path          # run test blocks
node bin/alien.js emit file.aln      # see the generated JS
npm test                             # full compiler test suite — must pass before you finish
```

## Architecture (≈1800 lines, no dependencies)

```
src/lexer.js     source -> tokens (newline handling, string interpolation)
src/parser.js    tokens -> AST (precedence table PREC, patterns, match, pipes)
src/codegen.js   AST -> JS + source map; name resolution and compile-time checks live here
src/runtime.js   prelude functions + internal helpers ($rt.*) used by generated code
src/prelude.js   prelude name list (derived from runtime.js exports)
src/compile.js   public API: compile(src, opts) -> {code, deps}
std/*.aln        standard library, written in Alien (`use "alien:web"`); keep it Alien, not JS
bin/alien.js     CLI, module loader hook (.aln imports), test runner, error formatting
tests/run.js     test suite (cases/, errors/, unit/, examples/)
docs/            SPEC (language), ERRORS (codes), ROADMAP (what to do next)
```

Pipeline: `lex -> parse -> generate`. The loader hook in `bin/alien.js` compiles `.aln` on import,
so `.aln` files import each other directly. `alien build` writes `.mjs` files instead.

## Design principles (use these to decide every change)

1. **One obvious way.** Do not add a second syntax for something that already exists.
2. **Fewer tokens, zero ambiguity.** Prefer short common English words (1 token each) and ASCII.
   Never trade clarity for brevity: an agent must be able to predict the meaning from the spec alone.
3. **No significant whitespace.** Indentation never changes meaning.
4. **Fail at compile time.** If a mistake can be detected statically, make it an error with a
   stable code and a `hint` that states the fix.
5. **Machine-readable everything.** Every CLI command supports `--json`.
6. **JS speed.** Generated code should be what a careful human would write in JS. Avoid runtime
   helpers in hot paths; check with `alien emit` and `bench/`.
7. **JS values are Alien values.** Interop must stay free (no wrappers, no conversion).
8. **The spec must stay small.** `docs/SPEC.md` should be readable in one pass (target < 4k tokens).
   If a feature needs a long explanation, it is probably the wrong feature.

## Protocol for improving Alien

1. Run `npm test` first. If it fails before you changed anything, fix that first.
2. Pick the top unfinished item in `docs/ROADMAP.md` (or the task you were given).
   If it conflicts with the design principles, say so instead of implementing it.
3. Write the test first:
   - behavior: `tests/cases/<name>.aln` + expected stdout in `<name>.out`
     (generate with `node tests/run.js --update`, then **read the .out file and verify it by hand**)
   - compile errors: `tests/errors/<name>.aln` whose first line is `# expect: E0xx`
   - assertions: `test "..." { assert(...) }` blocks in `tests/unit/*_test.aln`
4. Implement in `src/`. Match the existing style: small functions, short comments explaining *why*.
5. Update `docs/SPEC.md` (language), `docs/ERRORS.md` (new codes), `CHANGELOG.md`
   (under `## Unreleased`), and `docs/ROADMAP.md` (remove done items, add ideas you discovered).
6. Run `npm test`; everything must pass. Check `alien emit` output for the feature looks like clean JS.
7. Versioning (pre-1.0): new feature -> bump minor in `package.json` when releasing; bug fix -> patch.
   A change that breaks existing Alien code must be listed under **BREAKING** in `CHANGELOG.md`
   together with how to migrate.
8. Commit with a message like `feat: add X` / `fix: Y` (only if the human asked you to commit).

Never delete or weaken an existing test to make a change pass, unless the change is an intentional,
documented breaking change.

## Writing Alien programs (quick reference)

```
x := 1                          # declare;  x = 2 reassigns
fn add(a, b) a + b              # last expression is the return value
xs |> filter(fn(x) x > 1) |> map(fn(x) x * 2)
if c { a } else { b }           # expression
match v { 0 => "zero", [a, b] => a + b, _ => "other" }
for x in xs { }   for i in 0..n { }   while c { }
use "./lib.aln" as lib          # pub fn ... to export
test "name" { assert(add(1, 2) == 3) }
```

Before running a program you wrote, run `alien check --json file.aln` and fix every error.
