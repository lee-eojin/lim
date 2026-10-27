import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkText, formatReport, LIMITS, sentenceSize } from '../../plugins/clear-explain/skills/clear-explain/scripts/check-clarity.mjs';

const script = fileURLToPath(new URL('../../plugins/clear-explain/skills/clear-explain/scripts/check-clarity.mjs', import.meta.url));
const EM_DASH = String.fromCharCode(0x2014);
const MIDDLE_DOT = String.fromCharCode(0x00b7);

const findingsOf = (text, rule) => checkText(text).findings.filter((finding) => !rule || finding.rule === rule);
const words = (count) => Array.from({ length: count }, (_, index) => `word${index}`).join(' ');

function runCli(args, input) {
  return spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8' });
}

test('an em dash and a middle dot are must-fix findings with their line numbers', () => {
  const text = `The cache keeps the result.\nIt expires ${EM_DASH} after a minute.\nA ${MIDDLE_DOT} B\n`;
  const found = findingsOf(text, 'forbidden-character');
  assert.deepEqual(found.map((finding) => [finding.line, finding.match, finding.mustFix]), [
    [2, 'em dash (U+2014)', true],
    [3, 'middle dot (U+00B7)', true],
  ]);
});

test('the two characters are found inside code blocks too', () => {
  const found = findingsOf(`Text.\n\n\`\`\`js\nconst label = 'a ${MIDDLE_DOT} b';\n\`\`\`\n`, 'forbidden-character');
  assert.deepEqual(found.map((finding) => finding.line), [4]);
});

test('English vague words are found with their line numbers', () => {
  const text = 'React renders the list.\nThe hook handles errors, etc.\nUse a map and/or a set.\n';
  const found = findingsOf(text, 'vague-word');
  assert.deepEqual(found.map((finding) => [finding.line, finding.match]), [[2, 'handles'], [2, 'etc.'], [3, 'and/or']]);
  assert.ok(found.every((finding) => !finding.mustFix && finding.advice));
});

test('Korean vague words are found with their line numbers', () => {
  const text = '컴포넌트가 렌더링된다.\n해당 함수가 에러를 처리한다.\n값을 적절히 바꾼다.\n';
  const found = findingsOf(text, 'vague-word');
  assert.deepEqual(found.map((finding) => [finding.line, finding.match]), [[2, '처리한'], [2, '해당'], [3, '적절히']]);
});

test('내지 counts only as its own word and ~수 있다 only when it means a possibility', () => {
  const text = '배열에서 값을 꺼내지 않는다.\n2 내지 3초가 걸린다.\n이 함수는 배열을 받을 수 있다.\n설정을 바꾸면 값이 사라질 수도 있다.\nvar와 다르게 동작한다고 할 수 있습니다.\n';
  const found = findingsOf(text, 'vague-word');
  assert.deepEqual(found.map((finding) => [finding.line, finding.match]), [[2, '내지'], [4, '수도 있'], [5, '다고 할 수 있']]);
});

test('code and URLs are not checked for vague words', () => {
  const text = 'Call `handle()` to start.\n\n```js\nsimply.handle(etc);\n```\n\nSee https://example.com/simply-handle for details.\n';
  assert.deepEqual(findingsOf(text), []);
});

test('an English sentence over 25 words is long and one of 25 words is not', () => {
  assert.equal(LIMITS.englishWords, 25);
  assert.deepEqual(findingsOf(`${words(25)}.`, 'long-sentence'), []);
  const found = findingsOf(`Short one.\n${words(26)}. Another short one.`, 'long-sentence');
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
  assert.match(found[0].match, /^26 words/);
});

test('a Korean sentence over 100 characters is long and one of 100 is not', () => {
  assert.equal(LIMITS.koreanCharacters, 100);
  const exactly = `${'가'.repeat(99)}.`;
  assert.deepEqual(sentenceSize(exactly), { size: 100, unit: 'characters', limit: 100 });
  assert.deepEqual(findingsOf(exactly, 'long-sentence'), []);
  const found = findingsOf(`짧다.\n\n${'가'.repeat(100)}.`, 'long-sentence');
  assert.deepEqual(found.map((finding) => [finding.line, finding.match.split(' (')[0]]), [[3, '101 characters']]);
});

test('headings and table rows are not counted as long sentences', () => {
  assert.deepEqual(findingsOf(`# ${words(30)}\n| ${words(30)} |\n`, 'long-sentence'), []);
});

test('three Korean possessives in a row are a chain and two are not', () => {
  const found = findingsOf('사용자의 주문의 결제의 상태를 바꾼다.\n사용자의 주문의 상태를 바꾼다.\n', 'possessive-chain');
  assert.deepEqual(found.map((finding) => [finding.line, finding.match]), [[1, '사용자의 주문의 결제의 상태를']]);
});

test('nouns that end in 의 do not count as possessives', () => {
  assert.deepEqual(findingsOf('정의 회의 주의 사항을 읽는다.\n', 'possessive-chain'), []);
});

test('English possessive and of chains are found', () => {
  const found = findingsOf("The user's session's token expires.\nThe size of the cache of the client of the app grows.\n", 'possessive-chain');
  assert.deepEqual(found.map((finding) => finding.line), [1, 2]);
});

test('stacked passives are found in Korean and English', () => {
  const found = findingsOf('설정이 되어진다.\nThe handler is expected to be called once.\nThe handler is called once.\n', 'passive-stack');
  assert.deepEqual(found.map((finding) => [finding.line, finding.match]), [[1, '되어진'], [2, 'is expected to be called']]);
});

test('a Korean double negative is found', () => {
  const found = findingsOf('키를 넣지 않으면 안 된다.\n', 'double-negative');
  assert.deepEqual(found.map((finding) => finding.line), [1]);
});

test('clear English and Korean text has nothing to look at', () => {
  const english = 'A closure is a function that keeps a reference to the variables around it.\nReact calls the component again when its state changes.\n';
  const korean = 'closure는 바깥 변수를 계속 참조하는 함수다.\nstate가 바뀌면 React가 컴포넌트를 다시 호출한다.\n';
  assert.deepEqual(findingsOf(english), []);
  assert.deepEqual(findingsOf(korean), []);
});

test('the summary counts findings per 1000 prose characters', () => {
  const { summary } = checkText(`It simply works.\n\n\`\`\`\n${'x'.repeat(500)}\n\`\`\`\n`);
  assert.equal(summary.characters, 16);
  assert.equal(summary.review, 1);
  assert.equal(summary.issuesPer1000, 62.5);
});

test('the report lists each finding with its line and ends with the counts', () => {
  const report = formatReport(checkText(`Fine.\nIt ${EM_DASH} simply works.\n`));
  assert.match(report, /^line 2 \[fix\] forbidden-character: em dash/m);
  assert.match(report, /^line 2 \[review\] vague-word: simply/m);
  assert.match(report, /1 to fix, 1 to review\n$/);
  assert.equal(formatReport(checkText('Fine.\n')), 'Nothing to look at.\n');
});

test('the command reads stdin and prints JSON on request and exits 1 only for must-fix findings', () => {
  const clean = runCli([], 'React renders the list.\n');
  assert.equal(clean.status, 0);
  assert.equal(clean.stdout, 'Nothing to look at.\n');
  const review = runCli([], 'It simply works.\n');
  assert.equal(review.status, 0);
  const fix = runCli(['--json'], `A ${MIDDLE_DOT} B\n`);
  assert.equal(fix.status, 1);
  assert.equal(JSON.parse(fix.stdout).findings[0].line, 1);
  assert.equal(runCli(['one.md', 'two.md'], '').status, 2);
});

test('emphasis markers at word edges do not hide a Korean possessive chain', () => {
  const found = findingsOf('**사용자의 주문의 결제의** 상태를 바꾼다.\n__사용자의__ *주문의* 결제의 상태\n', 'possessive-chain');
  assert.deepEqual(found.map((finding) => [finding.line, finding.match]), [[1, '사용자의 주문의 결제의 상태를'], [2, '사용자의 주문의 결제의 상태']]);
  assert.deepEqual(findingsOf("**The user's session's** token expires.\n", 'possessive-chain').map((finding) => finding.line), [1]);
  assert.deepEqual(findingsOf('* 사용자의 목록\n- 2 * 3 = 6\n'), []);
});

test('indented code blocks are not checked as prose but indented list text is', () => {
  const code = 'React renders the list.\n\n    simply.handle(etc);\n\tconst total = items.length; // and/or\n\nThe end.\n';
  assert.deepEqual(findingsOf(code), []);
  const listText = '- First item.\n\n    It simply works.\n';
  assert.deepEqual(findingsOf(listText, 'vague-word').map((finding) => [finding.line, finding.match]), [[3, 'simply']]);
  const continuation = 'A paragraph line.\n    It simply continues.\n';
  assert.deepEqual(findingsOf(continuation, 'vague-word').map((finding) => [finding.line, finding.match]), [[2, 'simply']]);
  assert.deepEqual(findingsOf(`Text.\n\n    const label = 'a ${MIDDLE_DOT} b';\n`, 'forbidden-character').map((finding) => finding.line), [3]);
});

test('the Korean 등 is reported as the word without the space before it', () => {
  const found = findingsOf('배열, 객체 등을 넘긴다.\n', 'vague-word');
  assert.deepEqual(found.map((finding) => [finding.line, finding.match]), [[1, '등']]);
  assert.match(formatReport(checkText('배열, 객체 등을 넘긴다.\n')), /vague-word: 등 ->/);
});

test('the Korean 등 is found at the end of a line and before 으로 and 에서', () => {
  const text = '- 배열, 객체 등\n배열, 객체 등으로 나눈다.\n배열, 객체 등에서 꺼낸다.\n배열, 객체 등과 함께 쓴다.\n';
  const found = findingsOf(text, 'vague-word');
  assert.deepEqual(found.map((finding) => [finding.line, finding.match]), [[1, '등'], [2, '등'], [3, '등'], [4, '등']]);
});

test('a word that contains 등 such as 등록 or 평등 is not reported', () => {
  assert.deepEqual(findingsOf('사용자 등록 화면을 연다.\n모든 요청은 평등하다.\n회원 등급을 바꾼다.\n', 'vague-word'), []);
});

test('a file that cannot be read is a one-line usage error with exit code 2', () => {
  const missing = runCli(['nonexistent.md'], '');
  assert.equal(missing.status, 2);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /^Cannot read nonexistent\.md: /);
  assert.equal(missing.stderr.trim().split('\n').length, 1);
});

test('an indented line that looks like a fence does not hide the rest of the file', () => {
  const indentedCode = 'Install it first.\n\n    ```js\n    npm install\n\nIt simply works.\n';
  assert.deepEqual(findingsOf(indentedCode, 'vague-word').map((finding) => [finding.line, finding.match]), [[6, 'simply']]);
  const continuation = 'A paragraph line.\n    ```js\nIt simply works.\n';
  assert.deepEqual(findingsOf(continuation, 'vague-word').map((finding) => [finding.line, finding.match]), [[3, 'simply']]);
  const inList = '- Run this:\n\n    ```js\n    simply.handle(etc);\n    ```\n\nThe end.\n';
  assert.deepEqual(findingsOf(inList), []);
});

test('a fence closes only on a fence of the same character at least as long as the one that opened it', () => {
  const vagueLines = (text) => findingsOf(text, 'vague-word').map((finding) => finding.line);
  assert.deepEqual(vagueLines('Intro.\n\n````md\n```js\nconst x = simply(just);\n```\n````\n'), []);
  assert.deepEqual(vagueLines('Intro.\n\n~~~\n```\nconst y = simply(just);\n~~~\n'), []);
  assert.deepEqual(vagueLines('````\n```\n````\nIt simply works.\n'), [4]);
});

test('an indented code block after a list and a fenced block is not checked as prose', () => {
  assert.deepEqual(findingsOf('- item one\n\n```\ncode\n```\n\n    const z = simply(just);\n', 'vague-word'), []);
});

test('a fence right under a list item ends the list, so a later indented block is code', () => {
  assert.deepEqual(findingsOf('- item\n```\ncode\n```\n\n    const z = simply(just);\n', 'vague-word'), []);
  assert.deepEqual(findingsOf('- item\n  ```\n  code\n  ```\n\n    It simply works.\n', 'vague-word').map((finding) => finding.line), [6]);
});

test('a Korean double negative is found with 되는 and 되지 too', () => {
  const found = findingsOf('반드시 저장하지 않으면 안 되는 값이다.\n저장하지 않으면 안 되지.\n', 'double-negative');
  assert.deepEqual(found.map((finding) => finding.line), [1, 2]);
});

test('an English possessive chain with a curly apostrophe is found', () => {
  assert.equal(findingsOf('The user’s order’s status changes.\n', 'possessive-chain').length, 1);
});
