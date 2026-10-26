# LIM

**Less is more.** Plugins pequenos para o Claude Code. Cada plugin faz um único trabalho e mostra as medições que o sustentam.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Este documento é uma tradução do [README em inglês](../../README.md) na versão de 2026-10-24. Se os dois documentos forem diferentes, o README em inglês é o correto.

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | Português (Brasil) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | [Bahasa Indonesia](README.id.md)

Agentes de programação escrevem código rápido. Eles são bem piores em perceber o que fizeram de errado. O agente que escreveu uma alteração é o revisor mais fraco dela, porque lê a alteração através do próprio raciocínio e concorda consigo mesmo. Assim, o trabalho vai para o commit sem revisão, ou com uma revisão feita pelo mesmo contexto que o escreveu.

**O LIM é a minha resposta: plugins pequenos que fazem um único trabalho cada, com os números que os sustentam.** O primeiro é o review-loop.

**O review-loop faz "pronto para o commit" significar revisado.** Seus próprios testes, tipos e lint rodam primeiro. Depois, um revisor com um contexto novo, que nunca vê o raciocínio do Claude, classifica os achados de P1 a P5 e precisa mostrar evidência para os graves. O Claude corrige P1 e P2, um revisor novo verifica as correções e um script, e não o modelo, decide quando parar. Você decide o restante uma única vez, no final.

**Os comentários que você vive repetindo viram regras.** Quando você marca um achado como "transformar em uma regra", o Claude escreve o rascunho de uma regra de lint ou de um teste, e o review-loop o executa no código de antes da correção para provar que ele detecta o erro. A correção de um bug ganha um teste de regressão da mesma forma.

**Pequeno de propósito.** O review-loop adiciona cerca de 212 tokens a uma sessão. O hook dele não faz nada até que você o ative em um repositório. Nada é instalado sem que você saiba o que é e como remover.

Faça um fork, mude, deixe do seu jeito. Issues e pull requests são bem-vindos.

## Plugins

| Plugin | Status | Um trabalho |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.6.0 | Revisa suas alterações antes do commit, corrige os achados P1 e P2, revisa de novo e entrega o restante para você. |
| [clear-explain](../../plugins/clear-explain) | 0.1.0 | Explica conceitos, código e erros com a resposta primeiro, um só significado por palavra e os termos técnicos com o nome oficial em inglês. |
| [verify](../../plugins/verify) | 0.1.0 | Prova que suas funcionalidades funcionam executando-as e salva os comandos e a saída como evidência. |

## Instalação

Você precisa do Claude Code, do git e do Node.js 18 ou de uma versão mais recente.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Se o Claude Code pedir, reinicie o Claude Code. Adicionar o marketplace apenas registra o catálogo. Cada plugin é instalado separadamente, então você recebe apenas o que escolher.

## Primeiros passos

Dois passos:

1. Instale o review-loop como mostrado acima.
2. Em um repositório git com alterações sem commit, digite:

```
/review-loop:review-loop
```

É só isso. O review-loop executa as suas verificações, revisa a alteração, corrige o que precisa ser corrigido e pergunta a você sobre o restante. No final, ele pergunta uma vez se deve ativar o commit gate neste repositório e, depois, se deve fazer o commit.

Primeira vez? O [guia](../../docs/guide/README.md), em inglês, mostra o primeiro review, como decidir, o commit gate, o custo e as armadilhas comuns, com saída real.

## Uso

### Basta usar `/review-loop:review-loop`

Digite o comando sempre que for fazer um commit. Depois do comando, você pode acrescentar o que quiser com as suas próprias palavras:

```
/review-loop:review-loop I changed the coupon math. Check it before I commit.
```

```
/review-loop:review-loop confirm every P2 with me before you fix anything.
```

O Claude também pode iniciar o review-loop por conta própria quando você pede para revisar ou fazer um commit, mas só quando decide que a skill se encaixa. O comando sempre o inicia.

### Como é uma rodada

Cada rodada termina com um relatório. O Claude mostra o relatório antes de qualquer outra coisa:

```
Review round 2 of 3 (reviewer: session model)
Checks: test passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal (fixed, inferred: the re-review read the fix)
  test: src/coupon.test.js (before the fix: caught, after: passed)

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

Aqui a rodada 1 encontrou um P1. O Claude o corrigiu e escreveu um teste de regressão, e o review-loop mostrou que o teste falha no código de antes da correção. A rodada 2 confirmou a correção, então o ciclo parou. Sobra um P3 para você.

### Exemplos

<details>
<summary>Todos os prompts</summary>

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

## Como uma revisão funciona

Antes do seu commit, o review-loop executa um ciclo curto e para sozinho.

1. **Verificações.** O review-loop executa os scripts `typecheck`, `lint` e `test` do seu `package.json`. Uma verificação que falha, ou um `package.json` que não é um JSON válido, vira um achado P1. Uma verificação que passa do limite de tempo é informada como "não verificada", e não como falha.
2. **Revisão nova.** Um agente revisor separado recebe o diff e um resumo de uma linha do que você queria, mas não o raciocínio do Claude sobre a alteração. Ele pode ler o código ao redor para entender o contexto. Ele classifica os achados de P1 a P5. P1 e P2 precisam de evidência: a linha exata, um cenário de falha e o motivo pelo qual nada já impede o problema. Cada achado é rotulado como measured (medido), inferred (deduzido) ou guessed (suposto). Um P1 ou P2 sem evidência, ou um guessed, aparece para você como não verificado em vez de ser corrigido.
3. **Correção.** O Claude diz o que vai corrigir e depois corrige P1 e P2. Se uma correção precisar de uma decisão de design (mais de uma forma de corrigir, uma mudança de comportamento visível, remover uma funcionalidade, alterar testes), você escolhe primeiro. Se o seu projeto tem um script de test, o Claude escreve um teste de regressão a partir do cenário de falha de cada P1 ou P2 que corrige, e o review-loop mostra que o teste falha no código de antes da correção.
4. **Nova revisão.** Um revisor novo verifica apenas as correções e os achados que continuam abertos. No máximo 3 rodadas.
5. **Parada.** Um script, e não o modelo, decide quando parar: não restam P1 nem P2, o limite de rodadas é atingido, um achado sobrevive a duas correções, um achado resolvido volta a aparecer, P1 + P2 para de diminuir, ou uma correção enfraquece os testes ou as verificações.
6. **Decisão.** Você decide o restante uma única vez: todos os P3 a P5, mais qualquer P1 ou P2 que continua aberto, que não pôde ser verificado ou que trata de um arquivo fora do diff revisado. Para cada um, você escolhe: manter como está, corrigir só desta vez ou transformar em uma regra. Um achado que você mantém como está não é perguntado de novo em uma revisão seguinte até a linha citada mudar, e o relatório o conta no lugar disso. Se revisões anteriores neste repositório já apontaram um dos quatro tipos que o revisor procura (como uma guarda especulativa) 3 vezes ou mais, o Claude diz isso e recomenda transformá-lo em uma regra na camada mais forte que se encaixa: uma mudança de tipos ou de arquitetura, depois uma regra de lint, depois um teste.
7. **Commit.** O Claude pergunta antes do commit, a menos que você tenha escolhido "parar de perguntar neste repositório". Ele nunca faz push. Se você ativar o commit gate, um hook transforma isso em uma regra: os commits do Claude ficam bloqueados até que uma revisão seja aprovada.

Quando o Claude diz que algo foi corrigido, ele diz como sabe: uma verificação que agora passa é measured, e a leitura que ele faz do código novo é inferred. Quando você contesta um achado, o Claude verifica a afirmação de novo antes de concordar e conta a você o que verificou.

### O que o revisor procura

O revisor procura bugs, requisitos que faltam, regras do projeto não cumpridas e qualquer outra coisa que faria a alteração falhar naquilo que você disse que queria. Ele não discute o que você queria. Ele também procura quatro tipos de código que agentes adicionam quando não sabem a causa de um problema, porque o próximo agente os copia:

<details>
<summary>Os quatro tipos</summary>

| Tipo | O que é | Severidade |
|---|---|---|
| Guarda especulativa | Uma verificação, um try/catch, um fallback ou um valor padrão para um estado que nada mostra que pode acontecer | P2 quando esconde uma falha, senão P3 |
| Comentário de histórico | Um comentário sobre quem pediu o quê, por que uma versão anterior mudou, ou uma instrução para agentes | P4 |
| Marcador de atalho | Um comentário TODO, HACK, "temporary" ou "for now" sem link para uma issue | P3 |
| Segunda forma | Um helper, um padrão ou uma dependência para uma tarefa que a base de código já faz de outra forma | P3 |

Uma guarda está correta onde um estado legítimo entra no código: uma entrada do usuário, uma leitura de rede ou de arquivo, ou um valor que uma API documenta como possivelmente ausente. Uma segunda verificação mais adiante, para um estado já tratado, continua sendo especulativa. Uma fixture em [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/) contém um exemplo de cada tipo e verifica que o revisor aponta todos eles.

</details>

### Severidade

Baseada na regra Pn pública do Banksalad.

| Nível | Significado | Comportamento do ciclo |
|---|---|---|
| P1 | Correção obrigatória: uma verificação que falha, perda de dados, uma falha de segurança, um crash, ou a funcionalidade pedida não funciona | Corrigido se tiver evidência |
| P2 | Correção necessária: um bug que uma entrada específica reproduz, um requisito que falta, uma regra do projeto que não é cumprida | Corrigido se tiver evidência |
| P3 | Correção útil: manutenibilidade, um nome que confunde, um teste que falta em um caminho secundário | Você decide |
| P4 | Opcional: uma preferência de estrutura em que as pessoas discordam | Você decide |
| P5 | Trivial: um erro de digitação ou a formatação | Você decide |

Um P1 ou P2 sobre um arquivo que não está no diff que a rodada revisou não é corrigido no ciclo. Ele chega até você no final, marcado como fora do diff revisado, e mantém sua severidade.

### Regras e testes de regressão

Um comentário que um revisor precisa repetir é uma regra que falta. O review-loop mantém a contagem: cada revisão registra o tipo de cada achado em um arquivo compartilhado por todos os worktrees do repositório, e um achado de um dos quatro tipos acima cujo tipo revisões anteriores já apontaram 3 vezes ou mais é marcado como repetido. Rótulos amplos como correctness são registrados, mas nunca contam como repetição. Quando você escolhe "transformar em uma regra" para um achado, o Claude primeiro procura uma regra existente na sua configuração de lint ou nos seus testes que deveria ter pegado o problema. Depois, ele escolhe a primeira forma que funciona: ativar uma regra de lint existente, escrever uma regra personalizada para o linter que você já usa ou escrever um teste. O rascunho nunca vai para o arquivo de que o achado trata.

Em seguida, o review-loop prova o rascunho. Ele grava o código de antes da correção em uma pasta temporária e executa as suas verificações lá, com e sem o rascunho:

| Resultado | Significado |
|---|---|
| `caught` | Uma verificação falha só com o rascunho. A regra pega o erro. |
| `missed` | Todas as verificações passam com o rascunho. O Claude o revisa uma vez. |
| `unproven` | Uma verificação passou do limite de tempo, ou também falha sem o rascunho. O Claude diz a você qual dos dois casos é. |

Uma regra precisa de uma verificação que a execute. Sem um script `typecheck`, `lint` ou `test`, a escolha é registrada como "corrigir só desta vez" e o Claude explica o motivo. Um rascunho comprovado entra no mesmo commit que a correção, e a mensagem do commit o menciona.

Cada P1 ou P2 que o Claude corrige ganha um teste de regressão da mesma forma, sem perguntar, quando o seu projeto tem um script de test. Para um teste de regressão, só a verificação de test conta como prova: se só o lint falhar com ele, o teste não pegou o bug. Uma correção sem teste diz o motivo no relatório.

### Commit gate

O commit gate é um hook que fica desativado até que você o ative em um repositório. No fim de uma revisão, o Claude pergunta uma vez se deve ativá-lo. Com o gate ativado, cada `git commit` que o Claude executa é verificado primeiro.

<details>
<summary>O que o gate faz</summary>

| Situação | O que o gate faz |
|---|---|
| Não há revisão, ou mudaram arquivos que a revisão não cobriu | Bloqueia o commit e diz ao Claude para executar a revisão |
| Um ciclo de revisão está em andamento, ou ainda há decisões pendentes | Bloqueia o commit |
| A revisão foi aprovada | Pergunta a você antes do commit, ou permite o commit se você delegou os commits neste repositório |
| Depois da revisão, só mudaram arquivos revisados ou rascunhos de regras e testes de regressão que o `loop rule` verificou | Pergunta a você |
| `git push` ou um force push | Sempre pergunta, mesmo com delegação |
| Um commit com `--no-verify` | Pergunta, mesmo com delegação, e continua bloqueando um commit sem uma revisão aprovada |
| Um commit em uma pasta que o gate não consegue ler, como `cd "$(...)"` ou um caminho que não existe | Pergunta a você, mesmo com delegação, se o gate estiver ativado no repositório onde você iniciou o Claude Code |

Para fazer um commit uma única vez sem revisão, peça ao Claude para pular a revisão desta vez. A configuração do gate e a delegação de commits valem para o repositório inteiro, incluindo seus worktrees vinculados. Cada worktree tem sua própria revisão.

</details>

### Configurações

As cinco primeiras configurações valem para um repositório. Para mudar uma, digite o pedido depois de `/review-loop:review-loop`, assim o Claude tem os comandos da skill carregados. O limite de tempo das verificações é uma variável de ambiente, então vale onde quer que você a defina, e o total de 9 minutos é fixo.

| Configuração | Padrão | O que digitar |
|---|---|---|
| Confirmar antes de corrigir | Desativado | "confirme comigo cada P2" ou "confirme comigo cada P1 e P2" |
| Commit gate | Perguntado uma vez no fim da primeira revisão | "ative (ou desative) o commit gate" |
| Delegação de commits | Pergunta antes de cada commit | "pare de perguntar antes dos commits neste repositório" |
| Sem supervisão | Desativado | "execute sem supervisão" para uma execução, ou "ative (ou desative) o modo sem supervisão neste repositório". O Claude não pergunta nada, deixa para depois o que precisa de você e termina com um resumo do que fez e do que espera por você |
| Modelo do revisor | O modelo da sua sessão | "rode o revisor com sonnet neste repositório" (ou opus, haiku, fable), ou "rode o revisor com o modelo da sessão". Medições mostra o que cada modelo encontrou e quanto custou |
| Limite de tempo das verificações | 5 minutos por verificação, 9 minutos no total | Defina `LIM_CHECK_TIMEOUT_MS` para mudar o limite de cada verificação |

## Medições

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) lista 173 comportamentos em seis eixos: `do`, `tell`, `ask`, `silence`, `stop` e `evidence`. Os testes unitários no CI cobrem 162 desses comportamentos, incluindo execuções em repositórios git temporários reais e o hook de commit gate. Os outros 11 precisam de uma execução do modelo: perguntar uma única vez sobre P3 a P5, mostrar o relatório antes de qualquer pergunta, manter cada etapa na lista de tarefas com um motivo para cada etapa pulada, escrever um teste de regressão para cada P1 ou P2 corrigido, rotular cada achado como measured, inferred ou guessed, dizer como se sabe que uma correção funciona, verificar de novo um achado que você contesta, recomendar uma regra para um tipo de achado que continua aparecendo, não perguntar nada em uma execução sem supervisão, iniciar o revisor no modelo que você escolheu e apontar código adicionado sem uma causa conhecida. O último tem uma fixture em [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/), e os dois primeiros têm uma execução manual em [`evals/review-loop/manual-behaviors.md`](../../evals/review-loop/manual-behaviors.md).

Um benchmark de detecção dá ao revisor alterações em repositórios temporários cujos nomes não dizem que são um teste. [`evals/review-loop/detection/`](../../evals/review-loop/detection/) tem 12 alterações com um bug plantado em cada uma e 6 alterações limpas. [`evals/review-loop/detection-hard/`](../../evals/review-loop/detection-hard/) tem 10 bugs mais difíceis, como um que só aparece em um arquivo que o diff não toca, um que só aparece seguindo quatro arquivos, um dentro de um diff de 183 linhas, uma condição de corrida entre duas buscas, um buffer esvaziado antes que uma escrita assíncrona o leia e um lock que não é liberado em um caminho de erro, além de 6 alterações limpas que parecem suspeitas. Resultados com 3 execuções por caso, de 2026-10-25 para o conjunto regular e de 2026-10-26 para o conjunto difícil:

| Modelo do revisor | Conjunto regular: bugs encontrados como P1 ou P2 | Conjunto regular: P1 ou P2 falsos em alterações limpas | Conjunto difícil: bugs encontrados como P1 ou P2 | Conjunto difícil: P1 ou P2 falsos em alterações limpas | Custo do conjunto difícil (48 execuções) |
|---|---|---|---|---|---|
| claude-opus-5-5 | 36 de 36 | 0 de 18 | 30 de 30 | 0 de 18 | US$ 3,11 |
| claude-sonnet-5-5 | não executado | não executado | 29 de 30 | 0 de 18 | US$ 1,14 |
| claude-haiku-5-5 | não executado | não executado | 30 de 30 | 3 de 18 | US$ 0,09, conforme informado pelo Claude Code |

Por padrão, o revisor roda no modelo da sua sessão. O Opus encontrou todos os bugs plantados nos dois conjuntos, então o benchmark ainda não consegue mostrar para ele uma queda nos bugs encontrados. Para ver se ele chega a mostrar um `reviewer.md` pior, o Opus também rodou o conjunto difícil com um `reviewer.md` reduzido ao seu formato de saída: ainda encontrou 30 de 30, gerou 1 P2 falso em 18 execuções limpas e levantou 83 achados de P3 a P5 onde o revisor completo levantou 55. Para o Opus, encontrar esses bugs depende mais do modelo do que das instruções, e um `reviewer.md` pior aparece como alarmes falsos e ruído. A única falha do Sonnet não retornou nenhum achado para o buffer esvaziado antes de uma escrita assíncrona. Os 3 alarmes falsos do Haiku foram todos em um mesmo caso limpo, que também gerou 1 P2 falso em 9 execuções do Opus com o revisor completo ao longo de dois dias. Um achado conta quando nomeia o bug plantado em uma linha alterada ou, para um bug que só aparece em outro arquivo, em uma linha marcada nesse arquivo. Depois das primeiras execuções, palavras-chave foram adicionadas em quatro casos em que um revisor nomeou o bug plantado com palavras que a pontuação não aceitava, e todas as execuções salvas foram pontuadas de novo com elas. Rode de novo com `node evals/review-loop/run-detection.mjs --runs 3` e adicione `--cases evals/review-loop/detection-hard` para o conjunto difícil.

A tabela acima é a base do modelo padrão do revisor. No conjunto difícil, o Opus encontrou 30 de 30 sem P1 ou P2 falsos, o Sonnet encontrou 29 de 30 sem nenhum por cerca de 37% do custo do Opus, e o Haiku encontrou 30 de 30 com 3 P1 ou P2 falsos em 18 execuções limpas. Por isso o padrão continua sendo o modelo da sessão, e o Sonnet é a opção mais barata quando você quer o revisor em um modelo diferente daquele que escreveu a alteração.

<details>
<summary>Custo</summary>

O `claude plugin details` estima o custo do review-loop assim:

| Parte | Sempre ativo, em toda sessão | Cada vez que roda |
|---|---|---|
| skill review-loop | cerca de 140 tokens | cerca de 5.600 tokens |
| agente revisor | cerca de 70 tokens | cerca de 1.700 tokens, mais o diff e o código que ele lê |

O custo da skill é pago uma vez por execução. O custo do revisor é pago uma vez por rodada, e um ciclo roda no máximo 3 rodadas. O modelo do revisor muda esse custo; a tabela do benchmark acima mostra o custo de cada modelo. As suas verificações rodam na sua máquina e não custam tokens.

</details>

O review-loop revisa os pull requests do próprio LIM. O [#8](https://github.com/lee-eojin/lim/pull/8) mostra dois ciclos na primeira versão, incluindo uma parada causada por um falso positivo na própria verificação de enfraquecimento de testes, que depois foi corrigido. Pull requests recentes, como o [#46](https://github.com/lee-eojin/lim/pull/46), mostram o relatório do review-loop e a decisão tomada para cada achado.

## Por que funciona assim

<details>
<summary>Por que um revisor novo?</summary>

O agente que escreveu uma alteração sabe por que cada linha está ali, então lê a alteração como correta. Um revisor que recebe só o diff e uma linha de intenção precisa encontrar o motivo no código. Se o motivo não estiver lá, isso é um achado. Cada rodada inicia um revisor novo, então um revisor nunca avalia o próprio veredito anterior.

</details>

<details>
<summary>Por que um script decide quando parar?</summary>

Um modelo a quem se pergunta "isto está pronto?" tende a dizer que sim. O script do review-loop, em vez disso, conta: ele para quando não resta nenhum P1 ou P2, depois de 3 rodadas, quando um achado sobrevive a duas correções, quando um achado resolvido volta, quando P1 + P2 para de cair ou quando uma correção enfraquece um teste. Parar com achados abertos é um resultado normal, e o Claude diz isso.

</details>

<details>
<summary>Por que P1 e P2 precisam de evidência?</summary>

Em um relatório, uma afirmação confiante e uma afirmação comprovada parecem iguais. Um P1 ou P2 precisa citar a linha exata, dar uma entrada que produz um resultado errado e dizer por que nada já impede o problema. Sem as três coisas, ou quando o revisor o rotula como guessed, ele aparece como não verificado e o Claude não muda código por causa dele.

</details>

<details>
<summary>Por que o commit gate é opt-in?</summary>

Um hook que bloqueia commits muda a sua forma de trabalhar, então deve ser escolha sua em cada repositório. Sem o gate, "perguntar antes do commit" é uma instrução que o Claude segue. Com ele, o hook bloqueia um `git commit` que o Claude executa sem uma revisão aprovada. Ele não vê tudo: [Limites](#limites) lista o que ele deixa passar, como aliases do git.

</details>

<details>
<summary>Por que ele nunca faz push?</summary>

Um commit é local e fácil de desfazer. Um push não é. O review-loop para no commit, e o gate pergunta antes de cada push mesmo quando você delegou os commits.

</details>

## Dados

O estado, os diffs, os logs das verificações e um registro de decisões ficam em `.git/lim/review-loop/` dentro do seu repositório. O Claude grava cada revisão por um instante em `.lim-review/` na sua working tree; o git ignora essa pasta por meio de `.git/info/exclude`, e o review-loop apaga o arquivo depois de lê-lo. Para verificar uma regra, o review-loop grava o código de antes da correção em uma pasta temporária fora do seu repositório e depois a apaga. Para reiniciar, apague `.git/lim/review-loop/`.

O review-loop não faz chamadas de rede próprias. O Claude e o revisor leem o diff, os achados e a saída das verificações como qualquer outro arquivo da sua sessão. Por isso, esse conteúdo vai para o provedor do modelo da mesma forma que o restante da sua sessão do Claude Code.

## Limites

- As verificações são detectadas apenas a partir dos scripts do `package.json`.
- Cada verificação tem no máximo 5 minutos, e todas as verificações juntas têm no máximo 9 minutos.
- Sem o commit gate, perguntar antes de um commit é uma instrução para o Claude, e não uma garantia.
- O commit gate verifica apenas os comandos que o Claude executa pela ferramenta Bash dele. Os commits que você digita no seu próprio terminal não são verificados, e aliases do git como `git ci` não são reconhecidos.
- Se você iniciar o Claude Code em uma pasta que não é um repositório, o gate não consegue verificar um commit cujo repositório ele não consegue identificar, por exemplo depois de `cd "$(...)"`.
- O review-loop revisa tudo o que `git add -A` incluiria, e não um conjunto de alterações em stage que você escolhe manualmente.
- Uma regra ou um teste de regressão é verificado em uma cópia temporária que tem os seus arquivos rastreados pelo git e um link para o `node_modules` da raiz. Outros arquivos ignorados, como `.env` ou um `node_modules` aninhado, não estão lá, então uma verificação que precisa deles o informa como não comprovado ou como detectado pelo motivo errado. O Claude lê a falha para saber qual é o caso.

## Perguntas frequentes

**O review-loop inicia sem que eu execute o comando?**
Nem sempre. O Claude inicia uma skill apenas quando decide que a descrição da skill corresponde à conversa. Se você pedir ao Claude para revisar ou fazer um commit, o Claude pode iniciar o review-loop, mas isso não é garantido. O comando `/review-loop:review-loop` sempre inicia o review-loop. Se você ativar o commit gate, um commit sem revisão fica bloqueado e o Claude recebe a instrução de executar o review-loop primeiro.

**Ele faz push ou merge?**
Nunca. O review-loop pergunta antes de cada commit, a menos que você escolha "parar de perguntar neste repositório". Para desativar essa opção de novo, peça ao Claude para desativar a delegação de commits do review-loop.

**Ele entra em conflito com meus outros plugins?**
O review-loop adiciona uma skill, um agente e um hook. O hook lê comandos do Bash, só age sobre `git commit` e `git push`, e não faz nada se você não ativou o commit gate nesse repositório. Os nomes dele começam com `review-loop:`, então eles não podem coincidir com os nomes de outros plugins. Se você pedir com palavras comuns, o Claude pode escolher outra skill de revisão. O comando sempre inicia o review-loop.

**O que acontece se uma sessão terminar no meio de um ciclo?**
Execute o comando de novo. O review-loop oferece continuar a partir da rodada e da etapa em que parou, ou começar do zero.

**Como faço para desinstalar?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

Depois, apague `.git/lim/review-loop/` em cada repositório onde você executou o review-loop, e a linha `.lim-review/` do `.git/info/exclude` dele.

## Deixe do seu jeito

O review-loop funciona com as verificações que você já tem. Quanto melhores forem os seus scripts `typecheck`, `lint` e `test`, maior é a parte da revisão que é medida em vez de lida.

- Quer ver os achados graves antes que qualquer coisa mude? Peça ao Claude para confirmar com você cada P2, ou cada P1 e P2.
- Cansou de aprovar commits em um repositório em que você confia? Delegue os commits nele. Com o commit gate ativado, os pushes continuam perguntando.
- Recebe sempre o mesmo comentário? Escolha "transformar em uma regra", e a próxima revisão começa com esse erro já pego pelo seu próprio linter ou pelos seus testes.
- Quer um fluxo diferente? Faça um fork do plugin. A skill é um único `SKILL.md` com menos de 250 linhas, e a lógica do ciclo é um único script, `plugins/review-loop/skills/review-loop/scripts/loop.mjs`.

## Como o LIM é construído

- **Primeiro as issues.** Cada mudança começa em uma issue e chega por meio de um pull request que um maintainer integra com squash merge.
- **Revisado por ele mesmo.** Cada pull request executa o review-loop no próprio diff, e a descrição mostra o relatório e uma decisão para cada achado.
- **Versões por plugin.** Cada plugin segue o Semantic Versioning, mantém o próprio `CHANGELOG.md` e usa tags no formato `<plugin>--v<version>`. As versões minor e major recebem um GitHub Release.
- **Pequeno de propósito.** Um plugin tem uma skill de entrada, um `SKILL.md` com menos de 250 linhas e apenas hooks opt-in.

## Roadmap

- Evals no nível do modelo com `claude plugin eval` para os comportamentos que os testes unitários não conseguem cobrir, e uma comparação às cegas da qualidade e do custo da revisão

## Como contribuir

Issues e pull requests são bem-vindos. Comece pelo [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Licença

MIT. Veja o [LICENSE](../../LICENSE).
