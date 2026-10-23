# LIM

**Less is more.** Plugins pequenos para o Claude Code. Cada plugin faz um único trabalho e mostra as medições que o sustentam.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Este documento é uma tradução do [README em inglês](../../README.md) na versão de 2026-10-19. Se os dois documentos forem diferentes, o README em inglês é o correto.

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | Português (Brasil) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | [Bahasa Indonesia](README.id.md)

## Por que LIM

Harnesses de agentes grandes carregam muitas instruções em cada sessão e executam hooks em muitos comandos. O LIM mantém cada plugin pequeno, opcional e medido.

- **Um plugin, um trabalho.** Instale apenas o que você precisa. O review-loop adiciona cerca de 188 tokens a uma sessão, de acordo com `claude plugin details`.
- **Primeiro as verificações, depois as opiniões.** Seus testes, seus tipos e seu lint rodam antes de qualquer revisão do modelo.
- **Os hooks são opt-in.** Um hook não faz nada até que você o ative em um repositório.
- **Perguntar antes de instalar.** Se um plugin precisa de algo, ele explica primeiro: o que é, o que melhora, onde fica e como remover.
- **Mostrar os números.** Cada plugin inclui o que foi medido e o que essa medição não cobre.

## Plugins

| Plugin | Status | Um trabalho |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.2.1 | Revisa suas alterações antes do commit, corrige os achados P1 e P2, revisa de novo e entrega o restante para você. |
| forge | planejado | Transforma os comentários de pull request de um revisor em uma skill de revisor, com um relatório sobre a fidelidade dessa skill. |

## Início rápido

Você precisa do Claude Code, do git e do Node.js 18 ou de uma versão mais recente.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Se o Claude Code pedir, reinicie o Claude Code. Depois, em um repositório git com alterações sem commit, execute:

```
/review-loop:review-loop
```

Adicionar o marketplace apenas registra o catálogo. Cada plugin é instalado separadamente, então você recebe apenas os plugins que escolher.

## review-loop

Antes do seu commit, o review-loop executa um ciclo curto e para sem a sua intervenção.

1. **Verificações.** O review-loop executa os scripts `typecheck`, `lint` e `test` do seu `package.json`. Se uma verificação falhar, ou se o seu `package.json` não for um JSON válido, o resultado é um achado P1. Se uma verificação passar do limite de tempo, o review-loop informa essa verificação como "não verificada", e não como falha.
2. **Revisão nova.** Um agente revisor separado recebe o diff e um resumo de uma linha do que você queria. O revisor não recebe o raciocínio do Claude sobre a alteração. O revisor pode ler o código ao redor para entender o contexto. O revisor classifica os achados de P1 a P5. P1 e P2 precisam de evidência: a linha exata, um cenário de falha e o motivo pelo qual nada no código já impede o problema. Se uma afirmação não tiver evidência, o review-loop mostra essa afirmação para você como não verificada.
3. **Correção.** O Claude diz o que vai corrigir e depois corrige P1 e P2. Se uma correção precisar de uma decisão de design (mais de uma forma de corrigir, uma mudança de comportamento visível, remover uma funcionalidade, alterar testes), você escolhe primeiro. Para ver cada P2 (ou cada P1 e P2) antes de qualquer mudança, peça ao Claude para confirmá-los com você primeiro.
4. **Nova revisão.** Um revisor novo verifica apenas as correções e os achados que continuam abertos. O ciclo tem no máximo 3 rodadas.
5. **Parada.** Um script, e não o modelo, decide quando o ciclo para. O ciclo para nestes casos: não restam P1 nem P2, o limite de rodadas é atingido, um achado continua aberto depois de duas correções, um achado resolvido volta a aparecer, P1 + P2 para de diminuir, ou uma correção enfraquece os testes ou as verificações.
6. **Decisão.** Você decide o restante uma única vez: todos os P3 a P5, mais qualquer P1 ou P2 que continua aberto, não verificado ou sobre um arquivo fora do diff revisado. Para cada achado, você escolhe: manter como está, corrigir só desta vez ou transformar em uma regra.
7. **Commit.** O Claude pergunta antes do commit, a menos que você tenha escolhido "parar de perguntar neste repositório". O Claude nunca faz push. Se você ativar o commit gate, um hook transforma isso em uma regra: os commits do Claude ficam bloqueados até que uma revisão seja aprovada.

### Commit gate

O commit gate é um hook. Esse hook fica desativado até que você o ative em um repositório. No fim de uma revisão, o Claude pergunta uma vez se você quer ativá-lo. Com o gate ativado, o gate verifica primeiro cada `git commit` que o Claude executa:

| Situação | O que o gate faz |
|---|---|
| Não há revisão, ou mudaram arquivos que a revisão não cobriu | Bloqueia o commit e diz ao Claude para executar a revisão |
| Um ciclo de revisão está em andamento, ou ainda há decisões pendentes | Bloqueia o commit |
| A revisão foi aprovada | Pergunta a você antes do commit, ou permite o commit se você delegou os commits neste repositório |
| Depois da revisão, só mudaram arquivos revisados | Pergunta a você |
| `git push` ou um force push | Sempre pergunta, mesmo com delegação |
| Um commit com `--no-verify` | Pergunta, mesmo com delegação, e continua bloqueando um commit sem uma revisão aprovada |
| Um commit em uma pasta que o gate não consegue ler, como `cd "$(...)"` ou um caminho que não existe | Pergunta, mesmo com delegação, se o gate estiver ativado no repositório onde você iniciou o Claude Code |

Para fazer um commit uma única vez sem revisão, peça ao Claude para pular a revisão desta vez. A configuração do gate e a delegação de commits valem para o repositório inteiro, incluindo seus worktrees vinculados. Cada worktree tem sua própria revisão.

Cada rodada termina com um relatório:

```
Review round 2 of 3
Checks: test passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

### Severidade

A escala é baseada na regra Pn pública do Banksalad.

| Nível | Significado | Comportamento do ciclo |
|---|---|---|
| P1 | Correção obrigatória: uma verificação que falha, perda de dados, uma falha de segurança, um crash, ou a funcionalidade pedida não funciona | Corrigido apenas se tiver evidência |
| P2 | Correção necessária: um bug que uma entrada específica reproduz, um requisito que falta, uma regra do projeto que não é cumprida | Corrigido apenas se tiver evidência |
| P3 | Correção útil: manutenibilidade, um nome que confunde, um teste que falta em um caminho secundário | Você decide |
| P4 | Opcional: uma preferência de estrutura em que as pessoas discordam | Você decide |
| P5 | Trivial: um erro de digitação ou a formatação | Você decide |

Um P1 ou P2 sobre um arquivo que não está no diff que a rodada revisou não é corrigido no ciclo. Ele chega até você no final, marcado como fora do diff revisado, e mantém sua severidade.

### Medições

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) lista 78 comportamentos em seis eixos: `do`, `tell`, `ask`, `silence`, `stop` e `evidence`. Os testes unitários no CI cobrem 76 desses comportamentos, incluindo execuções em repositórios git temporários reais e o hook de commit gate. Os outros 2 precisam de uma execução do modelo e estão planejados para `claude plugin eval`: perguntar uma única vez sobre P3 a P5 e mostrar o relatório antes de qualquer pergunta.

O review-loop revisa os pull requests do próprio LIM. O [#8](https://github.com/lee-eojin/lim/pull/8) mostra dois ciclos na primeira versão do review-loop. Um desses ciclos parou por causa de um falso positivo na verificação de enfraquecimento de testes do próprio review-loop. Depois, esse falso positivo foi corrigido.

### Dados

O estado, os diffs, os logs das verificações e um registro de decisões ficam em `.git/lim/review-loop/` dentro do seu repositório. O review-loop não grava nada na sua working tree. Para reiniciar, apague essa pasta.

O review-loop não faz chamadas de rede próprias. O Claude e o revisor leem o diff, os achados e a saída das verificações como qualquer outro arquivo da sua sessão. Por isso, esse conteúdo vai para o provedor do modelo da mesma forma que o restante da sua sessão do Claude Code.

### Limites

- O review-loop detecta as verificações apenas a partir dos scripts do `package.json`.
- Cada verificação tem no máximo 5 minutos, e todas as verificações juntas têm no máximo 9 minutos. Para alterar o limite de cada verificação, defina `LIM_CHECK_TIMEOUT_MS`.
- Sem o commit gate, perguntar antes de um commit é uma instrução para o Claude, e não uma garantia.
- O commit gate verifica apenas os comandos que o Claude executa pela ferramenta Bash dele. Os commits que você digita no seu próprio terminal não são verificados. Aliases do git como `git ci` não são reconhecidos.
- Se você iniciar o Claude Code em uma pasta que não é um repositório, o gate não consegue verificar um commit cujo repositório ele não consegue identificar, por exemplo depois de `cd "$(...)"`.
- O review-loop revisa tudo o que `git add -A` incluiria, e não um conjunto de alterações em stage que você escolhe manualmente.

## Perguntas frequentes

**O review-loop inicia sem que eu execute o comando?**
Nem sempre. O Claude inicia uma skill apenas quando decide que a descrição da skill corresponde à conversa. Se você pedir ao Claude para revisar ou fazer um commit, o Claude pode iniciar o review-loop, mas isso não é garantido. O comando `/review-loop:review-loop` sempre inicia o review-loop. Se você ativar o commit gate, um commit sem revisão fica bloqueado. Então o Claude recebe a instrução de executar o review-loop primeiro.

**Ele faz push ou merge?**
Nunca. O review-loop pergunta antes de cada commit, a menos que você escolha "parar de perguntar neste repositório". Para desativar essa opção de novo, peça ao Claude para desativar a delegação de commits do review-loop.

**Ele entra em conflito com meus outros plugins?**
O review-loop adiciona uma skill, um agente e um hook. O hook lê comandos do Bash e só age sobre `git commit` e `git push`. O hook não faz nada se você não ativou o commit gate nesse repositório. Os nomes dele começam com `review-loop:`, então eles não podem coincidir com os nomes de outros plugins. Se você pedir com palavras comuns, o Claude pode escolher outra skill de revisão. O comando sempre inicia o review-loop.

**O que acontece se uma sessão terminar no meio de um ciclo?**
Execute o comando de novo. O review-loop oferece continuar a partir da rodada e da etapa em que parou, ou começar do zero.

**Como faço para desinstalar?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

Depois, apague `.git/lim/review-loop/` em cada repositório onde você executou o review-loop.

## Como o LIM é construído

- **Primeiro as issues.** Cada mudança começa em uma issue e chega por meio de um pull request. Um maintainer integra o pull request com squash merge.
- **Versões por plugin.** Cada plugin segue o Semantic Versioning, mantém o próprio `CHANGELOG.md` e usa tags no formato `<plugin>--v<version>`. As versões minor e major recebem um GitHub Release.
- **Pequeno por decisão.** Um plugin tem uma skill de entrada, um `SKILL.md` com menos de 250 linhas e apenas hooks opt-in.

## Roadmap

- review-loop: uma opção para confirmar cada P2 antes de corrigir ([#4](https://github.com/lee-eojin/lim/issues/4)), uma verificação mais forte de enfraquecimento de testes ([#6](https://github.com/lee-eojin/lim/issues/6)), snapshots mais rápidos em repositórios grandes ([#7](https://github.com/lee-eojin/lim/issues/7))
- forge: um relatório de fidelidade para skills de revisor extraídas de comentários de pull request
- Evals no nível do modelo com `claude plugin eval` para os comportamentos que os testes unitários não conseguem cobrir

## Como contribuir

Issues e pull requests são bem-vindos. Comece pelo [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Licença

MIT. Veja o [LICENSE](../../LICENSE).
