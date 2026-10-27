# Changelog

All notable changes to clear-explain. Versions follow [Semantic Versioning](https://semver.org); see "Releases" in [CONTRIBUTING.md](../../CONTRIBUTING.md) for what each number means here.

## 0.1.1 (2026-10-27)

- Changed: Answers open with what the thing does, or with the reason for a "why" question, define terms where they first appear and skip terms the question uses only as context, and in Korean name the action instead of 처리하다, 반영하다, or 관리하다. (#102)

## 0.1.0 (2026-10-25)

- Added: The first version. Explanations start with the answer, define each new term in one line, keep one word per meaning and one idea per sentence, name the subject, put conditions first, and keep technical concepts in their official English names, in the user's language. English and Korean rules come as references, and `check-clarity.mjs` lists vague words, long sentences, chained possessives, stacked passives, and two characters to replace, with line numbers. (#66)
