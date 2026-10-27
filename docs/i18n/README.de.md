# LIM

**Less is more.** Kleine Claude Code Plugins. Jedes Plugin erledigt eine Aufgabe und zeigt die Messungen dahinter.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![verify](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=verify--*&sort=semver&label=verify)](../../plugins/verify/CHANGELOG.md)
[![clear-explain](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=clear-explain--*&sort=semver&label=clear-explain)](../../plugins/clear-explain/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Dies ist eine Übersetzung der [englischen README](../../README.md) auf dem Stand vom 2026-10-24. Wenn sich die beiden unterscheiden, gilt die englische README.

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Français](README.fr.md) | Deutsch | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | [Bahasa Indonesia](README.id.md)

Coding-Agenten schreiben schnell Code. Ihre eigenen Fehler bemerken sie viel schlechter. Der Agent, der eine Änderung geschrieben hat, ist ihr schwächster Reviewer, denn er liest die Änderung durch seine eigenen Überlegungen und gibt sich selbst recht. Deshalb wird Arbeit ohne Review committet oder mit einem Review aus demselben Kontext, der sie geschrieben hat.

**LIM ist meine Antwort darauf: kleine Plugins, die jeweils eine Aufgabe erledigen, mit den Zahlen, die sie belegen.** Im Zentrum steht review-loop, daneben arbeiten verify und clear-explain.

**Mit review-loop heißt "bereit zum Commit" auch geprüft.** Zuerst laufen deine eigenen Tests, Typprüfungen und Lint, in Projekten mit Node.js, Python, Go, Rust, Java (Gradle oder Maven), .NET, Ruby und Makefile, auch in bis zu 4 Unterordner-Projekten pro Runde, die eine Änderung berührt. Dann kennzeichnet ein Reviewer mit frischem Kontext, der Claudes Überlegungen nie sieht, Findings mit P1 bis P5 und muss für die schweren Findings Belege zeigen. Claude behebt P1 und P2, ein neuer Reviewer prüft die Fixes, und ein Skript, nicht das Modell, entscheidet, wann Schluss ist. Über den Rest entscheidest du einmal, am Ende.

**Beweis durch Ausführen des Features.** Mit [verify](../../plugins/verify) gilt ein Finding als reproduziert, wenn ein Check, der das Feature ausführt, auf dem geprüften Code fehlschlägt, und sein Fix zählt erst, wenn derselbe Check wieder besteht.

**Kommentare, die du immer wieder schreibst, werden zu Regeln.** Wenn du bei einem Finding "eine Regel daraus machen" wählst, entwirft Claude eine Lint-Regel oder einen Test, und review-loop führt den Entwurf gegen den Code von vor dem Fix aus, um zu beweisen, dass er den Fehler erkennt. Ein Bugfix bekommt auf dieselbe Weise einen Regressionstest.

**Bewusst klein.** review-loop fügt einer Session etwa 275 Tokens hinzu. Sein Hook tut nichts, bis du ihn in einem Repository einschaltest. Nichts wird installiert, ohne dass du erfährst, was es ist und wie du es wieder entfernst.

Forke es, ändere es, mach es zu deinem. Issues und Pull Requests sind willkommen.

## Plugins

| Plugin | Status | Eine Aufgabe |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.10.0 | Prüft deine Änderungen vor dem Commit, behebt P1- und P2-Findings, prüft erneut und übergibt den Rest an dich. |
| [clear-explain](../../plugins/clear-explain) | 0.1.3 | Erklärt Konzepte, Code und Fehler mit der Antwort zuerst, einer Bedeutung pro Wort und Fachbegriffen unter ihrem offiziellen englischen Namen. |
| [verify](../../plugins/verify) | 0.3.0 | Beweist durch Ausführen, dass deine Features funktionieren, und speichert Befehle und Ausgabe als Nachweis. |

## Installation

Du brauchst Claude Code, git und Node.js 18 oder neuer.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Wenn Claude Code dich dazu auffordert, starte es neu. Das Hinzufügen des Marketplace registriert nur den Katalog. Jedes Plugin wird einzeln installiert, so bekommst du nur, was du auswählst.

## Erste Schritte

Zwei Schritte:

1. Installiere review-loop wie oben beschrieben.
2. Gib in einem git-Repository mit nicht committeten Änderungen ein:

```
/review-loop:review-loop
```

Das ist alles. review-loop führt deine Checks aus, prüft die Änderung, behebt, was behoben werden muss, und fragt dich nach dem Rest. Am Ende fragt es einmal, ob das Commit-Gate für dieses Repository eingeschaltet werden soll, und danach, ob committet werden soll.

Neu hier? Der [Leitfaden](../../docs/guide/README.md), auf Englisch, zeigt mit echter Ausgabe ein erstes Review, das Entscheiden, das Commit-Gate, die Kosten und typische Fallstricke.

## Verwendung

### Einfach `/review-loop:review-loop` verwenden

Gib den Befehl immer dann ein, wenn du gleich committen willst. Nach dem Befehl kannst du in normalen Worten ergänzen, was du willst:

```
/review-loop:review-loop I changed the coupon math. Check it before I commit.
```

```
/review-loop:review-loop confirm every P2 with me before you fix anything.
```

Claude kann review-loop auch von selbst starten, wenn du um ein Review oder einen Commit bittest, aber nur, wenn Claude entscheidet, dass der Skill passt. Der Befehl startet review-loop immer.

### Wie eine Runde aussieht

Jede Runde endet mit einem Bericht. Claude zeigt ihn vor allem anderen:

```
Review round 2 of 3 (reviewer: session model)
Checks: test (npm run test) passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal (fixed, inferred: the re-review read the fix)
  test: src/coupon.test.js (before the fix: caught, after: passed)

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

Hier hat Runde 1 ein P1 gefunden. Claude hat es behoben und einen Regressionstest geschrieben, und review-loop hat gezeigt, dass der Test auf dem Code von vor dem Fix fehlschlägt. Runde 2 hat den Fix bestätigt, also hat die Schleife gestoppt. Ein P3 bleibt für dich.

### Beispiele

<details>
<summary>Alle Prompts</summary>

```
review before commit:   /review-loop:review-loop
with intent:            /review-loop:review-loop I moved the retry logic into the client. Check it
                        before I commit.
confirm P2 first:       /review-loop:review-loop confirm every P2 with me before you fix anything.
confirm P1 and P2:      /review-loop:review-loop confirm every P1 and P2 with me before you fix anything.
stop confirming:        /review-loop:review-loop stop confirming findings with me before fixes.
continue a loop:        /review-loop:review-loop
                        (in a new session it offers to continue where the last loop stopped)
turn on the gate:       /review-loop:review-loop turn on the commit gate in this repo.
turn off the gate:      /review-loop:review-loop turn off the commit gate in this repo.
skip once:              /review-loop:review-loop commit this without a review, just this once.
delegate commits:       /review-loop:review-loop stop asking before commits in this repo.
take it back:           /review-loop:review-loop turn off commit delegation.
run unattended:         /review-loop:review-loop run unattended. I will read the summary in the morning.
reviewer model:         /review-loop:review-loop run the reviewer on sonnet in this repo.
```

</details>

## Wie ein Review abläuft

Vor deinem Commit führt review-loop eine kurze Schleife aus und stoppt selbstständig.

1. **Checks.** review-loop führt die Checks `typecheck`, `lint` und `test` aus, die dein Projekt festlegt: Skripte in `package.json`, Makefile-Targets oder die Standards für Go (`go.mod`), Rust (`Cargo.toml`), die Python-Tools, die du konfigurierst, Gradle, Maven, .NET und die Ruby-Tools, die du verwendest. Ein fehlgeschlagener Check oder eine `package.json` mit ungültigem JSON wird zu einem P1-Finding. Ein Check, der sein Zeitlimit überschreitet oder dessen Programm nicht installiert ist, wird als "nicht verifiziert" gemeldet und nicht als fehlgeschlagen.
2. **Neues Review.** Ein separater Reviewer-Agent bekommt den Diff und eine einzeilige Zusammenfassung deines Ziels, aber nicht Claudes Überlegungen zu der Änderung. Er kann den umliegenden Code lesen, um den Kontext zu verstehen. Er kennzeichnet Findings mit P1 bis P5. P1 und P2 brauchen Belege: die genaue Zeile, ein Fehlerszenario und eine Begründung, warum nichts Bestehendes den Fehler bereits verhindert. Jedes Finding wird als measured (gemessen), inferred (abgeleitet) oder guessed (vermutet) gekennzeichnet. Ein P1 oder P2 ohne Belege oder mit guessed wird dir als nicht verifiziert gezeigt und nicht behoben.
3. **Beheben.** Claude sagt, was es beheben wird, und behebt dann P1 und P2. Wenn ein Fix eine Designentscheidung braucht (mehr als ein möglicher Weg, eine sichtbare Verhaltensänderung, das Entfernen eines Features, Änderungen an Tests), entscheidest du zuerst. Wenn dein Projekt ein test-Skript hat, schreibt Claude aus dem Fehlerszenario jedes behobenen P1 oder P2 einen Regressionstest, und review-loop zeigt, dass der Test auf dem Code von vor dem Fix fehlschlägt.
4. **Erneutes Review.** Ein neuer Reviewer prüft nur die Fixes und die noch offenen Findings. Es gibt höchstens 3 Runden.
5. **Stoppen.** Ein Skript entscheidet über den Stopp, nicht das Modell: Es gibt kein P1 oder P2 mehr, das Rundenlimit ist erreicht, ein Finding übersteht zwei Fixes, ein gelöstes Finding kommt zurück, P1 + P2 sinkt nicht mehr, oder ein Fix schwächt Tests oder Checks.
6. **Entscheiden.** Über den Rest entscheidest du einmal: alle P3 bis P5 sowie jedes P1 oder P2, das noch offen ist, nicht verifiziert werden konnte oder eine Datei außerhalb des geprüften Diffs betrifft. Für jedes Finding wählst du: so lassen, nur dieses Mal beheben oder eine Regel daraus machen. Ein Finding, das du so lässt, wird in einem späteren Review erst wieder abgefragt, wenn sich die zitierte Zeile ändert, und bis dahin nur im Bericht gezählt. Haben frühere Reviews in diesem Repository eine der vier Arten, nach denen der Reviewer sucht (etwa einen spekulativen Guard), schon 3-mal oder öfter gemeldet, sagt Claude das und empfiehlt eine Regel auf der stärksten passenden Ebene: zuerst eine Typ- oder Architekturänderung, dann eine Lint-Regel, dann einen Test.
7. **Commit.** Claude fragt vor dem Commit, außer du hast "in diesem Repo nicht mehr fragen" gewählt. Claude pusht nie. Wenn du das Commit-Gate einschaltest, macht ein Hook daraus eine Regel: Claudes Commits sind blockiert, bis ein Review bestanden ist.

Wenn Claude sagt, dass etwas behoben ist, sagt es auch, woher es das weiß: Ein Check, der jetzt besteht, ist measured, und Claudes Lesart des neuen Codes ist inferred. Wenn du einem Finding widersprichst, prüft Claude die Behauptung erneut, bevor es zustimmt, und sagt dir, was es geprüft hat.

### Worauf der Reviewer achtet

Der Reviewer sucht nach Bugs, fehlenden Anforderungen, verletzten Projektregeln und allem anderen, woran die Änderung bei dem scheitern würde, was du erreichen wolltest. Dein Ziel selbst stellt er nicht in Frage. Außerdem sucht er nach vier Arten von Code, die Agenten hinzufügen, wenn sie die Ursache eines Problems nicht kennen, denn der nächste Agent kopiert sie:

<details>
<summary>Die vier Arten</summary>

| Art | Was es ist | Schweregrad |
|---|---|---|
| Spekulativer Guard | Ein Check, ein try/catch, ein Fallback oder ein Default für einen Zustand, von dem nichts zeigt, dass er eintreten kann | P2, wenn er einen Fehler verdeckt, sonst P3 |
| Historien-Kommentar | Ein Kommentar darüber, wer was verlangt hat oder warum sich eine frühere Version geändert hat, oder eine Anweisung an Agenten | P4 |
| Provisoriums-Marker | Ein Kommentar mit TODO, HACK, "temporary" oder "for now" ohne Link zu einem Issue | P3 |
| Zweiter Weg | Ein Helper, ein Muster oder eine Abhängigkeit für eine Aufgabe, die die Codebase bereits auf andere Weise erledigt | P3 |

Ein Guard ist dort richtig, wo ein legitimer Zustand in den Code gelangt: Benutzereingaben, das Lesen aus dem Netzwerk oder aus einer Datei oder ein Wert, der laut API-Dokumentation fehlen kann. Eine zweite Prüfung weiter innen, für einen Zustand, der schon behandelt wurde, ist trotzdem spekulativ. Eine Fixture in [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/) enthält von jeder Art ein Beispiel und prüft, dass der Reviewer sie meldet.

</details>

### Schweregrad

Die Stufen basieren auf der öffentlichen Pn-Regel von Banksalad.

| Stufe | Bedeutung | Verhalten der Schleife |
|---|---|---|
| P1 | Muss behoben werden: ein fehlgeschlagener Check, Datenverlust, eine Sicherheitslücke, ein Absturz, oder das angeforderte Feature funktioniert nicht | Wird behoben, wenn Belege vorliegen |
| P2 | Sollte behoben werden: ein Bug, den eine bestimmte Eingabe reproduziert, eine fehlende Anforderung, eine verletzte Projektregel | Wird behoben, wenn Belege vorliegen |
| P3 | Lohnt sich zu beheben: Wartbarkeit, ein irreführender Name, ein fehlender Test für einen Nebenpfad | Du entscheidest |
| P4 | Optional: eine strukturelle Vorliebe, bei der Menschen unterschiedlicher Meinung sind | Du entscheidest |
| P5 | Trivial: ein Tippfehler oder Formatierung | Du entscheidest |

Ein P1 oder P2 zu einer Datei, die nicht im Diff der Runde liegt, wird in der Schleife nicht behoben. Es kommt am Ende zu dir, als außerhalb des geprüften Diffs markiert, und behält seinen Schweregrad.

### Regeln und Regressionstests

Ein Kommentar, den ein Reviewer wiederholen muss, ist eine fehlende Regel. review-loop zählt mit: Jedes Review speichert die Art jedes Findings in einer Datei, die alle Worktrees des Repositorys teilen, und ein Finding einer der vier oben genannten Arten, dessen Art frühere Reviews schon 3-mal oder öfter gemeldet haben, wird als Wiederholung markiert. Breite Labels wie correctness werden gespeichert, zählen aber nie als Wiederholung. Wenn du bei einem Finding "eine Regel daraus machen" wählst, sucht Claude zuerst in deiner Lint-Konfiguration oder deinen Tests nach einer bestehenden Regel, die den Fehler hätte erkennen sollen. Dann wählt es die erste Form, die funktioniert: eine bestehende Lint-Regel einschalten, eine eigene Regel für den Linter schreiben, den du schon verwendest, oder einen Test schreiben. Der Entwurf landet nie in der Datei, die das Finding betrifft.

Danach beweist review-loop den Entwurf. Es schreibt den Code von vor dem Fix in einen temporären Ordner und führt dort deine Checks aus, einmal mit und einmal ohne den Entwurf:

| Ergebnis | Bedeutung |
|---|---|
| `caught` | Ein Check schlägt nur mit dem Entwurf fehl. Die Regel erkennt den Fehler. |
| `missed` | Jeder Check besteht mit dem Entwurf. Claude überarbeitet ihn einmal. |
| `unproven` | Ein Check hat das Zeitlimit überschritten oder schlägt auch ohne den Entwurf fehl. Claude sagt dir, welcher Fall vorliegt. |

Eine Regel braucht einen Check, der sie ausführt. Ohne ein `typecheck`-, `lint`- oder `test`-Skript wird die Wahl als "nur dieses Mal beheben" gespeichert, und Claude sagt dir, warum. Ein bewiesener Entwurf kommt in denselben Commit wie der Fix, und die Commit-Nachricht nennt ihn.

Jedes P1 oder P2, das Claude behebt, bekommt auf dieselbe Weise und ohne Nachfrage einen Regressionstest, wenn dein Projekt ein test-Skript hat. Bei einem Regressionstest zählt nur der test-Check als Beweis: Wenn mit dem Test nur Lint fehlschlägt, hat der Test den Bug nicht erkannt. Ein Fix ohne Test nennt im Bericht den Grund.

### Commit-Gate

Das Commit-Gate ist ein Hook, der aus ist, bis du ihn in einem Repository einschaltest. Am Ende eines Reviews fragt Claude einmal, ob es ihn einschalten soll. Wenn das Gate an ist, wird jeder `git commit`, den Claude ausführt, zuerst geprüft.

<details>
<summary>Was das Gate tut</summary>

| Situation | Was das Gate tut |
|---|---|
| Kein Review, oder Dateien wurden geändert, die das Review nicht abgedeckt hat | Blockiert den Commit und sagt Claude, dass es das Review ausführen soll |
| Eine Review-Schleife läuft, oder Entscheidungen sind noch offen | Blockiert den Commit |
| Das Review ist bestanden | Fragt dich vor dem Commit, oder erlaubt den Commit, wenn du Commits in diesem Repository delegiert hast |
| Nach dem Review wurden nur geprüfte Dateien oder von `loop rule` geprüfte Regelentwürfe und Regressionstests geändert | Fragt dich |
| `git push` oder ein Force-Push | Fragt immer, auch mit Delegation |
| Ein Commit mit `--no-verify` | Fragt, auch mit Delegation, und blockiert weiterhin einen Commit ohne bestandenes Review |
| Ein Commit in einem Ordner, den das Gate nicht lesen kann, etwa `cd "$(...)"` oder ein Pfad, der nicht existiert | Fragt dich, auch mit Delegation, wenn das Gate in dem Repository eingeschaltet ist, in dem du Claude Code gestartet hast |

Wenn du einmal ohne Review committen willst, bitte Claude, das Review dieses Mal zu überspringen. Die Gate-Einstellung und die Commit-Delegation gelten für das ganze Repository, auch für seine verknüpften Worktrees. Jeder Worktree hat sein eigenes Review.

</details>

### Einstellungen

Die ersten fünf Einstellungen gelten für ein Repository. Du änderst eine Einstellung, indem du die Anfrage nach `/review-loop:review-loop` eingibst. So hat Claude die Befehle des Skills geladen. Das Zeitlimit für Checks ist eine Umgebungsvariable, darum gilt es überall, wo du es setzt, und die 9 Minuten insgesamt sind fest.

| Einstellung | Standard | Eingabe |
|---|---|---|
| Vor dem Beheben bestätigen | Aus | "stimme jedes P2 mit mir ab" oder "stimme jedes P1 und P2 mit mir ab" |
| Commit-Gate | Wird am Ende des ersten Reviews einmal abgefragt | "schalte das Commit-Gate ein (oder aus)" |
| Commit-Delegation | Fragt vor jedem Commit | "frag in diesem Repo nicht mehr vor Commits" |
| Unbeaufsichtigt | Aus | "arbeite unbeaufsichtigt" für einen Lauf oder "schalte den unbeaufsichtigten Modus in diesem Repo ein (oder aus)". Claude fragt nichts, lässt liegen, was dich braucht, und endet mit einer Zusammenfassung dessen, was es getan hat und was auf dich wartet |
| Reviewer-Modell | Das Modell deiner Session | "lass den Reviewer in diesem Repo auf sonnet laufen" (oder opus, haiku, fable) oder "lass den Reviewer auf dem Modell der Session laufen". Unter Gemessen steht, was jedes Modell gefunden und gekostet hat |
| Zeitlimit für Checks | 5 Minuten pro Check, 9 Minuten insgesamt | Setze `LIM_CHECK_TIMEOUT_MS`, um das Limit pro Check zu ändern |

## Gemessen

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) listet 215 Verhaltensweisen auf sechs Achsen: do, tell, ask, silence, stop und evidence. Unit-Tests in der CI decken 204 davon ab. Dazu gehören Läufe gegen echte temporäre git-Repositories und gegen den Commit-Gate-Hook. Die übrigen 11 brauchen einen Lauf mit einem Modell: einmal nach P3 bis P5 fragen, den Bericht vor jeder Frage zeigen, jeden Schritt mit einem Grund für jedes Überspringen in der Todo-Liste behalten, für jedes behobene P1 oder P2 einen Regressionstest schreiben, jedes Finding als measured, inferred oder guessed kennzeichnen, sagen, woher man weiß, dass ein Fix wirkt, ein Finding erneut prüfen, wenn du widersprichst, für eine Art von Finding, die immer wiederkommt, eine Regel empfehlen, in einem unbeaufsichtigten Lauf nichts fragen, den Reviewer auf dem gewählten Modell starten und Code melden, der ohne bekannte Ursache hinzugefügt wurde. Für die letzte gibt es eine Fixture in [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/), und für die ersten beiden gibt es einen manuellen Lauf in [`evals/review-loop/manual-behaviors.md`](../../evals/review-loop/manual-behaviors.md).

Ein Detection-Benchmark gibt dem Reviewer Änderungen in temporären Repositories, deren Namen nicht verraten, dass es ein Test ist. [`evals/review-loop/detection/`](../../evals/review-loop/detection/) enthält 12 Änderungen mit je einem eingebauten Bug und 6 saubere Änderungen. [`evals/review-loop/detection-hard/`](../../evals/review-loop/detection-hard/) enthält 10 schwierigere Bugs, etwa einen, den man nur in einer Datei sieht, die der Diff nicht berührt, einen, den man nur sieht, wenn man vier Dateien folgt, einen in einem 183 Zeilen langen Diff, eine Race Condition zwischen zwei Suchen, einen Buffer, der geleert wird, bevor ein asynchroner Schreibvorgang ihn liest, und einen Lock, der auf einem Fehlerpfad nicht freigegeben wird, dazu 6 saubere Änderungen, die verdächtig aussehen. Ergebnisse mit 3 Läufen pro Fall, vom 2026-10-25 für das normale Set und vom 2026-10-26 für das schwierigere Set:

| Reviewer-Modell | Normales Set: als P1 oder P2 gefundene Bugs | Normales Set: falsche P1 oder P2 bei sauberen Änderungen | Schwierigeres Set: als P1 oder P2 gefundene Bugs | Schwierigeres Set: falsche P1 oder P2 bei sauberen Änderungen | Kosten des schwierigeren Sets (48 Läufe) |
|---|---|---|---|---|---|
| claude-opus-5-5 | 36 von 36 | 0 von 18 | 30 von 30 | 0 von 18 | 3,11 $ |
| claude-sonnet-5-5 | nicht ausgeführt | nicht ausgeführt | 29 von 30 | 0 von 18 | 1,14 $ |
| claude-haiku-5-5 | nicht ausgeführt | nicht ausgeführt | 30 von 30 | 3 von 18 | 0,09 $, laut Claude Code |

Standardmäßig läuft der Reviewer mit dem Modell deiner Session. Opus fand jeden eingebauten Bug in beiden Sets, daher kann der Benchmark für Opus noch keinen Rückgang bei den gefundenen Bugs zeigen. Um zu sehen, ob er eine schlechtere `reviewer.md` überhaupt zeigt, lief Opus das schwierigere Set auch mit einer `reviewer.md`, die auf ihr Ausgabeformat gekürzt war: Es fand weiterhin 30 von 30, ergab 1 falsches P2 in 18 sauberen Läufen und meldete 83 Findings von P3 bis P5, wo der vollständige Reviewer 55 meldete. Bei Opus hängt das Finden dieser Bugs mehr vom Modell ab als von den Anweisungen, und eine schlechtere `reviewer.md` zeigt sich als Fehlalarme und Rauschen. Sonnets einziger Fehlschlag lieferte kein Finding für den Buffer, der vor einem asynchronen Schreibvorgang geleert wird. Haikus 3 Fehlalarme betrafen alle einen sauberen Fall, der auch in 9 Opus-Läufen des vollständigen Reviewers über zwei Tage 1 falsches P2 ergab. Ein Finding zählt, wenn es den eingebauten Bug an einer geänderten Zeile nennt, oder, bei einem Bug, den man nur in einer anderen Datei sieht, an einer markierten Zeile in dieser Datei. Nach den ersten Läufen kamen in vier Fällen Schlüsselwörter hinzu, in denen ein Reviewer den eingebauten Bug mit Worten nannte, die die Bewertung nicht akzeptierte, und jeder gespeicherte Lauf wurde damit neu bewertet. Starte ihn erneut mit `node evals/review-loop/run-detection.mjs --runs 3` und füge für das schwierigere Set `--cases evals/review-loop/detection-hard` hinzu.

Die Tabelle oben ist die Grundlage für das Standardmodell des Reviewers. Im schwierigeren Set fand Opus 30 von 30 ohne falsche P1 oder P2, Sonnet fand 29 von 30 ohne ein einziges bei etwa 37 % der Kosten von Opus, und Haiku fand 30 von 30 mit 3 falschen P1 oder P2 in 18 sauberen Läufen. Darum bleibt der Standard das Modell der Session, und Sonnet ist die günstigere Wahl, wenn der Reviewer auf einem anderen Modell laufen soll als dem, das die Änderung geschrieben hat.

<details>
<summary>Kosten</summary>

`claude plugin details` schätzt die Kosten von review-loop so:

| Teil | Immer aktiv, in jeder Session | Bei jedem Lauf |
|---|---|---|
| review-loop-Skill | etwa 210 Tokens | etwa 6.000 Tokens |
| Reviewer-Agent | etwa 60 Tokens | etwa 1.800 Tokens, dazu der Diff und der Code, den er liest |

Die Kosten des Skills fallen einmal pro Lauf an. Die Kosten des Reviewers fallen einmal pro Runde an, und eine Schleife hat höchstens 3 Runden. Das Reviewer-Modell ändert diese Kosten; die Benchmark-Tabelle oben zeigt sie für jedes Modell. Deine Checks laufen auf deinem Rechner und kosten keine Tokens.

</details>

review-loop prüft die Pull Requests von LIM selbst. [#8](https://github.com/lee-eojin/lim/pull/8) zeigt zwei Schleifen auf der ersten Version, darunter einen Stopp wegen eines False Positive im eigenen Check auf geschwächte Tests. Dieser Fehler wurde danach behoben. Neuere Pull Requests wie [#46](https://github.com/lee-eojin/lim/pull/46) zeigen den Bericht von review-loop und die Entscheidung zu jedem Finding.

## Warum es so funktioniert

<details>
<summary>Warum ein neuer Reviewer?</summary>

Der Agent, der eine Änderung geschrieben hat, weiß, warum jede Zeile da ist, und liest die Änderung deshalb als korrekt. Ein Reviewer, der nur den Diff und eine Zeile zum Ziel bekommt, muss den Grund im Code finden. Steht der Grund nicht dort, ist das ein Finding. Jede Runde startet einen neuen Reviewer, also bewertet ein Reviewer nie sein eigenes früheres Urteil.

</details>

<details>
<summary>Warum entscheidet ein Skript, wann Schluss ist?</summary>

Ein Modell, das gefragt wird "ist das fertig?", antwortet meist mit Ja. Das Skript von review-loop zählt stattdessen: Es stoppt, wenn kein P1 oder P2 mehr übrig ist, nach 3 Runden, wenn ein Finding zwei Fixes übersteht, wenn ein gelöstes Finding zurückkommt, wenn P1 + P2 nicht mehr sinkt oder wenn ein Fix einen Test schwächt. Mit offenen Findings zu stoppen ist ein normales Ergebnis, und Claude sagt das auch.

</details>

<details>
<summary>Warum brauchen P1 und P2 Belege?</summary>

Eine selbstsichere Behauptung und eine bewiesene sehen in einem Bericht gleich aus. Ein P1 oder P2 muss die genaue Zeile zitieren, eine Eingabe nennen, die ein falsches Ergebnis erzeugt, und sagen, warum nichts Bestehendes das bereits verhindert. Fehlt eines davon, oder kennzeichnet der Reviewer das Finding als guessed, wird es als nicht verifiziert gezeigt, und Claude ändert dafür keinen Code.

</details>

<details>
<summary>Warum ist das Commit-Gate Opt-in?</summary>

Ein Hook, der Commits blockiert, verändert deine Arbeitsweise, also sollte das pro Repository deine Wahl sein. Ohne das Gate ist "vor dem Commit fragen" eine Anweisung, der Claude folgt. Mit dem Gate blockiert der Hook ein `git commit`, das Claude ohne bestandenes Review ausführt. Er sieht nicht alles: [Grenzen](#grenzen) listet auf, was er übersieht, etwa Commits, die du in deinem eigenen Terminal eingibst.

</details>

<details>
<summary>Warum pusht es nie?</summary>

Ein Commit ist lokal und leicht rückgängig zu machen. Ein Push nicht. review-loop hört beim Commit auf, und das Gate fragt vor jedem Push, auch wenn du Commits delegiert hast.

</details>

## Daten

Zustand, Diffs, Check-Logs und ein Entscheidungsprotokoll liegen in `.git/lim/review-loop/` in deinem Repository. Claude schreibt jedes Review für einen Moment in `.lim-review/` in deinem Working Tree; git ignoriert diesen Ordner über `.git/info/exclude`, und review-loop löscht die Datei, nachdem es sie gelesen hat. Um eine Regel zu prüfen, schreibt review-loop den Code von vor dem Fix in einen temporären Ordner außerhalb deines Repositorys und löscht ihn danach. Lösche `.git/lim/review-loop/`, um alles zurückzusetzen.

review-loop sendet selbst keine Netzwerkanfragen. Claude und der Reviewer lesen den Diff, die Findings und die Check-Ausgabe wie jede andere Datei in deiner Session. Darum geht dieser Inhalt auf dieselbe Weise an den Modellanbieter wie der Rest deiner Claude-Code-Session.

## Grenzen

- Checks werden aus den Skripten in `package.json` erkannt, dann aus Makefile-Targets, dann aus Go, Rust, konfigurierten Python-Tools (pytest, ruff, mypy), Gradle, Maven, .NET und den Ruby-Tools, die das Projekt verwendet (rspec, rake test, rubocop), im Wurzelordner des Repositorys und in den Projekten in Unterordnern, die eine Änderung berührt, bis zu 4 pro Runde.
- Jeder Check bekommt höchstens 5 Minuten, alle Checks zusammen höchstens 9 Minuten.
- Ohne Commit-Gate ist die Frage vor einem Commit eine Anweisung an Claude, keine Garantie.
- Das Commit-Gate prüft nur Befehle, die Claude über sein Bash-Tool ausführt. Commits, die du in deinem eigenen Terminal eingibst, prüft es nicht. Ein Commit über einen git-Alias wie `git ci` wird wie `git commit` geprüft, bei einem Shell-Alias (`!...`), der committet, fragt es nach, weil das Gate nicht hineinsehen kann, und einen Alias, der inline mit `git -c alias.ci=commit` gesetzt wird, erkennt es nicht.
- Wenn du Claude Code in einem Ordner startest, der kein Repository ist, kann das Gate einen Commit nicht prüfen, dessen Repository es nicht erkennen kann, zum Beispiel nach `cd "$(...)"`.
- review-loop prüft alles, was `git add -A` einschließen würde, und keine von Hand ausgewählte Menge gestagter Änderungen.
- Eine Regel oder ein Regressionstest wird in einer temporären Kopie geprüft, die deine getrackten Dateien und einen Link auf das `node_modules` im Root enthält. Andere ignorierte Dateien wie `.env` oder ein verschachteltes `node_modules` fehlen dort. Ein Check, der sie braucht, meldet das Ergebnis darum als unbewiesen oder als aus dem falschen Grund erkannt. Claude liest den Fehlschlag, um zu erkennen, welcher Fall vorliegt.

## FAQ

**Startet review-loop von selbst?**
Nicht immer. Claude startet einen Skill nur, wenn Claude entscheidet, dass die Beschreibung des Skills zum Gespräch passt. Wenn du Claude um ein Review oder einen Commit bittest, kann Claude review-loop starten. Das ist aber nicht garantiert. Der Befehl `/review-loop:review-loop` startet review-loop immer. Wenn du das Commit-Gate einschaltest, wird ein Commit ohne Review blockiert, und Claude bekommt die Anweisung, zuerst review-loop auszuführen.

**Pusht oder merged es?**
Nie. review-loop fragt vor jedem Commit, außer du wählst "in diesem Repo nicht mehr fragen". Du kannst das wieder ausschalten: Bitte Claude, die Commit-Delegation von review-loop auszuschalten.

**Gibt es Konflikte mit meinen anderen Plugins?**
review-loop fügt einen Skill, einen Agent und einen Hook hinzu. Der Hook liest Bash-Befehle, reagiert nur auf `git commit` und `git push` und tut nichts, solange du das Commit-Gate in diesem Repository nicht eingeschaltet hast. Seine Namen beginnen mit `review-loop:`, darum können sie nicht mit Namen aus anderen Plugins kollidieren. Wenn du in normalen Worten fragst, kann Claude stattdessen einen anderen Review-Skill wählen. Der Befehl startet immer review-loop.

**Was passiert, wenn eine Session mitten in einer Schleife endet?**
Führe den Befehl erneut aus. review-loop bietet an, ab der Runde und dem Schritt weiterzumachen, wo es gestoppt hat, oder neu zu beginnen.

**Wie deinstalliere ich es?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

Lösche danach `.git/lim/review-loop/` in jedem Repository, in dem du review-loop ausgeführt hast, und die Zeile `.lim-review/` in seiner `.git/info/exclude`.

## Mach es zu deinem

review-loop arbeitet mit den Checks, die du schon hast. Je besser deine Skripte `typecheck`, `lint` und `test` sind, desto mehr vom Review wird gemessen statt gelesen.

- Du willst die schweren Findings sehen, bevor sich etwas ändert? Bitte Claude, jedes P2 oder jedes P1 und P2 mit dir abzustimmen.
- Du willst in einem Repository, dem du vertraust, nicht mehr jeden Commit freigeben? Delegiere dort die Commits. Mit eingeschaltetem Commit-Gate wird bei Pushes trotzdem gefragt.
- Du schreibst immer wieder denselben Kommentar? Wähle "eine Regel daraus machen", und beim nächsten Review erkennen dein eigener Linter oder deine eigenen Tests diesen Fehler bereits.
- Du willst einen anderen Ablauf? Forke das Plugin. Der Skill ist eine einzige `SKILL.md` mit weniger als 250 Zeilen, und die Logik der Schleife steckt in einem einzigen Skript, `plugins/review-loop/skills/review-loop/scripts/loop.mjs`.

## Wie LIM entsteht

- **Zuerst Issues.** Jede Änderung beginnt mit einem Issue. Sie kommt über einen Pull Request in das Projekt, den ein Maintainer per Squash-Merge zusammenführt.
- **Von sich selbst geprüft.** Jeder Pull Request führt review-loop auf seinem eigenen Diff aus, und die Beschreibung zeigt den Bericht und eine Entscheidung zu jedem Finding.
- **Versionen pro Plugin.** Jedes Plugin folgt Semantic Versioning, hat ein eigenes `CHANGELOG.md` und bekommt Tags im Format `<plugin>--v<version>`. Minor- und Major-Releases bekommen ein GitHub Release.
- **Bewusst klein.** Ein Plugin hat einen Einstiegs-Skill, eine `SKILL.md` mit weniger als 250 Zeilen und nur Opt-in-Hooks.

## Roadmap

- Evals auf Modell-Ebene mit `claude plugin eval` für die Verhaltensweisen, die Unit-Tests nicht abdecken können, und ein Blindvergleich von Review-Qualität und Kosten

## Mitwirken

Issues und Pull Requests sind willkommen. Beginne mit [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Lizenz

MIT. Siehe [LICENSE](../../LICENSE).
