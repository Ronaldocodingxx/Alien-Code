# Alien error codes

Codes are stable: tools and agents may key on them. Never reuse a code for a different meaning.
New codes: pick the next free number in the matching range and add a test in `tests/errors/`.

| code | range / meaning | typical fix |
|---|---|---|
| E001 | unexpected character or invalid number literal | remove the character; numbers cannot touch letters (`2x` -> `2 * x`) |
| E002 | unterminated string / interpolation, bad escape | close `"`; for a literal `{` write `\{` |
| E010 | syntax error: unexpected or missing token | read `hint`; usually a missing `{ }`, `,` or newline between statements |
| E011 | `use` / `pub` / `test` not at top level, or `pub` before something other than `fn`/`:=` | move it to the top level of the file |
| E012 | right side of `\|>` is not a function or call | `xs \|> map(fn(x) x)` |
| E013 | `...` spread outside `[ ]`, `{ }` or call arguments | wrap it: `[...xs]` |
| E020 | unknown name (or `_` used as a value) | declare it with `:=`, fix the typo (see hint), or use `js.Name` for other JS globals |
| E021 | assignment to an undeclared name or to a built-in | first assignment must be `x := ...` |
| E022 | name declared twice in the same block | use `=` to reassign, or rename |
| E023 | `it` used outside a short-lambda slot, or declared as a variable | use `fn(x) ...`, or rename the variable |
| E030 | `ret` outside a function | remove it; the file's top level is not a function |
| E031 | `break` / `continue` outside a loop | |
| E032 | `ret`/`break`/`continue` inside an `if`/`match`/`try` that is used inside a larger expression | assign first (`x := if ...`) or use the `if` as a statement |
| E040 | invalid assignment target | assign to `name`, `obj.field` or `list[i]` |
| E041 | literal pattern outside `match` | bind a name, then compare |
| E050 | file or module not found | paths in `use` are relative to the importing file |
| E051 | `alien build` input outside the entry file's directory | move the module under the entry directory |
| E060 | `alien show/put`: no part with that name | run `alien map` for the exact names |
| E099 | internal compiler error | this is a compiler bug: add a failing test and fix `src/` |

Runtime errors are not coded; they report the JS error name, message and `.aln` file:line frames:
`{"kind": "runtime", "error": "TypeError", "msg": "...", "at": [{"file": "a.aln", "line": 3}]}`.
Set `ALIEN_DEBUG=1` to also print the raw JS stack.
