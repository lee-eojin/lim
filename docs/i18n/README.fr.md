# LIM

**Less is more.** De petits plugins pour Claude Code. Chaque plugin fait un seul travail et montre les mesures qui le justifient.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Ce document est une traduction du [README en anglais](../../README.md) dans sa version du 2026-10-19. Si les deux documents sont différents, le README en anglais est la référence correcte.

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | Français | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | [Bahasa Indonesia](README.id.md)

## Pourquoi LIM

Les grands harnesses d'agents chargent de nombreuses instructions dans chaque session et exécutent des hooks sur de nombreuses commandes. LIM garde chaque plugin petit, optionnel et mesuré.

- **Un plugin, un travail.** Installez uniquement ce dont vous avez besoin. review-loop ajoute environ 188 tokens à une session, d'après `claude plugin details`.
- **Les vérifications d'abord, les opinions ensuite.** Vos tests, vos types et votre lint s'exécutent avant toute revue par le modèle.
- **Les hooks sont opt-in.** Un hook ne fait rien tant que vous ne l'activez pas dans un dépôt.
- **Demander avant d'installer.** Si un plugin a besoin de quelque chose, il l'explique d'abord : ce que c'est, ce que cela améliore, où cela se trouve et comment le supprimer.
- **Montrer les chiffres.** Chaque plugin est livré avec ce qui a été mesuré et ce que cette mesure ne couvre pas.

## Plugins

| Plugin | Statut | Un travail |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.2.0 | Fait la revue de vos modifications avant le commit, corrige les constats P1 et P2, refait la revue et vous laisse le reste. |
| forge | prévu | Transforme les commentaires de pull request d'un réviseur en une skill de réviseur, avec un rapport sur la fidélité de cette skill. |

## Démarrage rapide

Vous avez besoin de Claude Code, de git et de Node.js 18 ou d'une version ultérieure.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Si Claude Code le demande, redémarrez Claude Code. Ensuite, dans un dépôt git qui contient des modifications sans commit, exécutez :

```
/review-loop:review-loop
```

L'ajout du marketplace enregistre uniquement le catalogue. Chaque plugin s'installe séparément. Vous obtenez donc uniquement les plugins que vous choisissez.

## review-loop

Avant votre commit, review-loop exécute une boucle courte et s'arrête sans votre intervention.

1. **Vérifications.** review-loop exécute les scripts `typecheck`, `lint` et `test` de votre `package.json`. Si une vérification échoue, ou si votre `package.json` n'est pas un JSON valide, le résultat est un constat P1. Si une vérification dépasse sa limite de temps, review-loop signale cette vérification comme "non vérifiée" et non comme un échec.
2. **Nouvelle revue.** Un agent réviseur séparé reçoit le diff et un résumé d'une ligne de ce que vous vouliez. Le réviseur ne reçoit pas le raisonnement de Claude sur la modification. Le réviseur peut lire le code voisin pour comprendre le contexte. Le réviseur classe les constats de P1 à P5. P1 et P2 exigent une preuve : la ligne exacte, un scénario d'échec et la raison pour laquelle rien dans le code n'empêche déjà le problème. Si une affirmation n'a pas de preuve, review-loop vous la montre comme non vérifiée.
3. **Correction.** Claude indique ce qu'il va corriger, puis corrige P1 et P2. Si une correction exige un choix de conception (plus d'une façon de corriger, un changement de comportement visible, la suppression d'une fonctionnalité, la modification de tests), vous choisissez d'abord.
4. **Revue des corrections.** Un nouveau réviseur vérifie uniquement les corrections et les constats encore ouverts. La boucle compte au maximum 3 tours.
5. **Arrêt.** Un script, et non le modèle, décide quand la boucle s'arrête. La boucle s'arrête dans ces cas : il ne reste ni P1 ni P2, la limite de tours est atteinte, un constat reste ouvert après deux corrections, un constat résolu réapparaît, P1 + P2 cesse de diminuer, ou une correction affaiblit les tests ou les vérifications.
6. **Décision.** Vous décidez une seule fois pour le reste : tous les P3 à P5, et chaque P1 ou P2 encore ouvert ou non vérifié. Pour chaque constat, vous choisissez : garder tel quel, corriger cette fois uniquement ou en faire une règle.
7. **Commit.** Claude demande avant le commit, sauf si vous avez choisi "ne plus demander dans ce dépôt". Claude ne fait jamais de push. Si vous activez le commit gate, un hook en fait une règle : les commits de Claude sont bloqués tant qu'une revue n'est pas validée.

### Commit gate

Le commit gate est un hook. Ce hook est désactivé tant que vous ne l'activez pas dans un dépôt. À la fin d'une revue, Claude demande une fois s'il doit l'activer. Quand le gate est activé, le gate vérifie d'abord chaque `git commit` que Claude exécute :

| Situation | Ce que fait le gate |
|---|---|
| Aucune revue, ou des fichiers modifiés que la revue n'a pas couverts | Bloque le commit et demande à Claude d'exécuter la revue |
| Une boucle de revue est en cours, ou des décisions sont encore en attente | Bloque le commit |
| La revue est validée | Vous demande avant le commit, ou autorise le commit si vous avez délégué les commits dans ce dépôt |
| Après la revue, seuls des fichiers déjà revus ont changé | Vous demande |
| `git push` ou un force push | Demande toujours, même avec la délégation |
| Un commit avec `--no-verify` | Demande, même avec la délégation, et bloque toujours un commit sans revue validée |

Pour faire un commit une seule fois sans revue, demandez à Claude de sauter la revue cette fois.

Chaque tour se termine par un rapport :

```
Review round 2 of 3
Checks: test passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

### Gravité

L'échelle s'appuie sur la règle Pn publique de Banksalad.

| Niveau | Signification | Comportement de la boucle |
|---|---|---|
| P1 | Correction obligatoire : une vérification qui échoue, une perte de données, une faille de sécurité, un crash, ou la fonctionnalité demandée ne fonctionne pas | Corrigé uniquement si le constat a une preuve |
| P2 | Correction nécessaire : un bug qu'une entrée précise reproduit, une exigence manquante, une règle du projet non respectée | Corrigé uniquement si le constat a une preuve |
| P3 | Correction utile : la maintenabilité, un nom trompeur, un test manquant sur un chemin secondaire | Vous décidez |
| P4 | Optionnel : une préférence de structure sur laquelle les avis divergent | Vous décidez |
| P5 | Mineur : une faute de frappe ou la mise en forme | Vous décidez |

### Mesures

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) liste 49 comportements sur six axes : `do`, `tell`, `ask`, `silence`, `stop` et `evidence`. Les tests unitaires de la CI couvrent 47 de ces comportements, y compris des exécutions sur de vrais dépôts git temporaires et le hook de commit gate. Les 2 autres exigent une exécution du modèle et sont prévus pour `claude plugin eval` : demander une seule fois pour P3 à P5 et montrer le rapport avant toute question.

review-loop fait la revue des pull requests de LIM lui-même. [#8](https://github.com/lee-eojin/lim/pull/8) montre deux boucles sur la première version de review-loop. Une de ces boucles s'est arrêtée à cause d'un faux positif dans la vérification d'affaiblissement des tests de review-loop. Ce faux positif a ensuite été corrigé.

### Données

L'état, les diffs, les logs des vérifications et un registre des décisions se trouvent dans `.git/lim/review-loop/` à l'intérieur de votre dépôt. review-loop n'écrit rien dans votre working tree. Pour réinitialiser, supprimez ce dossier.

review-loop ne fait aucun appel réseau par lui-même. Claude et le réviseur lisent le diff, les constats et la sortie des vérifications comme n'importe quel autre fichier de votre session. Ce contenu va donc au fournisseur du modèle de la même façon que le reste de votre session Claude Code.

### Limites

- review-loop détecte les vérifications uniquement à partir des scripts de `package.json`.
- Chaque vérification dispose de 5 minutes au maximum, et l'ensemble des vérifications dispose de 9 minutes au maximum. Pour modifier la limite de chaque vérification, définissez `LIM_CHECK_TIMEOUT_MS`.
- Sans le commit gate, demander avant un commit est une instruction pour Claude, et non une garantie.
- Le commit gate vérifie uniquement les commandes que Claude exécute avec son outil Bash. Les commits que vous tapez dans votre propre terminal ne sont pas vérifiés. Les alias git comme `git ci` ne sont pas reconnus.
- review-loop fait la revue de tout ce que `git add -A` inclurait, et non d'un ensemble de modifications en stage que vous choisissez à la main.

## Questions fréquentes

**Est-ce que review-loop démarre sans que je lance la commande ?**
Pas toujours. Claude démarre une skill uniquement quand il décide que la description de la skill correspond à la conversation. Si vous demandez à Claude de faire une revue ou un commit, Claude peut démarrer review-loop, mais ce n'est pas garanti. La commande `/review-loop:review-loop` démarre toujours review-loop. Si vous activez le commit gate, un commit sans revue est bloqué. Claude reçoit alors l'instruction d'exécuter d'abord review-loop.

**Est-ce qu'il fait un push ou un merge ?**
Jamais. review-loop demande avant chaque commit, sauf si vous choisissez "ne plus demander dans ce dépôt". Pour désactiver de nouveau cette option, demandez à Claude de désactiver la délégation des commits de review-loop.

**Est-ce qu'il entre en conflit avec mes autres plugins ?**
review-loop ajoute une skill, un agent et un hook. Le hook lit les commandes Bash et agit uniquement sur `git commit` et `git push`. Si vous n'avez pas activé le commit gate dans ce dépôt, le hook ne fait rien. Ses noms commencent par `review-loop:`. Ces noms ne peuvent donc pas entrer en collision avec les noms d'autres plugins. Si vous formulez la demande en langage courant, Claude peut choisir une autre skill de revue. La commande démarre toujours review-loop.

**Que se passe-t-il si une session se termine au milieu d'une boucle ?**
Exécutez de nouveau la commande. review-loop propose de reprendre au tour et à l'étape où la boucle s'est arrêtée, ou de recommencer depuis le début.

**Comment le désinstaller ?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

Ensuite, supprimez `.git/lim/review-loop/` dans chaque dépôt où vous avez exécuté review-loop.

## Comment LIM est construit

- **Les issues d'abord.** Chaque changement commence par une issue et arrive par une pull request. Un maintainer fusionne la pull request avec un squash merge.
- **Des versions par plugin.** Chaque plugin suit Semantic Versioning, tient son propre `CHANGELOG.md` et reçoit des tags au format `<plugin>--v<version>`. Les versions minor et major reçoivent une GitHub Release.
- **Petit par choix.** Un plugin a une seule skill d'entrée, un `SKILL.md` de moins de 250 lignes et uniquement des hooks opt-in.

## Feuille de route

- review-loop : une option pour confirmer chaque P2 avant correction ([#4](https://github.com/lee-eojin/lim/issues/4)), une vérification plus stricte de l'affaiblissement des tests ([#6](https://github.com/lee-eojin/lim/issues/6)), des snapshots plus rapides sur les grands dépôts ([#7](https://github.com/lee-eojin/lim/issues/7))
- forge : un rapport de fidélité pour les skills de réviseur tirées de commentaires de pull request
- Des evals au niveau du modèle avec `claude plugin eval` pour les comportements que les tests unitaires ne peuvent pas couvrir

## Contribuer

Les issues et les pull requests sont les bienvenues. Commencez par [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Licence

MIT. Voir [LICENSE](../../LICENSE).
