# LIM

**Less is more.** 小型 Claude Code 插件。每个插件只做一件事，并公开它背后的测量结果。

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

本文是截至 2026-10-19 的 [英文 README](../../README.md) 的翻译。如果两者内容不一致，以英文 README 为准。

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | 简体中文 | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | [Bahasa Indonesia](README.id.md)

## 为什么选择 LIM

大型 agent harness 会在每个会话中加载大量指令，并在许多命令上运行 hook。LIM 让每个插件保持小巧、可选，并且经过测量。

- **一个插件，一件事。** 只安装你需要的插件。根据 `claude plugin details` 的报告，review-loop 为一个会话增加约 188 个 token。
- **先检查，后意见。** 在任何模型审查之前，先运行你的测试、类型检查和 lint。
- **Hook 需要主动开启。** 在你为某个仓库开启 hook 之前，hook 不做任何事。
- **安装前先询问。** 插件需要的任何东西都会先得到说明：它是什么、它改进什么、它存放在哪里、如何移除它。
- **公开数字。** 每个插件都附带两项说明：测量了什么，以及该测量不覆盖什么。

## 插件

| 插件 | 状态 | 唯一职责 |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.2.1 | 在你提交之前审查你的改动，修复 P1 和 P2 发现项，再次审查，然后把其余发现项交给你。 |
| forge | 计划中 | 把审查者在 pull request 中的评论转换为审查者 skill，并附带一份忠实度报告，说明该 skill 与审查者本人的一致程度。 |

## 快速开始

你需要 Claude Code、git，以及 Node.js 18 或更高版本。

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

如果 Claude Code 要求重启，请重启它。然后，在一个有未提交改动的 git 仓库中运行：

```
/review-loop:review-loop
```

添加 marketplace 只会注册插件清单。每个插件单独安装，所以你只会得到你选择的插件。

## review-loop

在你提交之前，review-loop 运行一个短循环，并自动停止。

1. **检查。** review-loop 运行你的 `package.json` 中的 `typecheck`、`lint` 和 `test` 脚本。如果某个检查失败，或者 `package.json` 不是有效的 JSON，review-loop 会将其记为一个 P1 发现项。如果某个检查的运行时间超过时间限制，review-loop 会将其报告为“未验证”，而不是“失败”。
2. **全新审查。** 一个独立的审查者 agent 会收到 diff 和一行摘要，该摘要说明你想要实现什么。审查者不会收到 Claude 对这次改动的推理。审查者可以读取周围的代码来了解上下文。审查者把发现项标记为 P1 到 P5。P1 和 P2 需要证据：确切的代码行、一个失败场景，以及为什么现有代码没有阻止该问题。没有证据的结论会以“未验证”的状态展示给你。
3. **修复。** Claude 先说明它要修复什么，然后修复 P1 和 P2。如果某个修复需要设计决策（修复方式不止一种、用户可见的行为变化、删除功能、修改测试），由你先做选择。
4. **再次审查。** 一个新的审查者只检查本轮的修复和仍未解决的发现项。最多 3 轮。
5. **停止。** 由脚本而不是模型决定何时停止。停止条件：没有剩余的 P1 或 P2、达到轮数上限、某个发现项经过两次修复后仍然存在、某个已解决的发现项再次出现、P1 + P2 的数量不再减少，或者某个修复削弱了测试或检查。
6. **决定。** 其余发现项由你一次性决定：所有 P3 到 P5，以及仍未解决或无法验证的 P1 和 P2。对每一项，你可以选择：保持原样、仅本次修复，或者设为规则。
7. **提交。** 如果你没有选择“在此仓库中不再询问”，Claude 会在提交前询问你。review-loop 从不执行 push。如果你开启提交门禁，一个 hook 会把这一点变成强制规则。在审查通过之前，Claude 的提交会被阻止。

### 提交门禁

提交门禁是一个 hook。在你为某个仓库开启它之前，它处于关闭状态。在审查结束时，Claude 会询问一次是否开启它。开启门禁后，Claude 运行的每个 `git commit` 都会先由门禁检查：

| 情况 | 门禁的行为 |
|---|---|
| 没有审查，或者有审查未覆盖的文件发生了改动 | 阻止提交，并让 Claude 运行审查 |
| 审查循环正在进行，或者还有待定的决定 | 阻止提交 |
| 审查已通过 | 提交前询问你。如果你在此仓库中委托了提交，则允许提交 |
| 审查后只有已审查的文件发生了改动 | 询问你 |
| `git push` 或强制推送（force push） | 即使你已委托提交，也总是询问你 |
| 带有 `--no-verify` 的提交 | 即使你已委托提交，也询问你。没有通过审查的提交仍会被阻止 |
| 在门禁无法识别的文件夹中提交（例如 `cd "$(...)"` 或不存在的路径） | 如果启动 Claude Code 的仓库开启了门禁，即使你已委托提交，也询问你 |

如果要不经审查提交一次，请让 Claude 这次跳过审查。门禁设置和提交委托适用于整个仓库，包括它链接的 worktree。每个 worktree 有各自的审查。

每一轮都以一份报告结束：

```
Review round 2 of 3
Checks: test passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

### 严重级别

本规则基于 Banksalad 公开的 Pn 规则。

| 级别 | 含义 | 循环中的处理 |
|---|---|---|
| P1 | 必须修复：检查失败、数据丢失、安全漏洞、崩溃，或者所请求的功能无法工作 | 仅在有证据时修复 |
| P2 | 应该修复：特定输入可以复现的 bug、缺失的需求、被违反的项目规则 | 仅在有证据时修复 |
| P3 | 值得修复：可维护性、有误导性的名称、次要路径上缺少测试 | 由你决定 |
| P4 | 可选：大家意见不一致的结构偏好 | 由你决定 |
| P5 | 琐碎：拼写错误或格式问题 | 由你决定 |

### 测量结果

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) 列出了六个维度上的 68 个行为。六个维度是：执行（do）、告知（tell）、询问（ask）、静默（silence）、停止（stop）和证据（evidence）。CI 中的单元测试覆盖其中 66 个行为，包括在真实的临时 git 仓库上运行的测试和针对提交门禁 hook 的测试。其余 2 个行为需要实际运行模型，计划使用 `claude plugin eval` 测试：对 P3 到 P5 只询问一次、在任何提问之前先展示报告。

review-loop 审查 LIM 自己的 pull request。[#8](https://github.com/lee-eojin/lim/pull/8) 展示了 review-loop 第一个版本上运行的两次循环。其中一次停止是由 review-loop 自己的测试削弱检查中的误报引起的，这个误报随后已被修复。

### 数据

状态、diff、检查日志和决策记录存放在你的仓库内的 `.git/lim/review-loop/` 目录中。review-loop 不向你的工作区写入任何内容。如果要重置，请删除该目录。

review-loop 本身不发起任何网络请求。Claude 和审查者读取 diff、发现项和检查输出的方式，与读取你会话中其他文件的方式相同。因此，这些内容会和你的 Claude Code 会话的其余内容一样发送给模型提供方。

### 限制

- review-loop 只从 `package.json` 的 scripts 中识别检查。
- 每个检查最多运行 5 分钟，所有检查合计最多运行 9 分钟。如果要修改单个检查的时间限制，请设置 `LIM_CHECK_TIMEOUT_MS`。
- 如果没有开启提交门禁，提交前询问只是给 Claude 的指令，而不是保证。
- 提交门禁只检查 Claude 通过它的 Bash 工具运行的命令。你在自己的终端中输入的提交不会被检查。`git ci` 这样的 git 别名也不会被识别。
- 如果你在不是仓库的文件夹中启动 Claude Code，门禁无法检查它识别不出仓库的提交，例如 `cd "$(...)"` 之后的提交。
- review-loop 审查 `git add -A` 会包含的所有内容，而不是你手动挑选的一组已暂存改动。

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

## LIM 的构建方式

- **先有 issue。** 每个改动都从一个 issue 开始，并通过 pull request 合入。维护者使用 squash merge 合并该 pull request。
- **每个插件独立版本。** 每个插件遵循语义化版本（Semantic Versioning），维护自己的 `CHANGELOG.md`，并使用 `<plugin>--v<version>` 格式的标签。minor 和 major 版本会发布 GitHub Release。
- **有意保持小巧。** 一个插件只有一个入口 skill，`SKILL.md` 少于 250 行，并且只包含需要主动开启的 hook。

## 路线图

- review-loop：在修复前逐个确认 P2 的选项（[#4](https://github.com/lee-eojin/lim/issues/4)）、更强的测试削弱检查（[#6](https://github.com/lee-eojin/lim/issues/6)）、在大型仓库上更快的快照（[#7](https://github.com/lee-eojin/lim/issues/7)）
- forge：为从 pull request 评论中提炼出的审查者 skill 提供忠实度报告
- 使用 `claude plugin eval` 进行模型级 eval，覆盖单元测试无法覆盖的行为

## 参与贡献

欢迎提交 issue 和 pull request。请先阅读 [CONTRIBUTING.md](../../CONTRIBUTING.md)。

## 许可证

MIT。详见 [LICENSE](../../LICENSE)。
