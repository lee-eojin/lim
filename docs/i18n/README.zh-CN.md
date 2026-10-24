# LIM

**Less is more.** 小型 Claude Code 插件。每个插件只做一件事，并公开它背后的测量结果。

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

本文是截至 2026-10-24 的 [英文 README](../../README.md) 的翻译。如果两者内容不一致，以英文 README 为准。

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | 简体中文 | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | [Bahasa Indonesia](README.id.md)

编程 agent 写代码很快，但发现自己哪里写错了却要差得多。写出改动的 agent 是这次改动最弱的审查者，因为它透过自己的推理来读这次改动，总会认同自己。结果，代码要么未经审查就被提交，要么只经过写出它的同一个上下文的审查。

**LIM 是我给出的答案：每个小插件只做一件事，并附上支撑它的数字。** 第一个插件是 review-loop。

**review-loop 让“可以提交”真正意味着“已经审查”。** 首先运行你自己的测试、类型检查和 lint。然后，一个拥有全新上下文、从不接触 Claude 推理的审查者把发现项标记为 P1 到 P5，并且必须为严重的发现项给出证据。Claude 修复 P1 和 P2，一个新的审查者检查这些修复，何时停止由脚本而不是模型决定。其余的由你在最后一次性决定。

**反复提出的意见会变成规则。** 当你把某个发现项标记为“设为规则”时，Claude 会起草一条 lint 规则或一个测试，review-loop 会在修复之前的代码上运行它，证明它能捕获这个错误。bug 修复也会以同样的方式得到一个回归测试。

**有意保持小巧。** review-loop 为一个会话增加约 212 个 token。在你为某个仓库开启它之前，它的 hook 不做任何事。安装任何东西之前，都会先告诉你它是什么、如何移除。

Fork 它、修改它，把它变成你自己的。欢迎提交 issue 和 pull request。

## 插件

| 插件 | 状态 | 唯一职责 |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.3.0 | 在你提交之前审查你的改动，修复 P1 和 P2 发现项，再次审查，然后把其余发现项交给你 |

## 安装

你需要 Claude Code、git，以及 Node.js 18 或更高版本。

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

如果 Claude Code 要求重启，请重启它。添加 marketplace 只会注册插件清单。每个插件单独安装，所以你只会得到你选择的插件。

## 开始使用

只需两步：

1. 按上文安装 review-loop。
2. 在一个有未提交改动的 git 仓库中输入：

```
/review-loop:review-loop
```

就这么简单。review-loop 会运行你的检查、审查改动、修复必须修复的问题，并就其余问题询问你。最后，它会询问一次是否为此仓库开启提交门禁，然后询问是否提交。

## 用法

### 只需使用 `/review-loop:review-loop`

每当你准备提交时就输入它。你可以在命令后面用自然语言补充你的要求：

```
/review-loop:review-loop I changed the coupon math. Check it before I commit.
```

```
/review-loop:review-loop confirm every P2 with me before you fix anything.
```

当你让 Claude 审查或提交时，Claude 也可以自行启动 review-loop，但只在它判断这个 skill 适用时才会这样做。使用命令总是会启动它。

### 一轮是什么样子

每一轮都以一份报告结束。Claude 会先展示报告，再做其他任何事：

```
Review round 2 of 3
Checks: test passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal (fixed, inferred: the re-review read the fix)
  test: src/coupon.test.js (before the fix: caught, after: passed)

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

在这个例子中，第 1 轮发现了一个 P1。Claude 修复了它并编写了回归测试，review-loop 证明该测试在修复之前的代码上失败。第 2 轮确认了修复，于是循环停止。还剩一个 P3 交给你决定。

### 示例

<details>
<summary>所有提示词</summary>

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
```

</details>

## 审查如何进行

在你提交之前，review-loop 运行一个短循环，并自动停止。

1. **检查。** review-loop 运行你的 `package.json` 中的 `typecheck`、`lint` 和 `test` 脚本。如果某个检查失败，或者 `package.json` 不是有效的 JSON，review-loop 会将其记为一个 P1 发现项。如果某个检查的运行时间超过时间限制，review-loop 会将其报告为“未验证”，而不是“失败”。
2. **全新审查。** 一个独立的审查者 agent 会收到 diff 和一行说明你想要实现什么的摘要，但不会收到 Claude 对这次改动的推理。审查者可以读取周围的代码来了解上下文。审查者把发现项标记为 P1 到 P5。P1 和 P2 需要证据：确切的代码行、一个失败场景，以及为什么现有代码没有阻止该问题。每个发现项都会标明 measured（实测）、inferred（推断）或 guessed（猜测）。没有证据的 P1 或 P2，以及被标为 guessed 的 P1 或 P2，不会被修复，而是以“未验证”的状态展示给你。
3. **修复。** Claude 先说明它要修复什么，然后修复 P1 和 P2。如果某个修复需要设计决策（修复方式不止一种、用户可见的行为变化、删除功能、修改测试），由你先做选择。如果你的项目有 test 脚本，Claude 会根据它修复的每个 P1 和 P2 的失败场景编写回归测试，review-loop 会证明该测试在修复之前的代码上失败。
4. **再次审查。** 一个新的审查者只检查本轮的修复和仍未解决的发现项。最多 3 轮。
5. **停止。** 由脚本而不是模型决定何时停止。停止条件：没有剩余的 P1 或 P2、达到轮数上限、某个发现项经过两次修复后仍然存在、某个已解决的发现项再次出现、P1 + P2 的数量不再减少，或者某个修复削弱了测试或检查。
6. **决定。** 其余发现项由你一次性决定：所有 P3 到 P5，以及仍未解决、无法验证或针对已审查 diff 之外文件的 P1 和 P2。对每一项，你可以选择：保持原样、仅本次修复，或者设为规则。你选择保持原样的发现项，在被引用的那一行改变之前，后续审查不会再次询问，而是由报告显示其数量。如果此仓库之前的审查已经 3 次或更多次提出同一类发现项，Claude 会指出这一点，并建议在最强的适用层级设为规则：先是类型或架构变更，然后是 lint 规则，最后是测试。
7. **提交。** 如果你没有选择“在此仓库中不再询问”，Claude 会在提交前询问你。review-loop 从不执行 push。如果你开启提交门禁，一个 hook 会把这一点变成强制规则。在审查通过之前，Claude 的提交会被阻止。

当 Claude 说某个问题已修复时，它会说明自己是如何知道的：现在能通过的检查属于 measured，它对新代码的阅读判断属于 inferred。当你对某个发现项提出异议时，Claude 会先重新核实该主张再表示同意，并告诉你它核实了什么。

### 审查者关注什么

审查者寻找 bug、缺失的需求、被违反的项目规则，以及任何会让这次改动无法实现你所说目标的问题。它不会质疑你想要的东西本身。它还会寻找 agent 在不了解问题原因时添加的四类代码，因为下一个 agent 会照搬它们：

<details>
<summary>四类代码</summary>

| 类别 | 是什么 | 严重级别 |
|---|---|---|
| 臆测性防御 | 针对没有证据表明会出现的状态而添加的检查、try/catch、回退或默认值 | 掩盖失败时为 P2，否则为 P3 |
| 历史注释 | 描述谁要求了什么、早期版本为什么改动的注释，或者给 agent 的指示 | P4 |
| 权宜标记 | 没有 issue 链接的 TODO、HACK、“temporary”或“for now”注释 | P3 |
| 第二种方式 | 为代码库已经用另一种方式完成的工作而添加的辅助函数、模式或依赖 | P3 |

防御检查应该放在合法状态进入代码的地方：用户输入、网络或文件读取，或者 API 文档说明可能缺失的值。对已经处理过的状态在更深处再检查一次，仍然属于臆测性防御。[`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/) 中的 fixture 为每一类各包含一个例子，用来检查审查者能否标记出它们。

</details>

### 严重级别

本规则基于 Banksalad 公开的 Pn 规则。

| 级别 | 含义 | 循环中的处理 |
|---|---|---|
| P1 | 必须修复：检查失败、数据丢失、安全漏洞、崩溃，或者所请求的功能无法工作 | 仅在有证据时修复 |
| P2 | 应该修复：特定输入可以复现的 bug、缺失的需求、被违反的项目规则 | 仅在有证据时修复 |
| P3 | 值得修复：可维护性、有误导性的名称、次要路径上缺少测试 | 由你决定 |
| P4 | 可选：大家意见不一致的结构偏好 | 由你决定 |
| P5 | 琐碎：拼写错误或格式问题 | 由你决定 |

针对该轮所审查 diff 中没有的文件的 P1 或 P2，不会在循环中修复。它会在最后交给你，标记为在已审查 diff 之外，并保留原有严重级别。

### 规则与回归测试

审查者不得不反复提出的意见，说明缺少一条规则。review-loop 会计数：每次审查都会把每个发现项的类别记录到一个由该仓库所有 worktree 共享的文件中。如果之前的审查已经 3 次或更多次提出某一类发现项，该发现项会被标记为重复。当你为某个发现项选择“设为规则”时，Claude 会先在你的 lint 配置或测试中查找本应捕获它的现有规则。然后，它选择第一个可行的形式：开启一条现有的 lint 规则、为你已在使用的 linter 编写自定义规则，或者编写一个测试。草稿永远不会写进该发现项所涉及的文件。

接着，review-loop 会证明这份草稿。它把修复之前的代码写入一个临时目录，并在那里分别在有草稿和没有草稿的情况下运行你的检查：

| 结果 | 含义 |
|---|---|
| `caught` | 只有加上草稿时检查才会失败。规则捕获了这个错误 |
| `missed` | 加上草稿后所有检查仍然通过。Claude 会修改一次草稿 |
| `unproven` | 某个检查超时，或者没有草稿时也会失败。Claude 会告诉你是哪一种 |

规则需要一个会运行它的检查。如果没有 `typecheck`、`lint` 或 `test` 脚本，这个选择会被记录为“仅本次修复”，Claude 会告诉你原因。经过证明的草稿会和修复放进同一个提交，提交信息中会写明它。

如果你的项目有 test 脚本，Claude 修复的每个 P1 或 P2 都会以同样的方式得到一个回归测试，无需询问。对回归测试来说，只有 test 检查才算证明：如果加上它之后只有 lint 失败，说明这个测试没有捕获该 bug。没有测试的修复会在报告中说明原因。

### 提交门禁

提交门禁是一个 hook。在你为某个仓库开启它之前，它处于关闭状态。在审查结束时，Claude 会询问一次是否开启它。开启门禁后，Claude 运行的每个 `git commit` 都会先由门禁检查。

<details>
<summary>门禁的行为</summary>

| 情况 | 门禁的行为 |
|---|---|
| 没有审查，或者有审查未覆盖的文件发生了改动 | 阻止提交，并让 Claude 运行审查 |
| 审查循环正在进行，或者还有待定的决定 | 阻止提交 |
| 审查已通过 | 提交前询问你。如果你在此仓库中委托了提交，则允许提交 |
| 审查后只有已审查的文件或经 `loop rule` 检查的规则草稿和回归测试发生了改动 | 询问你 |
| `git push` 或强制推送（force push） | 即使你已委托提交，也总是询问你 |
| 带有 `--no-verify` 的提交 | 即使你已委托提交，也询问你。没有通过审查的提交仍会被阻止 |
| 在门禁无法识别的文件夹中提交（例如 `cd "$(...)"` 或不存在的路径） | 如果启动 Claude Code 的仓库开启了门禁，即使你已委托提交，也询问你 |

如果要不经审查提交一次，请让 Claude 这次跳过审查。门禁设置和提交委托适用于整个仓库，包括它链接的 worktree。每个 worktree 有各自的审查。

</details>

### 设置

前三项设置只作用于一个仓库。要修改设置，请在 `/review-loop:review-loop` 后面输入你的要求，这样 Claude 会在加载了该 skill 命令的状态下处理。检查时间限制是一个环境变量，因此在你设置它的任何地方都会生效，而合计 9 分钟是固定的。

| 设置 | 默认值 | 输入内容 |
|---|---|---|
| 修复前确认 | 关闭 | “每个 P2 都先和我确认”或“每个 P1 和 P2 都先和我确认” |
| 提交门禁 | 在第一次审查结束时询问一次 | “开启（或关闭）提交门禁” |
| 提交委托 | 每次提交前询问 | “在此仓库中提交前不再询问” |
| 检查时间限制 | 每个检查 5 分钟，合计 9 分钟 | 设置 `LIM_CHECK_TIMEOUT_MS` 以修改单个检查的时间限制 |

## 测量结果

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) 列出了六个维度上的 128 个行为。六个维度是：执行（do）、告知（tell）、询问（ask）、静默（silence）、停止（stop）和证据（evidence）。CI 中的单元测试覆盖其中 119 个行为，包括在真实的临时 git 仓库上运行的测试和针对提交门禁 hook 的测试。其余 9 个行为需要实际运行模型，计划使用 `claude plugin eval` 测试：对 P3 到 P5 只询问一次、在任何提问之前先展示报告、把每个步骤都留在待办清单中并为每个跳过的步骤写下原因、为每个修复的 P1 和 P2 编写回归测试、为每个发现项标明 measured、inferred 或 guessed、说明如何确认修复有效、在你提出异议时重新核实发现项、为反复出现的同类发现项建议设为规则、报告在原因不明时添加的代码。最后一个行为在 [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/) 中有一个 fixture。

<details>
<summary>成本</summary>

`claude plugin details` 对 review-loop 成本的估算如下：

| 部分 | 始终加载（每个会话） | 每次运行 |
|---|---|---|
| review-loop skill | 约 140 个 token | 约 4,600 个 token |
| 审查者 agent | 约 70 个 token | 约 1,700 个 token，另加 diff 和它读取的代码 |

skill 的成本在每次运行时支付一次。审查者的成本在每轮支付一次，一个循环最多运行 3 轮。你的检查在你自己的机器上运行，不消耗 token。

</details>

review-loop 审查 LIM 自己的 pull request。[#8](https://github.com/lee-eojin/lim/pull/8) 展示了 review-loop 第一个版本上运行的两次循环。其中一次停止是由 review-loop 自己的测试削弱检查中的误报引起的，这个误报随后已被修复。最近的 pull request（例如 [#46](https://github.com/lee-eojin/lim/pull/46)）展示了 review-loop 的报告以及对每个发现项的决定。

## 为什么这样设计

<details>
<summary>为什么要用全新的审查者？</summary>

写出改动的 agent 知道每一行为什么存在，所以它会把改动读成正确的。只拿到 diff 和一行意图的审查者，必须在代码中找到理由。如果代码里找不到理由，那就是一个发现项。每一轮都启动一个新的审查者，所以审查者永远不会给自己之前的结论打分。

</details>

<details>
<summary>为什么由脚本决定何时停止？</summary>

被问到“完成了吗？”时，模型往往会回答“是”。review-loop 的脚本改为计数：没有剩余的 P1 或 P2 时、3 轮之后、某个发现项经过两次修复仍然存在时、已解决的发现项再次出现时、P1 + P2 不再下降时，或者某个修复削弱了测试时，它就会停止。带着未解决的发现项停止是正常结果，Claude 会明确说明这一点。

</details>

<details>
<summary>为什么 P1 和 P2 需要证据？</summary>

在报告里，自信的断言和经过证明的断言看起来一模一样。P1 或 P2 必须引用确切的代码行，给出一个会产生错误结果的输入，并说明为什么现有代码没有阻止它。三者缺一，或者审查者把它标为 guessed 时，它会显示为未验证，Claude 不会为它修改代码。

</details>

<details>
<summary>为什么提交门禁需要主动开启？</summary>

阻止提交的 hook 会改变你的工作方式，所以应该由你按仓库来选择。没有门禁时，“提交前询问”是 Claude 遵循的一条指令。有了门禁，hook 会阻止 Claude 在未通过审查时运行的 `git commit`。但它并不能看到一切。[限制](#限制)列出了它会漏掉的情况，例如 git 别名。

</details>

<details>
<summary>为什么它从不 push？</summary>

提交留在本地，很容易撤销。push 则不然。review-loop 止步于提交，即使你委托了提交，门禁也会在每次 push 前询问你。

</details>

## 数据

状态、diff、检查日志和决策记录存放在你的仓库内的 `.git/lim/review-loop/` 目录中。review-loop 不向你的工作区写入任何内容。为了检查规则，review-loop 会把修复之前的代码写入仓库之外的临时目录，并在之后删除它。如果要重置，请删除 `.git/lim/review-loop/`。

review-loop 本身不发起任何网络请求。Claude 和审查者读取 diff、发现项和检查输出的方式，与读取你会话中其他文件的方式相同。因此，这些内容会和你的 Claude Code 会话的其余内容一样发送给模型提供方。

## 限制

- review-loop 只从 `package.json` 的 scripts 中识别检查。
- 每个检查最多运行 5 分钟，所有检查合计最多运行 9 分钟。
- 如果没有开启提交门禁，提交前询问只是给 Claude 的指令，而不是保证。
- 提交门禁只检查 Claude 通过它的 Bash 工具运行的命令。你在自己的终端中输入的提交不会被检查。`git ci` 这样的 git 别名也不会被识别。
- 如果你在不是仓库的文件夹中启动 Claude Code，门禁无法检查它识别不出仓库的提交，例如 `cd "$(...)"` 之后的提交。
- review-loop 审查 `git add -A` 会包含的所有内容，而不是你手动挑选的一组已暂存改动。
- 规则和回归测试在一个临时副本中检查。该副本包含你已跟踪的文件，以及一个指向根目录 `node_modules` 的链接。其他被忽略的文件（例如 `.env` 或嵌套的 `node_modules`）不在其中，因此依赖这些文件的检查会把规则或测试报告为未证实，或者因错误的原因被捕获。Claude 会读取失败信息来判断是哪一种。

## 常见问题

**review-loop 会自动启动吗？**
不一定。只有当 Claude 判断某个 skill 的描述符合当前对话时，Claude 才会启动该 skill。如果你让 Claude 审查或提交，Claude 可以启动 review-loop，但这一点没有保证。命令 `/review-loop:review-loop` 总是会启动 review-loop。如果你开启提交门禁，没有经过审查的提交会被阻止。此时 Claude 会收到先运行 review-loop 的提示。

**它会执行 push 或 merge 吗？**
不会。如果你没有选择“在此仓库中不再询问”，review-loop 会在每次提交前询问你。如果要撤销这个选择，请让 Claude 关闭 review-loop 的提交委托。

**它会与我的其他插件冲突吗？**
review-loop 添加一个 skill、一个 agent 和一个 hook。这个 hook 读取 Bash 命令，只对 `git commit` 和 `git push` 起作用。如果你没有在该仓库中开启提交门禁，这个 hook 不做任何事。它的名称都以 `review-loop:` 开头，因此不会与其他插件的名称冲突。如果你用普通的自然语言提出请求，Claude 可以改为选择另一个审查 skill。该命令总是会启动 review-loop。

**如果会话在循环中途结束，会发生什么？**
再次运行该命令。命令会提供两个选项：从停止时的轮次和步骤继续，或者重新开始。

**如何卸载？**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

然后，在每个运行过 review-loop 的仓库中删除 `.git/lim/review-loop/`。

## 打造你自己的版本

review-loop 使用你已有的检查。你的 `typecheck`、`lint` 和 `test` 脚本越完善，审查中靠测量得出的部分就越多，靠阅读判断的部分就越少。

- 想在任何改动发生之前看到严重的发现项？让 Claude 先和你确认每个 P2，或者每个 P1 和 P2。
- 在你信任的仓库里厌倦了逐一批准提交？在那里委托提交。开启提交门禁后，push 仍会询问你。
- 总是收到同样的意见？选择“设为规则”，下一次审查开始时，你自己的 linter 或测试就已经能捕获这个错误。
- 想要不同的流程？Fork 这个插件。skill 是一个不到 250 行的 `SKILL.md`，循环逻辑是一个脚本：`plugins/review-loop/skills/review-loop/scripts/loop.mjs`。

## LIM 的构建方式

- **先有 issue。** 每个改动都从一个 issue 开始，并通过 pull request 合入。维护者使用 squash merge 合并该 pull request。
- **用自己审查自己。** 每个 pull request 都会对自己的 diff 运行 review-loop，描述中会展示报告和对每个发现项的决定。
- **每个插件独立版本。** 每个插件遵循语义化版本（Semantic Versioning），维护自己的 `CHANGELOG.md`，并使用 `<plugin>--v<version>` 格式的标签。minor 和 major 版本会发布 GitHub Release。
- **有意保持小巧。** 一个插件只有一个入口 skill，`SKILL.md` 少于 250 行，并且只包含需要主动开启的 hook。

## 路线图

- 使用 `claude plugin eval` 进行模型级 eval，覆盖单元测试无法覆盖的行为，并对审查质量和成本做盲测对比
- 在与编写改动的模型不同的模型上运行的审查者
- 无人值守模式，记录每个决定，供你之后查看
- 一份简短指南，包含可直接复制的提示词、真实输出和成本

## 参与贡献

欢迎提交 issue 和 pull request。请先阅读 [CONTRIBUTING.md](../../CONTRIBUTING.md)。

## 许可证

MIT。详见 [LICENSE](../../LICENSE)。
