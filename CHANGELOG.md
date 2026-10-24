# Changelog

All notable changes. Agents: add entries under `## Unreleased`; mark breaking changes with **BREAKING**.

## Unreleased

## 0.5.0 — 2026-10-24

From the feedback of two independent agents building the same Kanban app, and an A/B test against JavaScript:
- Fix: `css()` with selector lists and `&` (`".a, .b": {"&:focus"}` now gives `.a:focus, .b:focus`, like Sass).
- Fix: `str()` / string interpolation use an object's own `toString` (URL, URLSearchParams); `repr` shows `URL("...")`.
- Web: urlencoded form bodies parsed, `req.cookies`, cookies in `reply`/`redirect` with secure defaults,
  `redirect` defaults to 303 and takes `{status, cookies, headers}`, wildcard routes (`"/files/*"`, `"*"` = 404 page),
  `h.json(id, value)` for safe data embedding, browser code may import .aln files from other folders, `css(a, b, ...)`.
- **BREAKING (small):** `redirect(url)` answers 303 instead of 302 (use `redirect(url, {status: 302})` for the old behavior).
- Language: `.5` number literals, `x?.[i]` and `f?.(args)`, `del(obj, ...keys)`, clear error for `fn f() for ...`.
- Tools: `alien put file` without a name replaces several parts at once; `put` can repair files that do not parse;
  `alien map` names event handlers `on:click`.

## 0.4.0 — 2026-10-24

- Code map for agents: `alien map` (parts with lines, ~tokens, uses/used-by, doc comments), `alien show`
  (read only named parts), `alien put` (replace/append/delete one part by name; refuses changes that break the build).
  Measured on a 150-line site: changing one function costs 342 instead of 2280 tokens (-85%).
- Match pattern `[...]` / `{}` docs; error code E060.

## 0.3.0 — 2026-10-24

- `it` short lambdas: `users |> filter(it.age >= 18) |> map(it.name)` (E023 when misused).
- Match patterns `[...]` (any list) and `{}` (any object, not a list).
- `tally(xs, keyFn?)` counts occurrences.
- Token benchmark `npm run bench:tokens` (5 tasks, o200k tokenizer). Totals: Alien 443, Python 487 (-9%), JavaScript 603 (-27%).

## 0.2.0 — 2026-10-24

- **Websites in pure Alien**: standard library `alien:web` (`serve` with routes/params/JSON/static files,
  `h.*` HTML builders, `css`, `page`, `reply`, `redirect`, `client` = browser code written in Alien,
  compiled on request) and browser-safe `alien:html`. Both are written in Alien (`std/`).
- `here`: directory of the current file.
- `use "alien:name"` imports standard library modules; `alien build` bundles them under `_alien/`.
- Runtime no longer imports node modules statically, so it also runs in browsers.
- Browser globals (`document`, `window`, `localStorage`, ...) are known names.

## 0.1.0 — 2026-10-24

- `round(x, digits)`, `sort(xs, key, desc)`; `{` + `key:` starts an object literal as fn/match-arm body.
- First version: `.aln` -> JavaScript compiler with source maps (runtime errors point to `.aln` lines).
- Syntax: `:=` declarations, expression-oriented `if`/`match`/`try`, `fn`, `|>` pipes with `_` slot,
  ranges, destructuring, string interpolation, `use`/`pub` modules, `test` blocks.
- Compile-time checks: unknown names (with suggestions), undeclared assignment, redeclaration,
  misplaced `ret`/`break`/`continue`.
- Prelude of ~70 functions; full JS interop (globals, methods, npm modules, `new`).
- CLI: `run`, `eval`, `test`, `check`, `emit`, `build`, `spec`, all with `--json`.
