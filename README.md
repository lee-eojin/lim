# LIM

**Less is more.** Small Claude Code plugins that each do one job, prove it with numbers, and stay out of your way.

> **Status: pre-release.** Nothing is installable yet. Watch the repo or open an issue to shape what ships first.

## What's coming

| Plugin | One job |
|---|---|
| `review-loop` | Reviews your diff before you commit. Fixes P1 and P2 findings, re-reviews, then hands P3 to P5 to you as decisions. Loop, I am. |
| `forge` | Turns a reviewer's PR comment history into a reviewer skill, with a faithfulness report that says how close it gets. |

## Principles

1. **One plugin, one job.** Install only what you need.
2. **Checks before opinions.** Tests, types, and lint run before any model review.
3. **Hooks are opt-in.** Nothing watches your prompts or commands unless you turn it on.
4. **Ask before installing.** Anything a plugin needs is explained first: what it is, what it improves, where it lives, and how to remove it.
5. **Show the numbers.** Every plugin ships with how it was measured and what that measurement does not cover.

## Install

Coming soon. It will look like this:

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
