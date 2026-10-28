# Changelog

All notable changes to clear-explain. Versions follow [Semantic Versioning](https://semver.org); see "Releases" in [CONTRIBUTING.md](../../CONTRIBUTING.md) for what each number means here.

## 0.1.5 (2026-10-28)

- Fixed: `check-clarity.mjs` counts a sentence that a soft line break wraps across lines as one sentence, so wrapping a long sentence no longer hides it. List items, headings (also setext underlines), table rows (also without leading pipes), quotes, code blocks, front matter, and HTML lines still end a sentence. Front matter, lines that start with an HTML tag, and code indented under a list item are no longer checked. (#175)

## 0.1.4 (2026-10-28)

- Fixed: `check-clarity.mjs` closes a fenced code block only on a fence of the same character that is at least as long, skips an indented code block after a list and a fenced block (also when the fence sits right under a list item), finds the double negatives 안 되는 and 안 되지, and finds possessive chains written with a curly apostrophe. (#141)

## 0.1.3 (2026-10-27)

- Fixed: A Korean question that writes a concept in Hangul, such as 클로저, gets an answer that uses the English name (closure). In three headless sessions after the change, none used 클로저; before, one of the two saved sessions did. (#116)

## 0.1.2 (2026-10-27)

- Fixed: `check-clarity.mjs` no longer reports 내지 inside a word such as 꺼내지, and reports ~수 있다 only in its possibility form ~수도 있다 and in the filler ~다고 할 수 있다, matching the skill's rule that ~할 수 있다 means ability. (#108)

## 0.1.1 (2026-10-27)

- Changed: Answers open with what the thing does, or with the reason for a "why" question, define terms where they first appear and skip terms the question uses only as context, and in Korean name the action instead of 처리하다, 반영하다, or 관리하다. (#102)

## 0.1.0 (2026-10-25)

- Added: The first version. Explanations start with the answer, define each new term in one line, keep one word per meaning and one idea per sentence, name the subject, put conditions first, and keep technical concepts in their official English names, in the user's language. English and Korean rules come as references, and `check-clarity.mjs` lists vague words, long sentences, chained possessives, stacked passives, and two characters to replace, with line numbers. (#66)
