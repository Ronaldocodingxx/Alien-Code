# Roadmap

Ordered by priority. Agents: take the top item, follow the protocol in `AGENTS.md`,
remove it here when done and add anything new you discover. Keep each item one line + context.

## Next

1. **`alien fmt`** — canonical formatter (AST -> source). Needs comments preserved in the lexer
   (attach to the next token). Goal: one canonical layout, so agents never diff on whitespace.
2. **`alien repl`** — interactive loop that keeps top-level declarations between inputs.
3. **Runtime error instead of silent `NaN`** when `+=`/`-=` hit a missing field (found by agent test).
4. **Unused-variable and unreachable-code warnings** in `check --json` (`W` codes, not errors).
5. **Optional type annotations** `fn add(a: num, b: num) -> num`, checked by `alien check`
   (erased in output). Start with num/str/bool/list/obj/fn/nil and unions `num|nil`.
6. **`alien doc`** — print signatures + leading `#` comments of all `pub` items of a file as JSON,
   so an agent can learn a module's API without reading its source.
7. **Optional index with `?.[i]`** and optional calls `f?.()`.
8. **String patterns in match** with prefix: `"cmd:" ++ rest =>`; and range patterns `1..10 =>`.
9. **Browser build target** — `alien build --target web` (runtime without node:fs / child_process).
10. **Package manager story** — `use "npm:pkg"` resolving via the project's node_modules, `alien new`.
11. **Self-hosting** — rewrite the compiler in Alien once the language is stable enough.

## Ideas (not yet decided)

- `mean`/`avg` in the prelude; `sort` with a comparator fn (requested by agent test).
- WebAssembly backend for numeric hot loops.
- Built-in structured concurrency helpers (`parallel(list, fn)` with a concurrency limit).
- `defer` for cleanup.
- Token-count benchmark: same programs in Alien / JS / Python, measured with a real tokenizer,
  tracked in `bench/` to keep the language honest about its main goal.

## Done

- v0.1.0: lexer, parser, JS codegen with source maps, compile-time name checks, match, pipes,
  modules + JS interop, async, test blocks, `run/eval/test/check/emit/build/spec` CLI with `--json`.
