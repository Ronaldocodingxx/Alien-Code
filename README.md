# 👽 Alien

**Eine Programmiersprache für KI-Agenten.** Wenige Tokens, keine Mehrdeutigkeit, keine
Einrückungsregeln, Fehler schon beim Kompilieren – und so schnell wie JavaScript,
weil Alien zu JavaScript kompiliert und auf Node.js läuft.

```
fn fib(n) if n < 2 { n } else { fib(n - 1) + fib(n - 2) }

total := [1, 2, 3, 4, 5]
  |> filter(fn(x) x % 2 == 1)
  |> map(fn(x) x * 10)
  |> sum

print("fib(20) = {fib(20)}, total = {total}")
```

## Installation

Voraussetzung: Node.js 22.15 oder neuer.

```
cd Alien
npm link          # danach gibt es den Befehl `alien` überall
alien run examples/hello.aln
```

Ohne `npm link` geht alles auch mit `node bin/alien.js ...`.

## Websites komplett in Alien

HTML, CSS, Server und Browser-Code – alles `.aln`, keine einzige `.html`/`.css`/`.js`-Datei:

```
use "alien:web" {serve, h, css, page, client}

STYLE := css({"h1": {color: "#5cff9d"}})

serve({
  "/": fn(req) page({title: "Hallo", css: STYLE, body: [h.h1("Hallo Welt"), client("{here}/app.aln")]}),
  "/api/zeit": fn(req) {jetzt: now()},
})
```

## Befehle

| Befehl | Was es tut |
|---|---|
| `alien run datei.aln [args]` | Programm ausführen |
| `alien eval "1 + 2"` | Code direkt ausführen, letztes Ergebnis ausgeben |
| `alien test [ordner]` | alle `test "..." { }`-Blöcke ausführen |
| `alien check datei.aln --json` | nur prüfen, Fehler maschinenlesbar |
| `alien emit datei.aln` | erzeugten JavaScript-Code anzeigen |
| `alien build datei.aln -o dist` | eigenständige `.mjs`-Dateien bauen (laufen mit `node`) |
| `alien spec` | komplette Sprachdoku ausgeben (für Agenten) |

## Warum ist das „effizient für Agenten“?

„Für Menschen unlesbar“ wäre für KI-Modelle **nicht** effizienter: Modelle zerlegen Text in Tokens,
und seltene Sonderzeichen kosten oft *mehr* Tokens und führen zu mehr Fehlern. Effizient heißt:

- **Wenig Tokens:** kein `const`/`function`/`return`-Boilerplate, kurze englische Schlüsselwörter
  (je 1 Token), Pipes statt Verschachtelung.
- **Eindeutig:** genau ein Weg für jede Sache; `:=` deklariert, `=` weist zu; Einrückung ist egal.
- **Fehler früh und maschinenlesbar:** Tippfehler in Namen werden vor dem Start erkannt
  („did you mean …?“), jede Fehlermeldung hat einen festen Code + Lösungshinweis, `--json` überall.
- **Laufzeitfehler zeigen auf die `.aln`-Zeile**, nicht auf generierten Code.
- **Schnell:** gleiche Geschwindigkeit wie handgeschriebenes JavaScript (`bench/`), ca. 15× schneller als Python.
- **Das ganze npm-Ökosystem** ist direkt nutzbar: `use "node:fs" as fs`.

## Projektaufbau

```
AGENTS.md        Einstieg für jeden KI-Agenten (Regeln + Arbeitsprotokoll)
docs/SPEC.md     die komplette Sprache auf einer Seite – das „Handbuch“ für Agenten
docs/ERRORS.md   alle Fehlercodes
docs/ROADMAP.md  was als Nächstes gebaut werden soll
src/             Compiler (Lexer -> Parser -> JS-Codegen) + Runtime
bin/alien.js     Kommandozeile
tests/           Testsuite (`npm test`)
examples/        Beispielprogramme
```

## Alien mit neueren Modellen weiterentwickeln

Das Repo ist so gebaut, dass ein Agent es selbstständig verbessern kann: `AGENTS.md` enthält die
Design-Prinzipien und ein festes Protokoll (erst Test schreiben, dann umsetzen, Doku + Changelog
pflegen, `npm test` muss grün sein). `docs/ROADMAP.md` ist die priorisierte Aufgabenliste.

Du kannst einem Agenten (z. B. Claude Code in diesem Ordner) einfach sagen:

> Lies AGENTS.md und arbeite den obersten Punkt aus docs/ROADMAP.md ab.

oder allgemeiner:

> Lies AGENTS.md. Schreib ein paar echte Programme in Alien, finde heraus, was dabei nervt
> oder fehleranfällig ist, und verbessere die Sprache nach dem Protokoll.

Tipp: Committe nach jedem erfolgreichen Schritt mit git, dann kannst du jede Änderung
eines Agenten nachvollziehen und notfalls zurückdrehen.
