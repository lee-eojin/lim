# LIM

**Less is more.** De petits plugins pour Claude Code. Chaque plugin fait un seul travail et montre les mesures qui le justifient.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![verify](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=verify--*&sort=semver&label=verify)](../../plugins/verify/CHANGELOG.md)
[![clear-explain](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=clear-explain--*&sort=semver&label=clear-explain)](../../plugins/clear-explain/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Ce document est une traduction du [README en anglais](../../README.md) dans sa version du 2026-10-27. Si les deux documents sont différents, le README en anglais est la référence correcte.

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | Français | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | [Bahasa Indonesia](README.id.md)

Les agents de code écrivent vite. Ils sont bien moins bons pour remarquer ce qu'ils ont raté. L'agent qui a écrit une modification en est le plus faible réviseur, parce qu'il la relit à travers son propre raisonnement et se donne raison. Résultat : le travail part en commit sans revue, ou avec une revue faite par le contexte même qui l'a écrit.

**LIM est ma réponse : de petits plugins qui font chacun un seul travail, avec les chiffres pour le prouver.** review-loop est au centre, et verify et clear-explain travaillent à ses côtés.

**Avec review-loop, "prêt pour le commit" veut dire revu.** Vos propres tests, types et lint s'exécutent d'abord, dans les projets Node.js, Python, Go, Rust, Java (Gradle ou Maven), .NET, Ruby et Makefile, y compris jusqu'à 4 projets de sous-dossier touchés par une modification, à chaque tour. Ensuite, un réviseur avec un contexte neuf, qui ne voit jamais le raisonnement de Claude, classe les constats de P1 à P5 et doit apporter une preuve pour les plus graves. Claude corrige P1 et P2, un nouveau réviseur vérifie les corrections, et un script, et non le modèle, décide quand s'arrêter. Vous décidez du reste une seule fois, à la fin.

**La preuve en exécutant la fonctionnalité.** Avec [verify](../../plugins/verify), un constat est reproduit quand une vérification qui exécute la fonctionnalité échoue sur le code revu, et sa correction ne compte que lorsque la même vérification réussit de nouveau.

**Les remarques que vous répétez deviennent des règles.** Quand vous marquez un constat "en faire une règle", Claude rédige une règle de lint ou un test, et review-loop l'exécute sur le code d'avant la correction pour prouver qu'il détecte l'erreur. La correction d'un bug reçoit un test de régression de la même façon.

**Petit par choix.** review-loop ajoute environ 275 tokens à une session. Son hook ne fait rien tant que vous ne l'activez pas dans un dépôt. Rien n'est installé sans vous dire ce que c'est et comment le supprimer.

Forkez-le, modifiez-le, faites-en le vôtre. Les issues et les pull requests sont les bienvenues.

## Plugins

| Plugin | Statut | Un travail |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.11.6 | Fait la revue de vos modifications avant le commit, corrige les constats P1 et P2, refait la revue et vous laisse le reste. |
| [clear-explain](../../plugins/clear-explain) | 0.1.4 | Explique les concepts, le code et les erreurs avec la réponse d'abord, un seul sens par mot et les termes techniques sous leur nom officiel en anglais. |
| [verify](../../plugins/verify) | 0.5.0 | Prouve que vos fonctionnalités marchent en les exécutant, et enregistre les commandes et la sortie comme preuves. |

## Installation

Vous avez besoin de Claude Code, de git et de Node.js 18 ou d'une version ultérieure.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Si Claude Code le demande, redémarrez-le. L'ajout du marketplace enregistre uniquement le catalogue. Chaque plugin s'installe séparément, vous obtenez donc uniquement ce que vous choisissez.

## Premiers pas

Deux étapes :

1. Installez review-loop comme indiqué ci-dessus.
2. Dans un dépôt git qui contient des modifications sans commit, tapez :

```
/review-loop:review-loop
```

C'est tout. review-loop exécute vos vérifications, fait la revue de la modification, corrige ce qui doit l'être et vous interroge sur le reste. À la fin, il demande une fois s'il doit activer le commit gate dans ce dépôt, puis s'il doit faire le commit.

Vous débutez ? Le [guide](../../docs/guide/README.md), en anglais, présente une première revue, les décisions, le commit gate, le coût et les pièges courants, avec une sortie réelle.

## Utilisation

### Il suffit de `/review-loop:review-loop`

Tapez-la chaque fois que vous êtes sur le point de faire un commit. Après la commande, vous pouvez ajouter ce que vous voulez avec vos propres mots :

```
/review-loop:review-loop I changed the coupon math. Check it before I commit.
```

```
/review-loop:review-loop confirm every P2 with me before you fix anything.
```

Claude peut aussi démarrer review-loop de lui-même quand vous lui demandez une revue ou un commit, mais seulement s'il décide que la skill convient. La commande le démarre toujours.

### À quoi ressemble un tour

Chaque tour se termine par un rapport. Claude l'affiche avant toute autre chose :

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

Ici, le tour 1 a trouvé un P1. Claude l'a corrigé et a écrit un test de régression, et review-loop a montré que le test échoue sur le code d'avant la correction. Le tour 2 a confirmé la correction, donc la boucle s'est arrêtée. Il vous reste un P3.

### Exemples

<details>
<summary>Tous les prompts</summary>

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

## Déroulement d'une revue

Avant votre commit, review-loop exécute une boucle courte et s'arrête de lui-même.

1. **Vérifications.** review-loop exécute les vérifications `typecheck`, `lint` et `test` que votre projet déclare : scripts de `package.json`, cibles d'un Makefile, ou les valeurs par défaut pour Go (`go.mod`), Rust (`Cargo.toml`), les outils Python que vous configurez, Gradle, Maven, .NET et les outils Ruby que vous utilisez. Une vérification qui échoue, ou un `package.json` qui n'est pas un JSON valide, devient un constat P1. Une vérification qui dépasse sa limite de temps, ou dont le programme n'est pas installé, est signalée comme "non vérifiée" et non comme un échec.
2. **Nouvelle revue.** Un agent réviseur séparé reçoit le diff et un résumé d'une ligne de ce que vous vouliez, mais pas le raisonnement de Claude sur la modification. Il peut lire le code voisin pour comprendre le contexte. Il classe les constats de P1 à P5. P1 et P2 exigent une preuve : la ligne exacte, un scénario d'échec et la raison pour laquelle rien ne l'empêche déjà. Chaque constat porte l'étiquette measured (mesuré), inferred (déduit) ou guessed (supposé). Un P1 ou P2 sans preuve, ou étiqueté guessed, vous est présenté comme non vérifié au lieu d'être corrigé.
3. **Correction.** Claude indique ce qu'il va corriger, puis corrige P1 et P2. Si une correction exige un choix de conception (plus d'une façon de corriger, un changement de comportement visible, la suppression d'une fonctionnalité, la modification de tests), vous choisissez d'abord. Si votre projet a un script de test, Claude écrit un test de régression à partir du scénario d'échec de chaque P1 ou P2 qu'il corrige, et review-loop montre que le test échoue sur le code d'avant la correction.
4. **Revue des corrections.** Un nouveau réviseur vérifie uniquement les corrections et les constats encore ouverts. 3 tours au maximum.
5. **Arrêt.** Un script, et non le modèle, décide quand s'arrêter : il ne reste ni P1 ni P2, la limite de tours est atteinte, un constat survit à deux corrections, un constat résolu réapparaît, P1 + P2 cesse de diminuer, ou une correction affaiblit les tests ou les vérifications.
6. **Décision.** Vous décidez une seule fois pour le reste : tous les P3 à P5, plus chaque P1 ou P2 encore ouvert, qui n'a pas pu être vérifié ou qui porte sur un fichier hors du diff revu. Pour chacun, vous choisissez : garder tel quel, corriger cette fois uniquement ou en faire une règle. Un constat gardé tel quel n'est plus redemandé dans une revue suivante tant que la ligne citée ne change pas, et le rapport le compte à la place. Quand des revues précédentes de ce dépôt ont relevé l'un des quatre types que cherche le réviseur (comme une garde spéculative) 3 fois ou plus, Claude le dit et recommande d'en faire une règle au niveau le plus fort qui convient : un changement de types ou d'architecture, puis une règle de lint, puis un test.
7. **Commit.** Claude demande avant le commit, sauf si vous avez choisi "ne plus demander dans ce dépôt". Il ne fait jamais de push. Si vous activez le commit gate, un hook en fait une règle : les commits de Claude sont bloqués tant qu'une revue n'est pas validée.

Quand Claude dit qu'un point est corrigé, il dit comment il le sait : une vérification qui passe désormais relève de measured, et sa lecture du nouveau code relève de inferred. Quand vous contestez un constat, Claude revérifie l'affirmation avant de vous donner raison, et vous dit ce qu'il a vérifié.

### Ce que cherche le réviseur

Le réviseur cherche les bugs, les exigences manquantes, les règles du projet non respectées et tout ce qui empêcherait la modification de faire ce que vous avez dit vouloir. Il ne remet pas en cause ce que vous vouliez. Il cherche aussi quatre types de code que les agents ajoutent quand ils ne connaissent pas la cause d'un problème, parce que l'agent suivant les recopie :

<details>
<summary>Les quatre types</summary>

| Type | Ce que c'est | Gravité |
|---|---|---|
| Garde spéculative | Une vérification, un try/catch, un fallback ou une valeur par défaut pour un état dont rien ne montre qu'il peut se produire | P2 quand elle masque un échec, sinon P3 |
| Commentaire d'historique | Un commentaire sur qui a demandé quoi, sur la raison d'un changement dans une version précédente, ou une consigne pour les agents | P4 |
| Marqueur de raccourci | Un commentaire TODO, HACK, "temporary" ou "for now" sans lien vers une issue | P3 |
| Deuxième façon | Un helper, un pattern ou une dépendance pour une tâche que la base de code fait déjà autrement | P3 |

Une garde est justifiée là où un état légitime entre dans le code : une saisie de l'utilisateur, une lecture réseau ou fichier, ou une valeur qu'une API documente comme pouvant manquer. Une seconde vérification plus loin, pour un état déjà traité, reste spéculative. Une fixture dans [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/) contient un exemple de chaque type et vérifie que le réviseur les signale.

</details>

### Gravité

D'après la règle Pn publique de Banksalad.

| Niveau | Signification | Comportement de la boucle |
|---|---|---|
| P1 | Correction obligatoire : une vérification qui échoue, une perte de données, une faille de sécurité, un crash, ou la fonctionnalité demandée ne fonctionne pas | Corrigé si le constat a une preuve |
| P2 | Correction nécessaire : un bug qu'une entrée précise reproduit, une exigence manquante, une règle du projet non respectée | Corrigé si le constat a une preuve |
| P3 | Correction utile : la maintenabilité, un nom trompeur, un test manquant sur un chemin secondaire | Vous décidez |
| P4 | Optionnel : une préférence de structure sur laquelle les avis divergent | Vous décidez |
| P5 | Mineur : une faute de frappe ou la mise en forme | Vous décidez |

Un P1 ou P2 qui porte sur un fichier absent du diff revu par le tour n'est pas corrigé dans la boucle. Il vous arrive à la fin, marqué comme hors du diff revu, et garde sa gravité.

### Règles et tests de régression

Une remarque qu'un réviseur doit répéter est une règle qui manque. review-loop tient le compte : chaque revue enregistre le type de chaque constat dans un fichier partagé par tous les worktrees du dépôt, et un constat de l'un des quatre types ci-dessus dont le type a déjà été relevé 3 fois ou plus par des revues précédentes est marqué comme récurrent. Les étiquettes larges comme correctness sont enregistrées, mais ne comptent jamais comme récurrentes. Quand vous choisissez "en faire une règle" pour un constat, Claude cherche d'abord, dans votre configuration de lint ou dans vos tests, une règle existante qui aurait dû le détecter. Il choisit ensuite la première forme qui fonctionne : activer une règle de lint existante, écrire une règle personnalisée pour le linter que vous utilisez déjà, ou écrire un test. Le brouillon ne va jamais dans le fichier concerné par le constat.

review-loop prouve ensuite le brouillon. Il écrit le code d'avant la correction dans un dossier temporaire et y exécute vos vérifications, avec et sans le brouillon :

| Résultat | Signification |
|---|---|
| `caught` | Une vérification échoue seulement avec le brouillon. La règle détecte l'erreur. |
| `missed` | Toutes les vérifications passent avec le brouillon. Claude le révise une fois. |
| `unproven` | Une vérification a dépassé sa limite de temps, ou elle échoue aussi sans le brouillon. Claude vous dit de quel cas il s'agit. |

Une règle a besoin d'une vérification qui l'exécute. Sans script `typecheck`, `lint` ou `test`, le choix est enregistré comme "corriger cette fois uniquement" et Claude vous explique pourquoi. Un brouillon prouvé entre dans le même commit que la correction, et le message de commit le mentionne.

Chaque P1 ou P2 que Claude corrige reçoit un test de régression de la même façon, sans le demander, quand votre projet a un script de test. Pour un test de régression, seule la vérification de test compte comme preuve : si seul le lint échoue avec lui, le test n'a pas détecté le bug. Une correction sans test en donne la raison dans le rapport.

### Commit gate

Le commit gate est un hook désactivé tant que vous ne l'activez pas dans un dépôt. À la fin d'une revue, Claude demande une fois s'il doit l'activer. Quand le gate est activé, chaque `git commit` que Claude exécute est vérifié d'abord.

<details>
<summary>Ce que fait le gate</summary>

| Situation | Ce que fait le gate |
|---|---|
| Aucune revue, ou des fichiers modifiés que la revue n'a pas couverts | Bloque le commit et demande à Claude d'exécuter la revue |
| Une boucle de revue est en cours, ou des décisions sont encore en attente | Bloque le commit |
| La revue est validée | Vous demande avant le commit, ou autorise le commit si vous avez délégué les commits dans ce dépôt |
| Après la revue, seuls des fichiers déjà revus ou des brouillons de règles et des tests de régression vérifiés par `loop rule` ont changé | Vous demande |
| `git push` ou un force push | Demande toujours, même avec la délégation |
| Un commit avec `--no-verify` | Demande, même avec la délégation, et bloque toujours un commit sans revue validée |
| Un commit dans un dossier que le gate ne peut pas lire, comme `cd "$(...)"` ou un chemin qui n'existe pas | Vous demande, même avec la délégation, si le gate est activé dans le dépôt où vous avez lancé Claude Code |

Pour faire un commit une seule fois sans revue, demandez à Claude de sauter la revue cette fois. Le réglage du gate et la délégation des commits s'appliquent à tout le dépôt, y compris ses worktrees liés. Chaque worktree garde sa propre revue.

</details>

### Réglages

Les cinq premiers réglages s'appliquent à un seul dépôt. Pour en changer un, tapez la demande après `/review-loop:review-loop`, afin que Claude ait chargé les commandes de la skill. La limite de temps des vérifications est une variable d'environnement, elle s'applique donc partout où vous la définissez, et le total de 9 minutes est fixe.

| Réglage | Par défaut | À taper |
|---|---|---|
| Confirmer avant de corriger | Désactivé | "confirme avec moi chaque P2" ou "confirme avec moi chaque P1 et P2" |
| Commit gate | Demandé une fois à la fin de la première revue | "active (ou désactive) le commit gate" |
| Délégation des commits | Demande avant chaque commit | "ne demande plus avant les commits dans ce dépôt" |
| Sans surveillance | Désactivé | "exécute sans surveillance" pour une seule exécution, ou "active (ou désactive) le mode sans surveillance dans ce dépôt". Claude ne pose aucune question, laisse pour plus tard ce qui a besoin de vous et termine par un résumé de ce qu'il a fait et de ce qui vous attend |
| Modèle du réviseur | Le modèle de votre session | "fais tourner le réviseur sur sonnet dans ce dépôt" (ou opus, haiku, fable), ou "fais tourner le réviseur sur le modèle de la session". La section Mesures montre ce que chaque modèle a trouvé et coûté |
| Limite de temps des vérifications | 5 minutes par vérification, 9 minutes au total | Définissez `LIM_CHECK_TIMEOUT_MS` pour modifier la limite de chaque vérification |

## Mesures

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) liste 249 comportements sur six axes : `do`, `tell`, `ask`, `silence`, `stop` et `evidence`. Les tests unitaires de la CI couvrent 238 de ces comportements, y compris des exécutions sur de vrais dépôts git temporaires et le hook de commit gate. Les 11 autres exigent une exécution du modèle : demander une seule fois pour P3 à P5, montrer le rapport avant toute question, garder chaque étape dans la liste de tâches avec une raison pour chaque étape sautée, écrire un test de régression pour chaque P1 ou P2 corrigé, étiqueter chaque constat measured, inferred ou guessed, dire comment on sait qu'une correction fonctionne, revérifier un constat que vous contestez, recommander une règle pour un type de constat qui revient sans cesse, ne poser aucune question lors d'une exécution sans surveillance, lancer le réviseur sur le modèle choisi et signaler le code ajouté sans cause connue. Le dernier a une fixture dans [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/), et les deux premiers ont une exécution manuelle dans [`evals/review-loop/manual-behaviors.md`](../../evals/review-loop/manual-behaviors.md).

Un benchmark de détection donne au réviseur des modifications dans des dépôts temporaires dont les noms n'indiquent pas qu'il s'agit d'un test. [`evals/review-loop/detection/`](../../evals/review-loop/detection/) contient 12 modifications contenant chacune un bug introduit volontairement et 6 modifications propres. [`evals/review-loop/detection-hard/`](../../evals/review-loop/detection-hard/) contient 10 bugs plus difficiles, par exemple un bug visible seulement dans un fichier que le diff ne touche pas, un autre visible seulement en suivant quatre fichiers, un autre au milieu d'un diff de 183 lignes, une race condition entre deux recherches, un buffer vidé avant qu'une écriture asynchrone ne le lise et un verrou qui n'est pas libéré sur un chemin d'erreur, ainsi que 6 modifications propres qui ont l'air suspectes. Résultats avec 3 exécutions par cas, du 2026-10-25 pour le jeu standard et du 2026-10-26 pour le jeu difficile :

| Modèle du réviseur | Jeu standard : bugs trouvés en P1 ou P2 | Jeu standard : faux P1 ou P2 sur les modifications propres | Jeu difficile : bugs trouvés en P1 ou P2 | Jeu difficile : faux P1 ou P2 sur les modifications propres | Coût du jeu difficile (48 exécutions) |
|---|---|---|---|---|---|
| claude-opus-5-5 | 36 sur 36 | 0 sur 18 | 30 sur 30 | 0 sur 18 | 3,11 $ |
| claude-sonnet-5-5 | non exécuté | non exécuté | 29 sur 30 | 0 sur 18 | 1,14 $ |
| claude-haiku-5-5 | non exécuté | non exécuté | 30 sur 30 | 3 sur 18 | 0,09 $, selon Claude Code |

Par défaut, le réviseur tourne avec le modèle de votre session. Opus a trouvé tous les bugs introduits dans les deux jeux, donc le benchmark ne peut pas encore montrer pour lui une baisse des bugs trouvés. Pour savoir s'il permet au moins de voir un `reviewer.md` moins bon, Opus a aussi exécuté le jeu difficile avec un `reviewer.md` réduit à son format de sortie : il a encore trouvé 30 sur 30, a donné 1 faux P2 sur 18 exécutions propres et a soulevé 83 constats de P3 à P5 là où le réviseur complet en soulevait 55. Pour Opus, trouver ces bugs dépend davantage du modèle que des instructions, et un `reviewer.md` moins bon se manifeste par des fausses alertes et du bruit. Le seul échec de Sonnet n'a renvoyé aucun constat pour le buffer vidé avant une écriture asynchrone. Les 3 fausses alertes de Haiku portaient toutes sur un même cas propre, qui a aussi donné 1 faux P2 sur 9 exécutions d'Opus avec le réviseur complet sur deux jours. Un constat compte quand il nomme le bug introduit sur une ligne modifiée ou, pour un bug visible seulement dans un autre fichier, sur une ligne marquée de ce fichier. Après les premières exécutions, des mots-clés ont été ajoutés dans quatre cas où un réviseur nommait le bug introduit avec des mots que la notation n'acceptait pas, et chaque exécution enregistrée a été notée de nouveau avec eux. Relancez-le avec `node evals/review-loop/run-detection.mjs --runs 3`, et ajoutez `--cases evals/review-loop/detection-hard` pour le jeu difficile.

Le tableau ci-dessus fonde le modèle par défaut du réviseur. Sur le jeu difficile, Opus a trouvé 30 sur 30 sans faux P1 ou P2, Sonnet a trouvé 29 sur 30 sans aucun pour environ 37 % du coût d'Opus, et Haiku a trouvé 30 sur 30 avec 3 faux P1 ou P2 sur 18 exécutions propres. Le modèle par défaut reste donc celui de la session, et Sonnet est le choix le moins cher si vous voulez que le réviseur tourne sur un autre modèle que celui qui a écrit la modification.

[`evals/review-loop/detection-languages/`](../../evals/review-loop/detection-languages/) contient 6 bugs introduits en Python, Rust et Go ainsi que 2 modifications propres. Avec 3 exécutions par cas, Opus et Sonnet ont trouvé 18 sur 18 et Haiku 16 sur 18, sans aucun faux P1 ou P2 sur 6 exécutions propres pour aucun d'eux ; le [review-loop README](../../plugins/review-loop/README.md#measured-behavior) donne les détails.

<details>
<summary>Coût</summary>

`claude plugin details` estime ainsi le coût de review-loop :

| Partie | Toujours actif, à chaque session | À chaque exécution |
|---|---|---|
| skill review-loop | environ 210 tokens | environ 6000 tokens |
| agent réviseur | environ 60 tokens | environ 1800 tokens, plus le diff et le code qu'il lit |

Le coût de la skill est payé une fois par exécution. Celui du réviseur est payé une fois par tour, et une boucle compte au maximum 3 tours. Le modèle du réviseur change ce coût ; le tableau du benchmark ci-dessus le montre pour chaque modèle. Vos vérifications s'exécutent sur votre machine et ne coûtent aucun token.

</details>

review-loop fait la revue des pull requests de LIM lui-même. [#8](https://github.com/lee-eojin/lim/pull/8) montre deux boucles sur sa première version, dont un arrêt causé par un faux positif dans sa propre vérification d'affaiblissement des tests, corrigé ensuite. Les pull requests récentes, comme [#46](https://github.com/lee-eojin/lim/pull/46), montrent le rapport de review-loop et la décision prise pour chaque constat.

## Pourquoi ce fonctionnement

<details>
<summary>Pourquoi un réviseur neuf ?</summary>

L'agent qui a écrit une modification sait pourquoi chaque ligne est là, donc il la lit comme correcte. Un réviseur qui ne reçoit que le diff et une ligne d'intention doit trouver la raison dans le code. Si la raison n'y est pas, c'est un constat. Chaque tour démarre un nouveau réviseur, donc un réviseur ne juge jamais son propre verdict précédent.

</details>

<details>
<summary>Pourquoi est-ce un script qui décide de l'arrêt ?</summary>

Un modèle à qui l'on demande "est-ce terminé ?" a tendance à répondre oui. Le script de review-loop compte à la place : il s'arrête quand il ne reste ni P1 ni P2, après 3 tours, quand un constat survit à deux corrections, quand un constat résolu revient, quand P1 + P2 cesse de baisser ou quand une correction affaiblit un test. S'arrêter avec des constats ouverts est un résultat normal, et Claude le dit.

</details>

<details>
<summary>Pourquoi P1 et P2 exigent-ils une preuve ?</summary>

Dans un rapport, une affirmation assurée et une affirmation prouvée se ressemblent. Un P1 ou P2 doit citer la ligne exacte, donner une entrée qui produit un mauvais résultat et dire pourquoi rien ne l'empêche déjà. S'il manque l'un des trois, ou si le réviseur l'étiquette guessed, il est présenté comme non vérifié et Claude ne modifie pas le code pour lui.

</details>

<details>
<summary>Pourquoi le commit gate est-il opt-in ?</summary>

Un hook qui bloque des commits change votre façon de travailler, donc ce doit être votre choix, dépôt par dépôt. Sans le gate, "demander avant le commit" est une instruction que Claude suit. Avec lui, le hook bloque un `git commit` que Claude lance sans revue validée. Il ne voit pas tout : [Limites](#limites) liste ce qui lui échappe, comme les commits que vous tapez dans votre propre terminal.

</details>

<details>
<summary>Pourquoi ne fait-il jamais de push ?</summary>

Un commit est local et facile à annuler. Un push ne l'est pas. review-loop s'arrête au commit, et le gate demande avant chaque push, même quand vous avez délégué les commits.

</details>

## Données

L'état, les diffs, les logs des vérifications et un registre des décisions se trouvent dans `.git/lim/review-loop/` à l'intérieur de votre dépôt. Claude écrit chaque revue un instant dans le dossier `.lim-review/` de votre working tree ; git ignore ce dossier grâce à `.git/info/exclude`, et review-loop supprime le fichier après l'avoir lu. Pour vérifier une règle, review-loop écrit le code d'avant la correction dans un dossier temporaire hors de votre dépôt, puis le supprime. Pour réinitialiser, supprimez `.git/lim/review-loop/`.

review-loop ne fait aucun appel réseau par lui-même. Claude et le réviseur lisent le diff, les constats et la sortie des vérifications comme n'importe quel autre fichier de votre session. Ce contenu va donc au fournisseur du modèle de la même façon que le reste de votre session Claude Code.

## Limites

- Les vérifications sont détectées à partir des scripts de `package.json`, puis des cibles d'un Makefile, puis de Go, Rust, des outils Python configurés (pytest, ruff, mypy), de Gradle, de Maven, de .NET et des outils Ruby que le projet utilise (rspec, rake test, rubocop), à la racine du dépôt et dans les projets des sous-dossiers qu'une modification touche, jusqu'à 4 par tour.
- Chaque vérification dispose de 5 minutes au maximum, et l'ensemble des vérifications de 9 minutes au maximum.
- Sans le commit gate, demander avant un commit est une instruction pour Claude, et non une garantie.
- Le commit gate vérifie uniquement les commandes que Claude exécute avec son outil Bash. Les commits que vous tapez dans votre propre terminal ne sont pas vérifiés. Un commit passé par un alias git comme `git ci` est vérifié comme `git commit`, un alias shell (`!...`) qui fait un commit déclenche une question, car le gate ne peut pas voir à l'intérieur, et un alias défini en ligne avec `git -c alias.ci=commit` n'est pas reconnu.
- Si vous lancez Claude Code dans un dossier qui n'est pas un dépôt, le gate ne peut pas vérifier un commit dont il ne peut pas identifier le dépôt, par exemple après `cd "$(...)"`.
- review-loop fait la revue de tout ce que `git add -A` inclurait, et non d'un ensemble de modifications en stage que vous choisissez à la main.
- Une règle ou un test de régression est vérifié dans une copie temporaire qui contient vos fichiers suivis par git et des liens vers le `node_modules` de la racine et des projets qui contiennent le constat et les brouillons. Les autres fichiers ignorés, comme `.env`, n'y sont pas, donc une vérification qui en a besoin le signale comme non prouvé ou comme détecté pour une mauvaise raison. Claude lit l'échec pour savoir de quel cas il s'agit.

## Questions fréquentes

**Est-ce que review-loop démarre sans que je lance la commande ?**
Pas toujours. Claude démarre une skill uniquement quand il décide que la description de la skill correspond à la conversation. Si vous demandez à Claude de faire une revue ou un commit, Claude peut démarrer review-loop, mais ce n'est pas garanti. La commande `/review-loop:review-loop` démarre toujours review-loop. Si vous activez le commit gate, un commit sans revue est bloqué et Claude reçoit l'instruction d'exécuter d'abord review-loop.

**Est-ce qu'il fait un push ou un merge ?**
Jamais. review-loop demande avant chaque commit, sauf si vous choisissez "ne plus demander dans ce dépôt". Pour désactiver de nouveau cette option, demandez à Claude de désactiver la délégation des commits de review-loop.

**Est-ce qu'il entre en conflit avec mes autres plugins ?**
review-loop ajoute une skill, un agent et un hook. Le hook lit les commandes Bash, agit uniquement sur `git commit` et `git push`, et ne fait rien si vous n'avez pas activé le commit gate dans ce dépôt. Ses noms commencent par `review-loop:`, donc ils ne peuvent pas entrer en collision avec les noms d'autres plugins. Si vous formulez la demande en langage courant, Claude peut choisir une autre skill de revue. La commande démarre toujours review-loop.

**Que se passe-t-il si une session se termine au milieu d'une boucle ?**
Exécutez de nouveau la commande. review-loop propose de reprendre au tour et à l'étape où la boucle s'est arrêtée, ou de recommencer depuis le début.

**Comment le désinstaller ?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

Ensuite, supprimez `.git/lim/review-loop/` dans chaque dépôt où vous l'avez exécuté, ainsi que la ligne `.lim-review/` de son `.git/info/exclude`.

## À votre façon

review-loop fonctionne avec les vérifications que vous avez déjà. Plus vos scripts `typecheck`, `lint` et `test` sont solides, plus la part de la revue qui est mesurée, et non simplement lue, est grande.

- Vous voulez voir les constats graves avant toute modification ? Demandez à Claude de vous faire confirmer chaque P2, ou chaque P1 et P2.
- Lassé d'approuver les commits dans un dépôt de confiance ? Déléguez-y les commits. Avec le commit gate activé, les push continuent de demander.
- Vous recevez toujours la même remarque ? Choisissez "en faire une règle", et la revue suivante commence avec cette erreur déjà détectée par votre propre linter ou vos tests.
- Vous voulez un autre déroulement ? Forkez le plugin. La skill est un seul `SKILL.md` de moins de 250 lignes, et la logique de la boucle tient dans un seul script, `plugins/review-loop/skills/review-loop/scripts/loop.mjs`.

## Comment LIM est construit

- **Les issues d'abord.** Chaque changement commence par une issue et arrive par une pull request qu'un maintainer fusionne avec un squash merge.
- **Revu par lui-même.** Chaque pull request exécute review-loop sur son propre diff, et la description montre le rapport et une décision pour chaque constat.
- **Des versions par plugin.** Chaque plugin suit Semantic Versioning, tient son propre `CHANGELOG.md` et reçoit des tags au format `<plugin>--v<version>`. Les versions minor et major reçoivent une GitHub Release.
- **Petit par choix.** Un plugin a une seule skill d'entrée, un `SKILL.md` de moins de 250 lignes et uniquement des hooks opt-in.

## Feuille de route

- Des evals au niveau du modèle avec `claude plugin eval` pour les comportements que les tests unitaires ne peuvent pas couvrir, et une comparaison à l'aveugle de la qualité et du coût des revues

## Contribuer

Les issues et les pull requests sont les bienvenues. Commencez par [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Licence

MIT. Voir [LICENSE](../../LICENSE).
