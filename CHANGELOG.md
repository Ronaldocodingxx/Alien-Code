# Changelog

All notable changes. Agents: add entries under `## Unreleased`; mark breaking changes with **BREAKING**.

## Unreleased

## 0.1.0 — 2026-10-24

- `round(x, digits)`, `sort(xs, key, desc)`; `{` + `key:` starts an object literal as fn/match-arm body.
- First version: `.aln` -> JavaScript compiler with source maps (runtime errors point to `.aln` lines).
- Syntax: `:=` declarations, expression-oriented `if`/`match`/`try`, `fn`, `|>` pipes with `_` slot,
  ranges, destructuring, string interpolation, `use`/`pub` modules, `test` blocks.
- Compile-time checks: unknown names (with suggestions), undeclared assignment, redeclaration,
  misplaced `ret`/`break`/`continue`.
- Prelude of ~70 functions; full JS interop (globals, methods, npm modules, `new`).
- CLI: `run`, `eval`, `test`, `check`, `emit`, `build`, `spec`, all with `--json`.
