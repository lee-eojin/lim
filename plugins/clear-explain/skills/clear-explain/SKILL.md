---
name: clear-explain
description: Writes explanations that a reader understands the same way after one read, with the answer first, a one-line definition for each new term, one meaning per word, one idea per sentence, and technical concepts in their official English names, adapted from ASD-STE100 Simplified Technical English. Use when the user asks for an explanation, such as what a concept is, what code does, why an error happens, how something works, or how two things differ, in any language, and not when the user asks to fix, change, or write code or text, to translate, or to look up a fact such as a version number.
---

# clear-explain

Write an explanation that the reader reads once and understands the same way you meant it.

The method comes from ASD-STE100 (Simplified Technical English), a controlled language for aircraft maintenance texts. It gives each word one meaning, keeps sentences short, and names who does what. This skill applies those principles to explanations in chat. It is not an STE compliance tool, and the answer should still read like a person wrote it.

Reply in the user's language. Named technical concepts keep their official English names in every language.

Out of scope: rewriting text that is not an explanation, and translation.

## Shape of the answer

Use only the parts the question needs.

1. **Answer.** Answer the question directly in the first one or two sentences. A reader who stops there still has the main point.
2. **Definitions.** Define each concept the answer introduces, in one line: `X is a Y that does Z`.
3. **How or why.** Numbered steps for a sequence, a paragraph for cause and effect.
4. **Example.** The smallest piece of code or one concrete situation, with real names and numbers.
5. **Look-alikes.** Only when a similar concept is easy to confuse. Put them side by side in a table.

A one-line question often needs only parts 1 and 4. Do not add parts to fill the shape. Say each thing once: when the answer is itself a definition ("What is X?"), it is the definition of X, so do not define X again.

Do not use the part names (Answer, Definitions) as headings. The answer is the first paragraph. Use headings only to split a long answer, and name them after the content (for example, "1. The render phase").

Do not end with a numbered menu of related topics. If the user wants more, they will ask.

## Words

- **One meaning per word, one word per meaning.** Call the same thing by the same word to the end of the answer. If you called it state, it stays state, not value, data, or status. A new word makes the reader think of a new thing.
- **Concrete over vague.** Replace broad verbs (handle, manage, process, support) with the actual action. Replace degree words (appropriately, fast, a lot) with the criterion or a number when the reader has to act on it.
  - handles the response -> parses the JSON response into an array
  - rendering is slow -> drawing 1,000 rows takes 300 ms
- **Say the scope of a list.** A closed list names every item ("two cases: A and B"). An open list says so ("cases such as A and B"). Write "A or B, or both" instead of "and/or".
- **Pointing words point at one thing.** Use this, that, or it only when the previous sentence has one candidate. With two or more, repeat the noun.
- **Jargon becomes the action.** "hit the API" -> "send a request to the API". "the style doesn't take" -> "the browser does not apply the style".
- **Plain words.** utilize -> use, in order to -> to, prior to -> before. These are clearer choices, not corrections. A passive verb is not an error.

Word lists: `references/english-rules.md` and `references/korean-rules.md`.

## Technical terms

| Kind | How to write it | Examples |
|---|---|---|
| Names that appear in code (functions, Hooks, props, methods, commands, keywords) | Backticks, original case | `useEffect`, `Promise.all`, `git rebase`, `interface` |
| Named concepts, features, and patterns | English, spelled as in the official documentation | Error Boundary, Effect, Suspense, state, props, closure, event loop |
| Abbreviations | Capitals, spelled out on first use | CORS (Cross-Origin Resource Sharing) |
| Basic terms settled in the reply language | The reply language's usual word | component, rendering, function, error; in Korean, 컴포넌트, 렌더링, 함수, 에러 |

- In a reply in any language, do not translate or transliterate a named concept. The English name is the one the reader can search for.
- Define a named concept in one line the first time it appears. Example: an Error Boundary is a component that catches errors its children throw during rendering and shows a fallback UI instead.
- Keep one spelling for the whole answer. If you wrote Effect, it stays Effect.
- Case follows the official documentation, even at the start of a sentence (closure, not Closure).
- When two similar terms appear together (parameter and argument, render and paint), follow `references/confusables.md`.
- If you are unsure how to write a term, grep `references/dev-terms.md` for it. Do not read the whole file. If it is not there, write it in English and define it.

## Sentences

- **One idea per sentence.** One or two verbs. A descriptive sentence stays under about 25 English words, or about 100 Korean characters with spaces. A procedure step stays under 20 words. Mix short and medium sentences; do not make every sentence the same length.
- **Name the subject.** Say who acts, especially when the actor changes: "it runs again" -> "React calls the component function again". Korean often drops the subject, so name it there too.
- **Active voice.** Use the passive only when the actor is unknown or does not matter. Never stack passives.
- **Conditions first.** "If the dependency array is empty, React runs the Effect once after mounting." The reader meets the condition before picturing the action.
- **Short noun chains.** At most three nouns in a row in English ("session token refresh logic" -> "the logic that refreshes the session token"). At most two 의 in a row in Korean.
- **One meaning for can and may.** can for ability, might for possibility, "is allowed to" for permission. Avoid may.
- **One negation.** "must not fail to" -> "must".
- **Steps as a numbered list.** One action per step, in the imperative.
- **Joins and lists.** Do not join two clauses with an em dash (U+2014); end the sentence or use parentheses. Do not separate list items with a middle dot (U+00B7); use a comma, or "and" or "or" so the scope is clear.

## Tone

- **State certainty.** Say how you know: measured (you ran it, or the documentation states it), inferred (you read the code and reasoned), or unknown. State facts plainly. Mark an inference as one and give the reason. Do not stack hedges ("it might possibly seem").
- **One register.** Keep the formality you started with. In Korean, do not mix 합니다 and 해요 endings in one answer.
- **No condescending words.** simply, just, obviously, of course, easy, "as everyone knows". If the reader finds it hard, these words only make them feel slow.
- **At most one analogy.** Say it is an analogy and where it stops matching. An analogy never replaces the definition.
- **No quotation marks for emphasis.** Put real quotes in a block quote (`>`).
- **Comparisons as tables.** Use "not X but Y" at most once per answer. Compare concepts in a table.
- **Lists only when they help.** A list for ordered steps or three or more parallel items. Otherwise, paragraphs.

## Before you send

Check the answer against this list and fix what fails.

1. The first one or two sentences answer the question.
2. Each new concept has a one-line definition.
3. The same thing has the same word throughout.
4. No named concept is translated or transliterated.
5. No broad verb or degree word is left where the reader has to act on it. Every list says its scope.
6. No sentence is far over the length limit, and no sentence lost its subject.
7. No inference is written as a fact.
8. No emphasis quotes, no repeated "not X but Y", no em dash, no middle dot.

When you write a long explanation (about 1,500 characters or more) to a file, check it with the script:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/check-clarity.mjs <file>
```

It lists vague words, long sentences, chained possessives, stacked passives, double negatives, and the two characters, each with its line number, for English and Korean. Findings are things to look at, not errors, except the two characters. For a chat answer, the list above is enough.

## Example

Question: What does `git fetch` do that `git pull` does not?

A common answer:

> Basically, git fetch just downloads stuff from the remote, while git pull is kind of like fetch plus merge, so it will update your branch too, which may cause conflicts etc.

A clear answer:

> `git fetch` downloads new commits from the remote and stops there. `git pull` downloads the same commits and then merges them into your current branch.
>
> A remote-tracking branch is a read-only copy of a remote branch in your repository, such as `origin/main`. `git fetch` updates only these copies. Your own branch and your working files do not change.
>
> `git pull` runs `git fetch` first. Then Git merges `origin/main` into your `main` (or rebases onto it, if `pull.rebase` is set). If both sides changed the same lines, the merge stops with a conflict.
>
> | Command | Downloads commits | Changes your branch | Can stop with a conflict |
> |---|---|---|---|
> | `git fetch` | Yes | No | No |
> | `git pull` | Yes | Yes | Yes |

What changed: the answer comes first. "stuff" became "new commits". The term remote-tracking branch has a one-line definition. Each sentence names its subject (Git, `git fetch`). "may cause conflicts etc." became the one condition that causes a conflict. The comparison is a table.

A Korean example is in `references/korean-rules.md`.

## References

| File | Read it when |
|---|---|
| `references/english-rules.md` | Writing in English: ambiguous words, modal verbs, plain substitutes |
| `references/korean-rules.md` | Writing in Korean: vague words, stiff phrases, particles after English terms, a full example |
| `references/dev-terms.md` | Unsure whether or how to write a term in English (grep, do not read it all) |
| `references/confusables.md` | Explaining two or more similar terms together |
| `references/sources.md` | The user asks where a rule comes from, or about licenses |

For other languages, use the general rules in this file.
