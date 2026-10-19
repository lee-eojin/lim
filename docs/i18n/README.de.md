# LIM

**Less is more.** Kleine Claude Code Plugins. Jedes Plugin erledigt eine Aufgabe und zeigt die Messungen dahinter.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Dies ist eine Übersetzung der [englischen README](../../README.md) auf dem Stand vom 2026-10-19. Wenn sich die beiden unterscheiden, gilt die englische README.

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Français](README.fr.md) | Deutsch | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | [Bahasa Indonesia](README.id.md)

## Warum LIM

Große Agent-Harnesses laden viele Anweisungen in jede Session und führen bei vielen Befehlen Hooks aus. LIM hält jedes Plugin klein, optional und gemessen.

- **Ein Plugin, eine Aufgabe.** Installiere nur, was du brauchst. review-loop fügt einer Session etwa 188 Tokens hinzu. Diesen Wert meldet `claude plugin details`.
- **Erst Checks, dann Meinungen.** Deine Tests, deine Typprüfung und dein Lint laufen vor jedem Review durch ein Modell.
- **Hooks sind Opt-in.** Ein Hook tut nichts, bis du ihn für ein Repository einschaltest.
- **Erst fragen, dann installieren.** Alles, was ein Plugin braucht, wird vorher erklärt: was es ist, was es verbessert, wo es liegt und wie du es entfernst.
- **Zahlen zeigen.** Jedes Plugin enthält, was gemessen wurde und was diese Messung nicht abdeckt.

## Plugins

| Plugin | Status | Eine Aufgabe |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.2.1 | Prüft deine Änderungen vor dem Commit, behebt P1- und P2-Findings, prüft erneut und übergibt den Rest an dich. |
| forge | geplant | Macht aus den Pull-Request-Kommentaren eines Reviewers einen Reviewer-Skill und liefert einen Bericht, wie getreu dieser Skill ist. |

## Schnellstart

Du brauchst Claude Code, git und Node.js 18 oder neuer.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Wenn Claude Code dich dazu auffordert, starte es neu. Führe danach in einem git-Repository mit nicht committeten Änderungen diesen Befehl aus:

```
/review-loop:review-loop
```

Das Hinzufügen des Marketplace registriert nur den Katalog. Jedes Plugin wird einzeln installiert. So bekommst du nur, was du auswählst.

## review-loop

Vor deinem Commit führt review-loop eine kurze Schleife aus und stoppt selbstständig.

1. **Checks.** review-loop führt die Skripte `typecheck`, `lint` und `test` aus deiner `package.json` aus. Ein fehlgeschlagener Check wird zu einem P1-Finding. Eine `package.json` mit ungültigem JSON wird ebenfalls zu einem P1-Finding. Wenn ein Check sein Zeitlimit überschreitet, meldet review-loop ihn als "nicht verifiziert" und nicht als fehlgeschlagen.
2. **Neues Review.** Ein separater Reviewer-Agent bekommt den Diff und eine einzeilige Zusammenfassung deines Ziels. Er bekommt nicht Claudes Überlegungen zu der Änderung. Er kann den umliegenden Code lesen, um den Kontext zu verstehen. Er kennzeichnet Findings mit P1 bis P5. P1 und P2 brauchen Belege: die genaue Zeile, ein Fehlerszenario und eine Begründung, warum nichts Bestehendes den Fehler bereits verhindert. Behauptungen ohne Belege zeigt review-loop dir als nicht verifiziert.
3. **Beheben.** Claude sagt, was es beheben wird, und behebt dann P1 und P2. Wenn ein Fix eine Designentscheidung braucht (mehr als ein möglicher Weg, eine sichtbare Verhaltensänderung, das Entfernen eines Features, Änderungen an Tests), entscheidest du zuerst.
4. **Erneutes Review.** Ein neuer Reviewer prüft nur die Fixes und die noch offenen Findings. Es gibt maximal 3 Runden.
5. **Stoppen.** Ein Skript entscheidet über den Stopp, nicht das Modell. Das Skript stoppt in diesen Fällen: Es gibt kein P1 oder P2 mehr, das Rundenlimit ist erreicht, ein Finding übersteht zwei Fixes, ein gelöstes Finding kommt zurück, P1 + P2 sinkt nicht mehr, oder ein Fix schwächt Tests oder Checks.
6. **Entscheiden.** Du entscheidest einmal über den Rest: alle P3 bis P5 und jedes P1- oder P2-Finding, das noch offen oder nicht verifiziert ist. Für jedes Finding wählst du: so lassen, nur dieses Mal beheben oder eine Regel daraus machen.
7. **Commit.** Claude fragt vor dem Commit, außer du hast "in diesem Repo nicht mehr fragen" gewählt. Claude pusht nie. Wenn du das Commit-Gate einschaltest, macht ein Hook daraus eine Regel: Claudes Commits sind blockiert, bis ein Review bestanden ist.

### Commit-Gate

Das Commit-Gate ist ein Hook. Dieser Hook ist aus, bis du ihn in einem Repository einschaltest. Am Ende eines Reviews fragt Claude einmal, ob es das Gate einschalten soll. Wenn das Gate an ist, prüft das Gate zuerst jeden `git commit`, den Claude ausführt:

| Situation | Was das Gate tut |
|---|---|
| Kein Review, oder Dateien wurden geändert, die das Review nicht abgedeckt hat | Blockiert den Commit und sagt Claude, dass es das Review ausführen soll |
| Eine Review-Schleife läuft, oder Entscheidungen sind noch offen | Blockiert den Commit |
| Das Review ist bestanden | Fragt dich vor dem Commit, oder erlaubt den Commit, wenn du Commits in diesem Repository delegiert hast |
| Nach dem Review wurden nur geprüfte Dateien geändert | Fragt dich |
| `git push` oder ein Force-Push | Fragt immer, auch mit Delegation |
| Ein Commit mit `--no-verify` | Fragt, auch mit Delegation, und blockiert weiterhin einen Commit ohne bestandenes Review |
| Ein Commit in einem Ordner, den das Gate nicht lesen kann, etwa `cd "$(...)"` oder ein Pfad, der nicht existiert | Fragt, auch mit Delegation, wenn das Gate in dem Repository eingeschaltet ist, in dem du Claude Code gestartet hast |

Wenn du einmal ohne Review committen willst, bitte Claude, das Review dieses Mal zu überspringen. Die Gate-Einstellung und die Commit-Delegation gelten für das ganze Repository, auch für seine verknüpften Worktrees. Jeder Worktree hat sein eigenes Review.

Jede Runde endet mit einem Bericht:

```
Review round 2 of 3
Checks: test passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

### Schweregrad

Die Stufen basieren auf der öffentlichen Pn-Regel von Banksalad.

| Stufe | Bedeutung | Verhalten der Schleife |
|---|---|---|
| P1 | Muss behoben werden: ein fehlgeschlagener Check, Datenverlust, eine Sicherheitslücke, ein Absturz, oder das angeforderte Feature funktioniert nicht | Wird nur mit Belegen behoben |
| P2 | Sollte behoben werden: ein Bug, den eine bestimmte Eingabe reproduziert, eine fehlende Anforderung, eine verletzte Projektregel | Wird nur mit Belegen behoben |
| P3 | Lohnt sich zu beheben: Wartbarkeit, ein irreführender Name, ein fehlender Test für einen Nebenpfad | Du entscheidest |
| P4 | Optional: eine strukturelle Vorliebe, bei der Menschen unterschiedlicher Meinung sind | Du entscheidest |
| P5 | Trivial: ein Tippfehler oder Formatierung | Du entscheidest |

### Gemessen

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) listet 68 Verhaltensweisen auf sechs Achsen: do, tell, ask, silence, stop und evidence. Unit-Tests in der CI decken 66 davon ab. Dazu gehören Läufe gegen echte temporäre git-Repositories und gegen den Commit-Gate-Hook. Die übrigen 2 brauchen einen Lauf mit einem Modell und sind für `claude plugin eval` geplant: einmal nach P3 bis P5 fragen und den Bericht vor jeder Frage zeigen.

review-loop prüft die Pull Requests von LIM selbst. [#8](https://github.com/lee-eojin/lim/pull/8) zeigt zwei Schleifen auf der ersten Version von review-loop. Eine davon stoppte wegen eines False Positive im eigenen Check auf geschwächte Tests. Dieser Fehler wurde danach behoben.

### Daten

Zustand, Diffs, Check-Logs und ein Entscheidungsprotokoll liegen in `.git/lim/review-loop/` in deinem Repository. review-loop schreibt nichts in deinen Working Tree. Lösche diesen Ordner, um alles zurückzusetzen.

review-loop sendet selbst keine Netzwerkanfragen. Claude und der Reviewer lesen den Diff, die Findings und die Check-Ausgabe wie jede andere Datei in deiner Session. Darum geht dieser Inhalt auf dieselbe Weise an den Modellanbieter wie der Rest deiner Claude-Code-Session.

### Grenzen

- review-loop erkennt Checks nur aus den Skripten in `package.json`.
- Jeder Check bekommt maximal 5 Minuten. Alle Checks zusammen bekommen maximal 9 Minuten. Setze `LIM_CHECK_TIMEOUT_MS`, um das Limit pro Check zu ändern.
- Ohne Commit-Gate ist die Frage vor einem Commit eine Anweisung an Claude, keine Garantie.
- Das Commit-Gate prüft nur Befehle, die Claude über sein Bash-Tool ausführt. Commits, die du in deinem eigenen Terminal eingibst, prüft es nicht. git-Aliase wie `git ci` erkennt es nicht.
- Wenn du Claude Code in einem Ordner startest, der kein Repository ist, kann das Gate einen Commit nicht prüfen, dessen Repository es nicht erkennen kann, zum Beispiel nach `cd "$(...)"`.
- review-loop prüft alles, was `git add -A` einschließen würde. Eine von Hand ausgewählte Menge von gestagten Änderungen prüft es nicht.

## FAQ

**Startet review-loop von selbst?**
Nicht immer. Claude startet einen Skill nur, wenn Claude entscheidet, dass die Beschreibung des Skills zum Gespräch passt. Wenn du Claude um ein Review oder einen Commit bittest, kann Claude review-loop starten. Das ist aber nicht garantiert. Der Befehl `/review-loop:review-loop` startet review-loop immer. Wenn du das Commit-Gate einschaltest, wird ein Commit ohne Review blockiert. Claude bekommt dann die Anweisung, zuerst review-loop auszuführen.

**Pusht oder merged es?**
Nie. review-loop fragt vor jedem Commit, außer du wählst "in diesem Repo nicht mehr fragen". Du kannst das wieder ausschalten: Bitte Claude, die Commit-Delegation von review-loop auszuschalten.

**Gibt es Konflikte mit meinen anderen Plugins?**
review-loop fügt einen Skill, einen Agent und einen Hook hinzu. Der Hook liest Bash-Befehle und reagiert nur auf `git commit` und `git push`. Wenn du das Commit-Gate in diesem Repository nicht eingeschaltet hast, tut der Hook nichts. Seine Namen beginnen mit `review-loop:`. Darum können sie nicht mit Namen aus anderen Plugins kollidieren. Wenn du in normalen Worten fragst, kann Claude stattdessen einen anderen Review-Skill wählen. Der Befehl startet immer review-loop.

**Was passiert, wenn eine Session mitten in einer Schleife endet?**
Führe den Befehl erneut aus. review-loop bietet zwei Wege an: Es macht ab der Runde und dem Schritt weiter, wo es gestoppt hat, oder es beginnt neu.

**Wie deinstalliere ich es?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

Lösche danach `.git/lim/review-loop/` in jedem Repository, in dem du review-loop ausgeführt hast.

## Wie LIM entsteht

- **Zuerst Issues.** Jede Änderung beginnt mit einem Issue. Sie kommt über einen Pull Request in das Projekt, den ein Maintainer per Squash-Merge zusammenführt.
- **Versionen pro Plugin.** Jedes Plugin folgt Semantic Versioning, hat ein eigenes `CHANGELOG.md` und bekommt Tags im Format `<plugin>--v<version>`. Minor- und Major-Releases bekommen ein GitHub Release.
- **Bewusst klein.** Ein Plugin hat einen Einstiegs-Skill, eine `SKILL.md` mit weniger als 250 Zeilen und nur Opt-in-Hooks.

## Roadmap

- review-loop: eine Option, jedes P2 vor dem Beheben zu bestätigen ([#4](https://github.com/lee-eojin/lim/issues/4)), ein stärkerer Check auf geschwächte Tests ([#6](https://github.com/lee-eojin/lim/issues/6)), schnellere Snapshots in großen Repositories ([#7](https://github.com/lee-eojin/lim/issues/7))
- forge: ein Bericht zur Treue für Reviewer-Skills, die aus Pull-Request-Kommentaren abgeleitet sind
- Evals auf Modell-Ebene mit `claude plugin eval` für die Verhaltensweisen, die Unit-Tests nicht abdecken können

## Mitwirken

Issues und Pull Requests sind willkommen. Beginne mit [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Lizenz

MIT. Siehe [LICENSE](../../LICENSE).
