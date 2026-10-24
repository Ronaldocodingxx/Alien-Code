# Alien language spec (v0.1) — for AI agents

Alien compiles to JavaScript (ES modules) and runs on Node.js at JS speed. Values ARE JS values:
every JS method, global and npm package works. File extension: `.aln`.
Read this whole file once; it is the complete language.

## Rules that differ from JS/Python (read first)

1. `x := 1` declares. `x = 2` reassigns. Assigning an undeclared name is a compile error.
2. Indentation is meaningless. Blocks are always `{ }`. Statements end at newline or `;`.
3. Everything is an expression. A block's value is its last expression. Functions return their last expression; `ret` returns early.
4. `==` is deep structural equality (`[1,2] == [1,2]` is true). `nil` equals only `nil` (covers JS null and undefined).
5. Unknown names are compile errors (with "did you mean"). Run `alien check` before running.
6. In strings, `{expr}` interpolates. Write `\{` `\}` for literal braces (e.g. JSON text).
7. No classes, no `this`. Use objects + functions. Use `new` only for JS classes (`new Map()`).
8. A function containing `await` is automatically async. Top-level `await` is allowed.

## Lexical

- Comment: `#` to end of line.
- Names: `[A-Za-z_][A-Za-z0-9_]*`. JS reserved words are allowed as names (they are renamed internally).
- Numbers: `42` `3.14` `1_000_000` `0xff` `0b1010` `1e9`. All numbers are JS doubles.
- Strings: `"..."` only (may span lines). Escapes: `\n \t \r \0 \\ \" \{ \} \u{1F600}`.
- Keywords: `fn ret if else for in while break continue match try catch throw use as pub test new await true false nil`
- A newline does NOT end a statement inside `( )` or `[ ]`, after a binary operator, or when the next line starts with `.` `?.` `|>` `&&` `||` `??` `else` `catch`.

## Values

| kind | literal | `type(x)` |
|---|---|---|
| number | `1`, `2.5` | `"num"` |
| string | `"hi {name}"` | `"str"` |
| bool | `true` `false` | `"bool"` |
| nil | `nil` | `"nil"` |
| list | `[1, 2, ...more]` | `"list"` |
| object | `{a: 1, b, "k k": 2, [expr]: 3, ...other}` | `"obj"` |
| function | `fn(x) x * 2` | `"fn"` |

Missing object fields read as `nil`; arithmetic on them gives `NaN` (JS behavior), so initialize counters.
Truthiness is JS truthiness (`0`, `""`, `nil`, `false`, `NaN` are falsy). Trailing commas are allowed.

## Operators (lowest to highest precedence)

```
|>                  pipe: a |> f(b) is f(a, b);  a |> f is f(a);  a |> f(b, _) is f(b, a)
??                  nil-coalescing
||  &&              logical (return an operand, like JS)
==  !=              deep equality
<  <=  >  >=
..  ..=             ranges: 0..3 is [0,1,2]; 1..=3 is [1,2,3]
+  -                + also concatenates strings
*  /  //  %         // is floor division
**                  power (right assoc): -2 ** 2 is -4
-x  !x  await x     unary
f(x)  a[i]  a.b  a?.b   postfix
```

Assignment operators (statements only, never inside expressions): `:=  =  +=  -=  *=  /=`

## Declarations and assignment

```
x := 1                    # declare (mutable)
x = x + 1                 # reassign
x += 1
[a, b, ...rest] := list   # destructure list; _ skips: [_, second] := xs
{name, age: years} := person
obj.field = 1
list[0] = 2
```

Redeclaring a name in the same block is an error; shadowing in an inner block is allowed.

## Functions

```
fn add(a, b = 0) a + b              # single-expression body
fn greet(name) {                    # block body: value of last expression is returned
  msg := "hi {name}"
  msg
}
fn first([h, ..._t]) h              # params can be patterns
fn total(...nums) sum(nums)         # rest param
double := fn(x) x * 2               # function value (lambda)
mk := fn(x) {v: x, n: 1}            # returns an object: `{` + `key:` / `key,` / `"key":` / `...` is an object
fn find(xs, t) {
  for x in xs { if x == t { ret x } }   # ret = early return
  nil
}
```

`fn f() {}` has an empty block body (returns nil); `x := {}` is an empty object.
Named `fn` declarations are hoisted within their block (mutual recursion works). Closures capture variables.

## Control flow (all are expressions)

```
size := if n > 100 { "big" } else if n > 10 { "mid" } else { "small" }   # missing else -> nil

for x in list { ... }               # lists, strings, Maps, Sets, any JS iterable
for i in 0..n { ... }               # compiles to a plain counting loop (fast)
for [i, x] in indexed(list) { ... }
for [k, v] in entries(obj) { ... }  # objects are not iterable; use keys/vals/entries
while cond { ... }
break  continue

r := try { risky() } catch e { "failed: {e.message}" }   # catch name optional: catch { ... }
throw "message"                     # throw string -> Error(message); throw any value works
```

Inside a function or loop, `ret`/`break`/`continue` work in statement position and in `x := if ...`,
but not inside an `if`/`match`/`try` nested in a larger expression like `1 + if ...` (E032).

## match

```
desc := match value {
  0 => "zero"                             # literal: number, string, true, false, nil
  1 | 2 | 3 => "small"                    # alternatives (literals only)
  [a, b] => "pair {a} {b}"                # list of exactly 2
  [h, ...t] => "head {h}"                 # list of >= 1
  {type: "circle", r} => 3.14 * r * r     # object having these keys; nested patterns allowed
  n if n > 100 => "big"                   # name binds anything; `if` adds a guard
  _ => { other(); "other" }               # _ matches anything; block body
}
```

Arms are tried top to bottom. Arms are separated by newlines or commas. An arm body is an
expression, a `{ block }` (needed for statements like `for`), or `ret x` / `break` / `continue` / `throw x`. No matching arm throws an error.

## Modules

```
use "./util.aln" as util          # namespace import: util.fnName
use "./util.aln" {parse, fmt as f} # named imports
use "node:fs" as fs               # any JS module / npm package (default export if present)
use "node:path" {join}
pub fn helper(x) x                # export a function
pub VERSION := "1.0"              # export a value
```

`use` and `pub` only at top level. Paths are relative to the importing file.
`here` is the directory of the current file: `read("{here}/data.txt")` works from any working directory.
Standard library modules: `use "alien:web" {...}` (web) and `use "alien:html" {...}` (HTML/CSS only, browser-safe).
Top-level code of a module runs when it is first imported.

## Tests

```
test "adds numbers" {
  assert(add(1, 2) == 3)          # on failure prints the source text, left and right values
  assert(ok, "custom message")
}
```

`alien test` runs all `test` blocks (in a directory: files named `*_test.aln` or containing tests).
Tests are ignored by `alien run`. Test bodies may use `await`.

## Websites (alien:web) — write HTML, CSS and browser code in Alien, never in .html/.css/.js files

```
use "alien:web" {serve, h, css, page, client, reply, redirect}

STYLE := css({
  ":root": {"--accent": "#5cff9d"},
  ".card": {padding: "28px", borderRadius: "18px", "&:hover": {transform: "translateY(-4px)"}, "h3": {margin: 0}},
  "@media (max-width: 560px)": {".card": {padding: "16px"}},
})

fn card(title, text) h.article({class: "card"}, h.h3(title), h.p(text))

serve({
  "/": fn(req) page({title: "Home", lang: "de", css: STYLE, body: [
    h.h1("Hello"),
    map(items, fn(it) card(it.title, it.text)),   # lists are flattened, nil/false render nothing
    client("{here}/app.aln"),                      # browser code, compiled automatically
  ]}),
  "/api/user/:id": fn(req) {id: req.params.id},   # object/list -> JSON
  "POST /api/save": fn(req) { save(req.body); {ok: true} },  # JSON body parsed
  "/old": fn(req) redirect("/"),
}, {port: 8080, static: "{here}/public"})        # static: images etc.
```

- `h.<tag>(attrs?, ...children)`: first arg is attributes if it is an object. Text children are escaped.
  Attribute `true` renders bare (`hidden`), `nil`/`false` omits it, `style` may be an object.
- `css(obj)`: selectors -> property objects (camelCase or quoted names). Nested keys: `"&:hover"` (same element), `".child"` (descendant), `"@media ..."`.
- `page({title, css, body, head?, lang?, bodyAttrs?})` returns the full document.
- Handler gets `req` = `{method, path, params, query, headers, body}`; may be async. Return a string/`h.*` (HTML), object/list (JSON),
  `reply(status, body, contentType?, headers?)` or `redirect(url)`. Route keys: `"/path"` (any method) or `"POST /path"`; first match wins.
- Browser code (`app.aln`): normal Alien with `document`, `window`, `fetch`, `localStorage`; render with `use "alien:html" {h}` and
  `el.innerHTML = h.p("x").__html`. It may `use` other .aln files in its folder. Node-only functions (`read`, `sh`) do not work there.
- Compile errors in browser code appear in the browser console and the server log.

## JS interop

- JS globals usable directly: `Math JSON Object Array Number String Date Map Set Promise Error RegExp console process Buffer URL fetch setTimeout crypto performance structuredClone` and more. Anything else: `js.Name` (`js` is `globalThis`).
- Methods: `"abc".toUpperCase()`, `[1, 2].includes(2)`, `s.padStart(5, "0")`.
- Classes: `m := new Map()`; `new URL("https://x.y")`.
- Async: `data := await (await fetch(url)).json()`.

## Prelude (always in scope)

Collection functions take the collection first, so they chain with `|>`. They never mutate, except `push`/`pop`.

```
print(...xs)            str(x)              repr(x) (quoted strings)   type(x)    len(x)
num(x) -> num|nil (trims; ""/nil/bad -> nil)   int(x) -> num|nil (truncates: int("3.7") is 3)   eq(a, b) deep equality    assert(cond, msg?)
range(n) range(a, b, step?)                 map(xs, fn(x, i))         filter(xs, fn(x, i))
reduce(xs, fn(acc, x), init?)               each(xs, fn(x, i))        find(xs, f) -> x|nil
index(xs, f|value) -> i|nil                 any(xs, f?)  all(xs, f?)  count(xs, f?)
sum(xs, f?)   min(xs)|min(a, b..)   max(...)     sort(xs, keyFn?, desc=false) (numbers sort numerically)
rev(xs|str)   uniq(xs)   flat(xs, depth=1)   zip(a, b, ...)   indexed(xs) -> [[i, x]]
take(xs, n)   drop(xs, n)   first(xs)   last(xs)   push(xs, ...v) -> xs   pop(xs)
slice(x, a, b?)   join(xs, sep="")   group(xs, keyFn) -> {key: [x]}   chunk(xs, n)
keys(o)  vals(o)  entries(o)  has(coll, x) (list item / substring / object key / Map key)
get(o, k, default=nil)   merge(...objs)   copy(x) (deep clone)
split(s, sep="")  lines(s)  trim(s)  upper(s)  lower(s)  replace(s, a, b) (all)  starts(s, p)  ends(s, p)  chars(s)
abs floor ceil sqrt   round(x, digits=0)   rand() -> [0,1)   randint(a, b) inclusive
json(s) parse    tojson(x, pretty=false)
read(path) -> str   write(path, x)   exists(path)   sh(cmd) -> stdout   env(name, default?)
args (CLI args after the file name: `alien run f.aln a b` -> ["a", "b"])   exit(code=0)   now() -> ms   sleep(ms) (await it)
```

## CLI

```
alien run file.aln [args]     alien eval "code"      alien test [path]
alien check path [--json]     alien emit file.aln    alien build file.aln -o dist
alien spec                    alien version
```

`--json` gives one JSON object on stdout: `{"ok": false, "errors": [{"code", "msg", "file", "line", "col", "hint"}]}`.
Runtime errors report `.aln` file and line. Error codes: `docs/ERRORS.md`.

## Idioms

```
# read file, count words, top 3
counts := read("in.txt") |> lower |> split(" ") |> filter(fn(w) w != "") |> group(fn(w) w)
top := entries(counts) |> map(fn([w, ws]) [w, len(ws)]) |> sort(fn(p) -p[1]) |> take(3)

# CLI script
if len(args) < 1 { print("usage: tool <file>"); exit(1) }
[path] := args

# run async work concurrently (map with an async fn returns promises)
t := now()
results := await Promise.all(map(urls, fn(u) fetchJson(u)))
print("took {now() - t}ms")

# config with default
port := int(env("PORT")) ?? 8080

# result-like returns
fn parse(s) try { {ok: true, v: json(s)} } catch e { {ok: false, err: e.message} }
```
