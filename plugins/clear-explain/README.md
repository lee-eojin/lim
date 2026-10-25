# clear-explain

Explanations you read once and understand the same way. The answer comes first, each new term gets a one-line definition, each word keeps one meaning, each sentence holds one idea, and technical concepts keep their official English names. The rules are adapted from ASD-STE100 Simplified Technical English. Claude replies in your language.

## Install

```
/plugin marketplace add lee-eojin/lim
/plugin install clear-explain@lim
```

Needs Node.js 18 or later for the check script. The skill itself needs nothing.

## Use

Ask Claude to explain something. In the measurement below, Claude started the skill on its own for all 12 questions, without its name in the question, and for none of 8 requests to fix, write, translate, or look something up. Those 20 are the requests the description was written against; on 19 new requests written afterwards, it started for 8 of 8 explanations and 0 of 11 other requests. To be sure, run `/clear-explain:clear-explain` followed by the question.

Prompts to try:

```
What is a closure in JavaScript?
```

```
Why does my useEffect run twice in development?
```

```
What is the difference between git merge and git rebase?
```

```
Explain what this function does: <paste the code>
```

```
Why does this error happen? <paste the error>
```

It works in any language. English and Korean have their own rule files; other languages use the general rules in the skill.

## What it changes

| Rule | Instead of | You get |
|---|---|---|
| Answer first | A heading, a preamble, or background before the point | The first one or two sentences answer the question |
| One-line definitions | Terms used before they are explained | "A remote-tracking branch is a read-only copy of a remote branch, such as `origin/main`." |
| One meaning per word | state, then value, then data for the same thing | The same word to the end |
| One idea per sentence | One sentence with three clauses | Sentences under about 25 English words or 100 Korean characters |
| Named subject, conditions first | "It is re-run when..." | "If the dependency array changes, React runs the Effect again." |
| Official English names | Translated or transliterated concept names in a non-English reply | Error Boundary, closure, event loop, written as the official documentation writes them |
| Stated certainty | "This should work" | Measured, inferred, or unknown, with the reason |
| Comparisons as tables | Contrast sentences in every paragraph | One table |

It also avoids words that talk down to the reader (simply, obviously, just) and uses at most one analogy, marked as one.

Out of scope: rewriting text that is not an explanation, and translation.

## The check script

For a long explanation saved to a file, Claude can check it, and so can you:

```bash
node plugins/clear-explain/skills/clear-explain/scripts/check-clarity.mjs answer.md
cat answer.md | node plugins/clear-explain/skills/clear-explain/scripts/check-clarity.mjs --json
```

It works on English and Korean, line by line, and prints each finding with its line number:

```
line 2 [fix] forbidden-character: em dash (U+2014) -> end the sentence, or use a comma or parentheses
line 4 [review] vague-word: handles -> name the action (catch and log, retry, return a default)
line 9 [review] vague-word: Basically -> usually removable without changing the meaning
line 9 [review] vague-word: just -> remove if the sentence means the same without it
line 9 [review] long-sentence: 26 words (Basically, git fetch just down...) -> one idea per sentence; aim for 25 words or fewer
line 11 [review] possessive-chain: 사용자의 주문의 결제의 상태를 -> use 의 at most twice in a row; rewrite with a verb

1 to fix, 5 to review
```

| Check | English | Korean |
|---|---|---|
| Vague words | handle, manage, etc., and/or, via, may, simply, and others in `data/vague-words-en.txt` | 처리하다, 관리하다, 해당, 적절히, 등, 및, and others in `data/vague-words-ko.txt` |
| Long sentences | More than 25 words | More than 100 characters with spaces |
| Chained possessives | `a's b's c` and `of the ... of the ... of` | Three or more 의 in a row |
| Stacked passives | `is expected to be called` | 되어지다, 보여지다 |
| Double negatives | none | ~하지 않으면 안 된다 |
| Two characters | The em dash (U+2014) and the middle dot (U+00B7), everywhere including code | Same |

Fenced code blocks (a fence with at most three spaces before it, or any indentation inside a list), indented code blocks (four spaces or a tab after a blank line, outside a list), inline code, and URLs are skipped, except for the two characters. Markdown emphasis markers (`**`, `*`, `__`, `_`) at the start or end of a word are removed before the checks, so `**사용자의 주문의 결제의** 상태` is still a chain. Only the two characters are "fix"; the rest are things to look at, because a vague word nobody has to act on can stay. The exit code is 1 when there is something to fix, and 2 when the file cannot be read or the arguments are wrong.

## Measured

[`behaviors.csv`](../../evals/clear-explain/behaviors.csv) lists 45 behaviors. Unit tests in CI cover 35 of them, all about the check script and the measurement runner. The other 10 are about the answers themselves and need a model run; the runs below score five of them (answer first, and how often the skill starts on its own and when it should not, on the tuning set and on a held-out set) and record the judge's factual-error flag for a sixth.

[`evals/clear-explain/run-explain.mjs`](../../evals/clear-explain/run-explain.mjs) asks the 12 questions in [`questions.json`](../../evals/clear-explain/questions.json) (6 English, 6 Korean, developer topics) twice through `claude -p` with no user settings: once with `--plugin-dir plugins/clear-explain` and once without. Answers came from the `opus` model alias, one run per question per arm. The script scores each answer, and a judge on claude-sonnet-5-5 sees both answers in random order, without the plugin name, and picks the one the asker would understand correctly after one read. A second judge pass (`--rejudge`) showed the same judge the same stored answers again, each pair in the opposite order.

| 12 questions, 1 run each | With clear-explain | Without |
|---|---|---|
| Judge picked it, first pass (random order) | 10 | 2 |
| Judge picked it, second pass (order swapped) | 9 | 3 |
| Judge picked it in both orders | 7 | 0 |
| Script findings per 1,000 characters (mean) | 1.34 | 2.90 |
| Long sentences (total) | 2 | 3 |
| Opens with a prose paragraph (script) | 12 of 12 | 7 of 12 |
| First two sentences answer the question (judge, first pass) | 12 of 12 | 9 of 12 |
| Factual errors (judge, first pass) | 0 | 1 |
| Average length (prose characters) | 1,406 | 1,294 |
| Average time per answer | 16 s | 12 s |
| Reported cost of the 12 answers | $1.12 | $0.69 |

The judge preferred the skill's answer in both orders for 7 of 12 questions, the baseline in both orders for 0, and changed its pick with the order for 5. By language, the skill's answer won in both orders 4 of 6 times in English and 3 of 6 in Korean; the other 2 and 3 changed with the order. The second pass flagged no factual error in either arm, and said the first two sentences answered the question in 12 of 12 answers with the skill and 10 of 12 without. Script findings per 1,000 characters were 0.58 against 1.27 in English and 2.10 against 4.52 in Korean. The first judge pass cost $0.27 and the second $0.27 (66,582 tokens, 30 seconds with 4 at once), for $2.35 in total; these are Claude Code's list-price estimates. Results, with every answer and the judge's reasons: [`evals/clear-explain/results/`](../../evals/clear-explain/results/).

How far to trust it:
- **Answer order decided 5 of the 12 judge results.** In the first pass the random draw showed the skill's answer second in 10 of the 12 questions, and the judge picked the second answer 10 times. In the second pass, with every pair swapped, it picked the second answer 5 times. For the 5 questions where the two passes disagree, the position won, not the answer, so only the 7 picks that held in both orders count for the skill. All 24 picks come from one judge model; another judge could weigh the answers differently.
- **One run per arm.** A second run of the same question can give a different answer. The numbers show a direction, not a size.
- **The script numbers do not depend on order**, but the script measures form, not whether an answer is right or useful.
- The first pass's two losses (closures, where it found one misleading line in the skill's answer, and `await` in a loop, where it preferred the other answer's timeline diagrams) both turned into wins for the skill in the second pass, so they are among the 5 that changed with the order, together with three Korean questions (event loop, `unknown`, `key`).

The script numbers above come from the current `check-clarity.mjs` (`--rescore` on the stored answers).

The answers were written with an earlier SKILL.md whose only difference from the current one is the `description` line in the frontmatter; it was narrowed afterwards for the trigger measurement below. The results file records that earlier description and the hash of the body without its frontmatter, and the current SKILL.md body has the same hash, so you can check that the body did not change. From now on the runner records the body hash and the description separately for every run.

### When the skill starts

The skill should start for a request to explain and stay out of everything else. The description was narrowed while looking at the 12 questions and 8 other requests below, so they are the tuning set: they show the description does what it was written to do on the requests it was written against. A held-out set, written after the description and run once, follows.

`run-explain.mjs --triggers` sends each of the 12 questions and 8 other requests once, with the plugin loaded, the tools of a normal session (editing, the shell, and web search, not only Skill and Read; a tool that needs a permission is denied, as in the answer runs), no user settings, and at most 6 turns, and records whether Claude invoked the skill. The other requests are in [`triggers.json`](../../evals/clear-explain/triggers.json): in English and in Korean, one request each to fix code, to look up a fact, and to write code, plus one rewrite in English and one translation in Korean.

| Tuning set, one run each, `opus`, 2026-10-25 | Requests | Skill started |
|---|---|---|
| Questions to explain (true triggers) | 12 | 12 (rate 1.0) |
| Fix, lookup, write, rewrite, translate (false triggers) | 8 | 0 (rate 0.0) |

| Other request | Skill started |
|---|---|
| Why does this test fail? Fix it. (with the code) | No |
| What is the latest version of zod? | No |
| Write a JavaScript function that removes duplicate items from an array... | No |
| Rewrite this commit message so it is shorter: ... | No |
| 이 코드에서 TypeError ... 에러가 나. 고쳐줘. (with the code) | No |
| Node.js 최신 LTS 버전이 뭐야? | No |
| 날짜 문자열 배열을 최신순으로 정렬하는 TypeScript 함수 만들어줘. | No |
| 이 문장 영어로 번역해줘: ... | No |

The 20 runs cost $1.80. The answers of this run were not kept or judged: the change was to the description only, and the skill body that produced the judged answers above is the same.

**Held-out set.** [`triggers-held-out.json`](../../evals/clear-explain/triggers-held-out.json) has 19 requests written after the description and not used to change it: 8 questions to explain on topics that are not in `questions.json`, and 11 other requests of kinds the tuning set does not have, in English and Korean. `run-explain.mjs --held-out evals/clear-explain/triggers-held-out.json -j 4` sent each one once with the same flags as the tuning run.

| One run each, `opus` | Tuning set, written against (2026-10-25) | Held-out set (2026-10-26) |
|---|---|---|
| Questions to explain, skill started | 12 of 12 | 8 of 8 |
| Other requests, skill started | 0 of 8 | 0 of 11 |

| Held-out request | Explain | Skill started |
|---|---|---|
| Review this diff before I merge it and list anything that should change. (with a diff) | No | No |
| Write Vitest tests for this function, including an empty string and extra spaces. (with the code) | No | No |
| Summarize this log in two lines. (with the log) | No | No |
| Rename `d` to something clearer and give me the snippet back. (with the code) | No | No |
| continue | No | No |
| What day of the week is December 25, 2026? | No | No |
| 이 함수에 JSDoc 주석 달아줘. (with the code) | No | No |
| 이 회의 메모 세 줄로 요약해줘. (with the notes) | No | No |
| 내일 서울 날씨 어때? | No | No |
| 이 함수 이름 더 알맞게 바꿔줘. (with the code) | No | No |
| 계속해 | No | No |
| How does hoisting work for let and const? | Yes | Yes |
| What does this regex check? (with the regex) | Yes | Yes |
| I keep getting "Maximum update depth exceeded" in React. What causes it? | Yes | Yes |
| Cookies or localStorage for a login token: how are they different? | Yes | Yes |
| DB 인덱스는 어떻게 조회를 빠르게 해? | Yes | Yes |
| 도커 이미지랑 컨테이너는 뭐가 달라? | Yes | Yes |
| 자바 가비지 컬렉션이 뭔지 모르겠어 | Yes | Yes |
| 이 코드가 뭘 하는 건지 감이 안 와: (with a line of code) | Yes | Yes |

The 19 held-out runs cost $1.54. Both sets are one run per request, and neither has requests close to the line, such as "why does this test fail?" without "fix it", so they show the description does not pull in the clear cases; they do not bound the rate for the unclear ones. Results: [`evals/clear-explain/results/`](../../evals/clear-explain/results/).

To run it again: `node evals/clear-explain/run-explain.mjs -j 4`, then `node evals/clear-explain/run-explain.mjs --rejudge <results file>` for the swapped pass, and `node evals/clear-explain/run-explain.mjs --triggers -j 4` and `--held-out evals/clear-explain/triggers-held-out.json -j 4` for when the skill starts. It uses your Claude account.

## Cost

| Part | Always on, every session | Each time it runs |
|---|---|---|
| clear-explain skill | about 185 tokens | about 3,400 tokens |

The reference files are read only when needed; in the measured run Claude read none of them.

## Data

clear-explain makes no network calls and stores nothing. The check script reads the file you give it, or stdin, and prints to the terminal.

## Limits

- Only English and Korean have their own rules and script checks. Other languages get the general rules, and the script checks only sentence length (by words) and the two characters there.
- The script counts sentences per line, so a sentence hard-wrapped across lines is counted in parts, and an abbreviation such as "e.g." can end a sentence early.
- Sentence limits are a rule of thumb. The Korean limit of 100 characters is an estimate from STE's 25 English words; Korean sources give no number.
- The skill starts when Claude decides the question asks for an explanation. The trigger measurements above are one run each of 20 tuning and 19 held-out requests. Use the command when it matters.
- ASD-STE100 is the basis, not the content: this plugin restates principles in its own words and is not an STE compliance tool. See `references/sources.md`.

## Uninstall

```
/plugin uninstall clear-explain@lim
```
