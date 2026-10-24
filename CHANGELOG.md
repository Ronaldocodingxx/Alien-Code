# Changelog

All notable changes. Agents: add entries under `## Unreleased`; mark breaking changes with **BREAKING**.

## Unreleased

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
