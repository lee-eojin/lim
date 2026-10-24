# LIM

**Less is more.** 작은 Claude Code 플러그인 모음입니다. 각 플러그인은 한 가지 일만 하고, 그 근거가 되는 측정 결과를 함께 보여 줍니다.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

> 이 문서는 2026-10-24 시점의 [영어 README](../../README.md)를 번역한 문서입니다. 두 문서의 내용이 다르면 영어 README가 맞습니다.

[English](../../README.md) | 한국어 | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | [Bahasa Indonesia](README.id.md)

코딩 에이전트는 코드를 빨리 씁니다. 하지만 자기가 틀린 곳을 알아차리는 데는 훨씬 서툽니다. 변경을 작성한 에이전트는 그 변경의 가장 약한 리뷰어입니다. 자기 추론을 따라 변경을 읽고, 스스로에게 동의하기 때문입니다. 그래서 작업은 리뷰 없이 커밋되거나, 그 작업을 쓴 바로 그 맥락에서 나온 리뷰만 거쳐 커밋됩니다.

**제가 내놓은 답이 LIM입니다. 플러그인마다 한 가지 일만 하고, 그 근거를 숫자로 보여 줍니다.** 첫 번째 플러그인은 review-loop입니다.

**review-loop를 쓰면 "커밋할 준비가 됨"이 곧 "리뷰를 마침"이 됩니다.** 프로젝트의 테스트, 타입 검사, lint가 먼저 실행됩니다. 그다음 새 맥락의 리뷰어가 지적 사항에 P1부터 P5까지 등급을 붙입니다. 이 리뷰어는 Claude의 추론을 보지 않으며, 심각한 지적 사항에는 근거를 보여야 합니다. Claude가 P1과 P2를 수정하면, 새 리뷰어가 그 수정을 확인합니다. 멈출 시점은 모델이 아니라 스크립트가 정합니다. 나머지는 마지막에 사용자가 한 번만 결정합니다.

**되풀이하는 리뷰 코멘트는 규칙이 됩니다.** 지적 사항에 "규칙으로 만들기"(make it a rule)를 고르면, Claude가 lint 규칙이나 테스트 초안을 씁니다. review-loop는 그 초안을 수정 전 코드에 실행해서, 초안이 그 실수를 잡아낸다는 것을 증명합니다. 버그 수정에도 같은 방식으로 회귀 테스트가 붙습니다.

**의도적으로 작게.** review-loop가 세션에 추가하는 양은 약 212 토큰입니다. hook은 사용자가 저장소에서 켜기 전까지 아무 일도 하지 않습니다. 무엇이든 설치하기 전에는 그것이 무엇이고 어떻게 제거하는지 먼저 알려 줍니다.

fork해서 바꾸고, 자기 것으로 만들어 써도 좋습니다. 이슈와 pull request를 환영합니다.

## 플러그인

| 플러그인 | 상태 | 하는 일 |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.4.0 | 커밋 전에 변경 사항을 리뷰하고, P1과 P2 지적 사항을 수정하고, 다시 리뷰한 뒤, 나머지를 사용자에게 넘깁니다. |

## 설치

Claude Code, git, Node.js 18 이상이 필요합니다.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Claude Code가 재시작을 요청하면 재시작합니다. marketplace를 추가하면 카탈로그만 등록됩니다. 각 플러그인은 따로 설치하므로, 사용자가 고른 플러그인만 설치됩니다.

## 시작하기

두 단계면 됩니다.

1. 위와 같이 review-loop를 설치합니다.
2. 커밋하지 않은 변경 사항이 있는 git 저장소에서 다음을 입력합니다.

```
/review-loop:review-loop
```

이게 전부입니다. review-loop는 검사를 실행하고, 변경을 리뷰하고, 반드시 고쳐야 할 것을 고친 뒤, 나머지는 사용자에게 묻습니다. 마지막에는 이 저장소에서 커밋 게이트를 켤지 한 번 묻고, 그다음 커밋할지 묻습니다.

## 사용법

### `/review-loop:review-loop`만 쓰면 됩니다

커밋하려 할 때마다 입력합니다. 명령 뒤에 원하는 내용을 일반 문장으로 덧붙일 수 있습니다.

```
/review-loop:review-loop I changed the coupon math. Check it before I commit.
```

```
/review-loop:review-loop confirm every P2 with me before you fix anything.
```

리뷰나 커밋을 요청하면 Claude가 스스로 review-loop를 시작할 수도 있습니다. 다만 Claude가 이 스킬이 맞는다고 판단할 때만 시작합니다. 명령을 쓰면 항상 시작됩니다.

### 한 라운드의 모습

모든 라운드는 보고서로 끝납니다. Claude는 다른 무엇보다 이 보고서를 먼저 보여 줍니다.

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

이 예시에서는 라운드 1이 P1 하나를 찾았습니다. Claude가 그것을 수정하고 회귀 테스트를 작성했고, review-loop는 그 테스트가 수정 전 코드에서 실패한다는 것을 보여 주었습니다. 라운드 2가 수정을 확인했으므로 루프가 멈췄습니다. P3 하나가 사용자 몫으로 남았습니다.

### 예시

<details>
<summary>모든 프롬프트</summary>

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

## 리뷰 진행 방식

커밋하기 전에 review-loop는 짧은 루프를 실행하고, 스스로 멈춥니다.

1. **검사.** `package.json`의 `typecheck`, `lint`, `test` 스크립트를 실행합니다. 검사가 실패하거나 `package.json`이 올바른 JSON이 아니면, 그 결과는 P1 지적 사항이 됩니다. 검사가 제한 시간을 넘기면, 실패 대신 "검증되지 않음"(not verified)으로 보고합니다.
2. **새 리뷰.** 별도의 리뷰어 에이전트가 diff와, 사용자가 원한 내용을 요약한 한 줄을 받습니다. 이 변경에 대한 Claude의 추론은 받지 않습니다. 리뷰어는 맥락을 파악하기 위해 주변 코드를 읽을 수 있습니다. 리뷰어는 지적 사항에 P1부터 P5까지 등급을 붙입니다. P1과 P2에는 근거가 필요합니다. 근거는 정확한 줄, 실패 시나리오, 기존 장치가 그 실패를 막지 못하는 이유입니다. 지적 사항마다 measured(측정), inferred(추론), guessed(추측) 중 하나를 표시합니다. 근거가 없거나 guessed로 표시된 P1과 P2는 수정하지 않고, 미검증으로 사용자에게 보여 줍니다.
3. **수정.** Claude가 무엇을 수정할지 먼저 말하고, 그다음 P1과 P2를 수정합니다. 수정에 설계 선택이 필요하면(수정 방법이 둘 이상, 사용자에게 보이는 동작 변경, 기능 제거, 테스트 변경) 사용자가 먼저 선택합니다. 프로젝트에 test 스크립트가 있으면, Claude는 수정하는 P1과 P2마다 실패 시나리오로 회귀 테스트를 작성합니다. review-loop는 그 테스트가 수정 전 코드에서 실패한다는 것을 보여 줍니다.
4. **재리뷰.** 새 리뷰어가 수정한 부분과 아직 해결되지 않은 지적 사항만 확인합니다. 최대 3라운드까지 진행합니다.
5. **중단.** 멈출 시점은 모델이 아니라 스크립트가 정합니다. 스크립트는 다음 중 하나에 해당하면 멈춥니다: P1이나 P2가 남지 않음, 라운드 한도에 도달함, 두 번 수정해도 남는 지적 사항이 있음, 해결된 지적 사항이 다시 나타남, P1 + P2 개수가 더 줄지 않음, 수정이 테스트나 검사를 약하게 만듦.
6. **결정.** 나머지는 사용자가 한 번만 결정합니다. 대상은 P3부터 P5까지 전부와, 아직 해결되지 않았거나, 검증하지 못했거나, 리뷰한 diff 밖의 파일에 대한 P1과 P2입니다. 사용자는 지적 사항마다 그대로 두기, 이번만 수정하기, 규칙으로 만들기 중 하나를 고릅니다. 그대로 두기를 고른 지적 사항은 인용한 줄이 바뀌기 전까지 다음 리뷰에서 다시 묻지 않고, 대신 보고서에 그 개수를 보여 줍니다. 이 저장소의 이전 리뷰에서 리뷰어가 찾는 네 종류 중 하나(추측성 가드 등)가 3번 이상 나왔다면, Claude가 그 사실을 알리고 규칙으로 만들라고 권합니다. 이때 맞는 것 중 가장 강한 층을 고릅니다. 순서는 타입이나 아키텍처 변경, lint 규칙, 테스트입니다.
7. **커밋.** 사용자가 "이 저장소에서는 더 묻지 않기"를 선택하지 않았다면, Claude는 커밋 전에 묻습니다. push는 절대 하지 않습니다. 사용자가 커밋 게이트를 켜면, hook이 이 동작을 규칙으로 만듭니다. 리뷰를 통과하기 전까지 Claude의 커밋은 차단됩니다.

Claude가 무언가를 고쳤다고 말할 때는 어떻게 아는지도 함께 말합니다. 이제 통과하는 검사는 measured이고, 새 코드를 읽고 내린 판단은 inferred입니다. 사용자가 지적 사항에 반박하면, Claude는 동의하기 전에 그 주장을 다시 확인하고 무엇을 확인했는지 알려 줍니다.

### 리뷰어가 찾는 것

리뷰어는 버그, 누락된 요구 사항, 프로젝트 규칙 위반을 찾습니다. 그 밖에도 사용자가 원한 일을 이 변경이 해내지 못하게 만드는 것이라면 무엇이든 찾습니다. 사용자가 원한 것 자체를 두고 다투지는 않습니다. 에이전트가 문제의 원인을 모를 때 추가하는 네 종류의 코드도 찾습니다. 다음 에이전트가 그 코드를 따라 하기 때문입니다.

<details>
<summary>네 가지 종류</summary>

| 종류 | 설명 | 심각도 |
|---|---|---|
| 추측성 가드(Speculative guard) | 일어날 수 있다는 근거가 없는 상태를 막는 검사, try/catch, fallback, 기본값 | 실패를 숨기면 P2, 그 밖에는 P3 |
| 이력 주석(History comment) | 누가 무엇을 요청했는지, 이전 버전이 왜 바뀌었는지 설명하는 주석, 또는 에이전트에게 주는 지시 | P4 |
| 임시방편 표시(Shortcut marker) | 이슈 링크가 없는 TODO, HACK, "temporary", "for now" 같은 주석 | P3 |
| 두 번째 방식(Second way) | 코드베이스가 이미 다른 방식으로 하는 일을 위한 헬퍼, 패턴, 의존성 | P3 |

가드가 맞는 곳은 정당한 상태가 코드로 들어오는 지점입니다. 사용자 입력, 네트워크나 파일 읽기, API 문서가 없을 수 있다고 밝힌 값이 여기에 해당합니다. 이미 처리한 상태를 더 안쪽에서 한 번 더 검사한다면, 그 검사는 여전히 추측성 가드입니다. [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/)의 fixture에는 각 종류가 하나씩 들어 있고, 리뷰어가 그것들을 모두 지적하는지 확인합니다.

</details>

### 심각도

뱅크샐러드가 공개한 Pn 규칙을 기반으로 합니다.

| 등급 | 의미 | 루프 동작 |
|---|---|---|
| P1 | 반드시 수정: 검사 실패, 데이터 손실, 보안 취약점, 크래시, 또는 요청한 기능이 동작하지 않음 | 근거가 있을 때만 수정 |
| P2 | 수정 권장: 특정 입력으로 재현되는 버그, 누락된 요구 사항, 프로젝트 규칙 위반 | 근거가 있을 때만 수정 |
| P3 | 수정할 가치 있음: 유지보수성, 오해를 부르는 이름, 중요도가 낮은 경로의 테스트 누락 | 사용자가 결정 |
| P4 | 선택: 사람마다 의견이 갈리는 구조 선호 | 사용자가 결정 |
| P5 | 사소함: 오타나 포맷 | 사용자가 결정 |

그 라운드가 리뷰한 diff에 없는 파일에 대한 P1이나 P2는 루프 안에서 고치지 않습니다. 마지막에 리뷰한 diff 밖이라고 표시해서 사용자에게 넘기고, 심각도는 그대로 둡니다.

### 규칙과 회귀 테스트

리뷰어가 되풀이해서 남겨야 하는 코멘트는 빠진 규칙입니다. 그래서 review-loop는 횟수를 셉니다. 리뷰마다 모든 지적 사항의 종류를 기록하고, 이 기록 파일은 저장소의 모든 worktree가 함께 씁니다. 위 네 종류 중 하나에 해당하는 지적 사항 가운데, 이전 리뷰에서 같은 종류가 3번 이상 나온 것은 반복으로 표시됩니다. correctness 같은 넓은 라벨은 기록되지만 반복으로 세지 않습니다. 사용자가 지적 사항에 "규칙으로 만들기"를 고르면, Claude는 먼저 lint 설정이나 테스트에 그 문제를 잡았어야 할 기존 규칙이 있는지 찾습니다. 그다음 통하는 형태 중 첫 번째를 고릅니다. 순서는 기존 lint 규칙 켜기, 이미 쓰는 linter용 커스텀 규칙 작성, 테스트 작성입니다. 초안은 지적 사항이 가리키는 파일에는 절대 넣지 않습니다.

그다음 review-loop가 초안을 증명합니다. 수정 전 코드를 임시 폴더에 쓰고, 초안이 있을 때와 없을 때 각각 검사를 실행합니다.

| 결과 | 의미 |
|---|---|
| `caught` | 초안이 있을 때만 검사가 실패합니다. 규칙이 실수를 잡아냅니다. |
| `missed` | 초안이 있어도 모든 검사가 통과합니다. Claude가 초안을 한 번 고칩니다. |
| `unproven` | 검사가 시간을 초과했거나, 초안이 없어도 실패합니다. 어느 쪽인지 Claude가 알려 줍니다. |

규칙에는 그 규칙을 실행할 검사가 필요합니다. `typecheck`, `lint`, `test` 스크립트가 하나도 없으면, 선택은 "이번만 수정하기"로 기록되고 Claude가 그 이유를 알려 줍니다. 증명된 초안은 수정과 같은 커밋에 들어가고, 커밋 메시지에서 그 초안을 밝힙니다.

프로젝트에 test 스크립트가 있으면, Claude가 수정하는 P1과 P2에는 묻지 않고 같은 방식으로 회귀 테스트를 붙입니다. 회귀 테스트는 test 검사만 증거로 인정합니다. 테스트를 넣었을 때 lint만 실패한다면, 그 테스트는 버그를 잡지 못한 것입니다. 테스트 없이 한 수정은 보고서에 그 이유를 적습니다.

### 커밋 게이트

커밋 게이트는 hook입니다. 이 hook은 사용자가 저장소에서 켜기 전까지 꺼져 있습니다. 리뷰가 끝나면 Claude가 이 hook을 켤지 한 번 묻습니다. 게이트가 켜져 있으면, Claude가 실행하는 모든 `git commit`을 게이트가 먼저 검사합니다.

<details>
<summary>게이트가 하는 일</summary>

| 상황 | 게이트의 동작 |
|---|---|
| 리뷰가 없음, 또는 리뷰가 다루지 않은 파일이 변경됨 | 커밋을 차단하고, Claude에게 리뷰를 실행하라고 알림 |
| 리뷰 루프가 진행 중임, 또는 아직 남은 결정이 있음 | 커밋을 차단 |
| 리뷰를 통과함 | 커밋 전에 사용자에게 물음. 사용자가 이 저장소에서 커밋을 위임했다면 커밋을 허용 |
| 리뷰 후에 리뷰한 파일이나 `loop rule`이 확인한 규칙 초안과 회귀 테스트만 변경됨 | 사용자에게 물음 |
| `git push`, force push | 커밋을 위임했더라도 항상 물음 |
| `--no-verify`를 쓴 커밋 | 커밋을 위임했더라도 물음. 리뷰를 통과하지 않은 커밋은 계속 차단 |
| 게이트가 읽을 수 없는 폴더에서 하는 커밋(예: `cd "$(...)"`, 존재하지 않는 경로) | Claude Code를 시작한 저장소에서 게이트가 켜져 있으면, 커밋을 위임했더라도 물음 |

리뷰 없이 한 번만 커밋하려면, 이번에는 리뷰를 건너뛰라고 Claude에게 요청합니다. 게이트 설정과 커밋 위임은 연결된 worktree를 포함해 저장소 전체에 적용됩니다. 리뷰는 worktree마다 따로 합니다.

</details>

### 설정

처음 세 설정은 저장소 하나에 적용됩니다. 설정을 바꾸려면 `/review-loop:review-loop` 뒤에 요청을 입력합니다. 그래야 Claude가 스킬의 명령을 불러온 상태에서 처리합니다. 검사 제한 시간은 환경 변수라서 설정한 곳 어디에나 적용되고, 전체 9분은 고정입니다.

| 설정 | 기본값 | 입력 |
|---|---|---|
| 수정 전 확인 | 꺼짐 | "모든 P2는 나에게 먼저 확인받아 줘" 또는 "모든 P1과 P2는 나에게 먼저 확인받아 줘" |
| 커밋 게이트 | 첫 리뷰가 끝날 때 한 번 물음 | "커밋 게이트를 켜 줘(또는 꺼 줘)" |
| 커밋 위임 | 커밋할 때마다 물음 | "이 저장소에서는 커밋 전에 더 묻지 마" |
| 검사 제한 시간 | 검사 하나에 5분, 전체 9분 | 검사 하나의 제한 시간을 바꾸려면 `LIM_CHECK_TIMEOUT_MS`를 설정 |

## 측정 결과

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv)에는 6개 축(do, tell, ask, silence, stop, evidence)에 걸친 129개 동작이 있습니다. CI의 단위 테스트가 그중 120개를 다룹니다. 이 테스트에는 실제 임시 git 저장소에서 실행하는 테스트와 커밋 게이트 hook 테스트도 있습니다. 나머지 9개는 모델 실행이 필요하므로, `claude plugin eval`로 측정할 계획입니다. 그 9개는 P3부터 P5까지를 한 번만 묻기, 질문보다 보고서를 먼저 보여 주기, 모든 단계를 할 일 목록에 남기고 건너뛴 단계에 이유 적기, 수정한 P1과 P2마다 회귀 테스트 작성하기, 지적 사항마다 measured, inferred, guessed 표시하기, 수정을 어떻게 확인했는지 말하기, 사용자가 반박하면 동의하기 전에 다시 확인하기, 같은 종류로 되풀이되는 지적 사항에 규칙 만들기 권하기, 원인을 모른 채 추가한 코드를 보고하기입니다. 마지막 동작의 fixture는 [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/)에 있습니다.

<details>
<summary>비용</summary>

`claude plugin details`가 추정한 review-loop의 비용은 다음과 같습니다.

| 구성 요소 | 항상 켜짐, 모든 세션 | 실행할 때마다 |
|---|---|---|
| review-loop 스킬 | 약 140 토큰 | 약 4,600 토큰 |
| 리뷰어 에이전트 | 약 70 토큰 | 약 1,700 토큰, 여기에 diff와 리뷰어가 읽는 코드가 더해짐 |

스킬 비용은 실행마다 한 번 듭니다. 리뷰어 비용은 라운드마다 한 번 들고, 루프는 최대 3라운드까지 진행합니다. 검사는 사용자의 컴퓨터에서 실행되므로 토큰이 들지 않습니다.

</details>

review-loop는 LIM 자체의 pull request를 리뷰합니다. [#8](https://github.com/lee-eojin/lim/pull/8)은 review-loop 첫 버전에서 실행한 루프 두 번을 보여 줍니다. 그중 한 번은 review-loop 자체의 테스트 약화 검사가 낸 오탐 때문에 멈췄고, 그 오탐은 이후에 수정되었습니다. [#46](https://github.com/lee-eojin/lim/pull/46) 같은 최근 pull request에서는 review-loop 보고서와 지적 사항별 결정을 볼 수 있습니다.

## 이렇게 동작하는 이유

<details>
<summary>왜 새 리뷰어인가요?</summary>

변경을 작성한 에이전트는 모든 줄이 왜 거기 있는지 압니다. 그래서 변경을 맞다고 읽습니다. diff와 한 줄짜리 의도만 받은 리뷰어는 그 이유를 코드에서 찾아야 합니다. 코드에 이유가 없다면, 그것이 바로 지적 사항입니다. 라운드마다 새 리뷰어가 시작하므로, 리뷰어가 자기가 앞서 내린 판정을 채점하는 일은 없습니다.

</details>

<details>
<summary>왜 스크립트가 멈출 시점을 정하나요?</summary>

모델에게 "다 됐나요?"라고 물으면 그렇다고 답하기 쉽습니다. review-loop의 스크립트는 대신 숫자를 셉니다. P1이나 P2가 남지 않았을 때, 3라운드가 끝났을 때, 두 번 수정해도 남는 지적 사항이 있을 때, 해결된 지적 사항이 다시 나타났을 때, P1 + P2가 더 줄지 않을 때, 수정이 테스트를 약하게 만들 때 멈춥니다. 해결되지 않은 지적 사항을 남긴 채 멈추는 것도 정상적인 결과이며, 이때 Claude는 그렇다고 말합니다.

</details>

<details>
<summary>왜 P1과 P2에는 근거가 필요한가요?</summary>

보고서에서는 자신 있는 주장과 증명된 주장이 똑같아 보입니다. P1이나 P2는 정확한 줄을 인용하고, 잘못된 결과를 내는 입력을 제시하고, 기존 장치가 그 문제를 막지 못하는 이유를 말해야 합니다. 셋 중 하나라도 없거나 리뷰어가 guessed로 표시하면, 미검증으로 보여 주고 Claude는 그 지적 사항 때문에 코드를 바꾸지 않습니다.

</details>

<details>
<summary>왜 커밋 게이트는 opt-in인가요?</summary>

커밋을 막는 hook은 일하는 방식을 바꿉니다. 그래서 저장소마다 사용자가 고를 수 있어야 합니다. 게이트가 없으면 "커밋 전에 묻기"는 Claude가 따르는 지시일 뿐입니다. 게이트가 있으면, Claude가 리뷰를 통과하지 않고 실행하는 `git commit`을 hook이 막습니다. 다만 hook이 모든 것을 보지는 못합니다. git alias처럼 놓치는 경우는 [제한 사항](#제한-사항)에 나와 있습니다.

</details>

<details>
<summary>왜 push는 절대 하지 않나요?</summary>

커밋은 로컬에 남고 되돌리기 쉽습니다. push는 그렇지 않습니다. review-loop는 커밋에서 멈추고, 커밋을 위임했더라도 게이트는 push할 때마다 묻습니다.

</details>

## 데이터

상태, diff, 검사 로그, 결정 기록(decision ledger)은 저장소 안의 `.git/lim/review-loop/`에 저장됩니다. review-loop는 작업 트리에 아무것도 쓰지 않습니다. 규칙을 확인할 때 review-loop는 수정 전 코드를 저장소 밖의 임시 폴더에 쓰고, 확인이 끝나면 삭제합니다. 초기화하려면 `.git/lim/review-loop/`를 삭제합니다.

review-loop는 자체적으로 네트워크 요청을 보내지 않습니다. Claude와 리뷰어는 diff, 지적 사항, 검사 출력을 세션의 다른 파일과 같은 방식으로 읽습니다. 그래서 이 내용은 Claude Code 세션의 나머지 내용과 같은 방식으로 모델 제공자에게 전달됩니다.

## 제한 사항

- 검사는 `package.json` 스크립트에서만 감지합니다.
- 검사 하나는 최대 5분, 모든 검사는 합쳐서 최대 9분까지 실행합니다.
- 커밋 게이트가 꺼져 있으면, 커밋 전에 묻는 동작은 Claude에게 주는 지시일 뿐입니다. 이 동작은 보장되지 않습니다.
- 커밋 게이트는 Claude가 Bash 도구로 실행하는 명령만 검사합니다. 사용자가 자신의 터미널에서 직접 입력한 커밋은 검사하지 않습니다. `git ci` 같은 git alias도 인식하지 않습니다.
- 저장소가 아닌 폴더에서 Claude Code를 시작하면, 게이트는 어느 저장소인지 알 수 없는 커밋을 검사하지 못합니다. 예: `cd "$(...)"` 뒤의 커밋.
- 리뷰 범위는 `git add -A`가 포함할 모든 변경입니다. 사용자가 직접 골라서 stage한 변경만 리뷰하지는 않습니다.
- 규칙과 회귀 테스트는 임시 복사본에서 확인합니다. 이 복사본에는 추적 중인(tracked) 파일과, 최상위 `node_modules`로 연결되는 링크가 들어 있습니다. `.env`나 중첩된 `node_modules` 같은 그 밖의 무시된(ignored) 파일은 없습니다. 그래서 그런 파일이 필요한 검사는 규칙이나 테스트를 증명하지 못했다고 보고하거나, 잘못된 이유로 잡았다고 보고합니다. 어느 쪽인지는 Claude가 실패 내용을 읽고 판단합니다.

## FAQ

**review-loop는 자동으로 시작되나요?**
항상 시작되지는 않습니다. Claude는 스킬 설명이 대화에 맞는다고 판단할 때만 그 스킬을 시작합니다. 사용자가 Claude에게 리뷰나 커밋을 요청하면 Claude가 review-loop를 시작할 수 있지만, 시작한다는 보장은 없습니다. `/review-loop:review-loop` 명령은 항상 review-loop를 시작합니다. 사용자가 커밋 게이트를 켜면, 리뷰 없는 커밋은 차단됩니다. 이때 Claude는 review-loop를 먼저 실행하라는 안내를 받습니다.

**push나 merge를 하나요?**
절대 하지 않습니다. 사용자가 "이 저장소에서는 더 묻지 않기"를 선택하지 않았다면, 모든 커밋 전에 묻습니다. 이 설정을 다시 끄려면, Claude에게 review-loop의 커밋 위임을 끄라고 요청합니다.

**다른 플러그인과 충돌하나요?**
review-loop는 스킬 하나, 에이전트 하나, hook 하나를 추가합니다. 이 hook은 Bash 명령을 읽고, `git commit`과 `git push`에만 반응합니다. 사용자가 그 저장소에서 커밋 게이트를 켜지 않았다면, 이 hook은 아무 일도 하지 않습니다. 이름이 모두 `review-loop:`로 시작하므로, 다른 플러그인의 이름과 겹치지 않습니다. 사용자가 일반 문장으로 요청하면, Claude가 다른 리뷰 스킬을 고를 수 있습니다. 명령을 쓰면 항상 review-loop가 시작됩니다.

**루프 도중에 세션이 끝나면 어떻게 되나요?**
명령을 다시 실행합니다. 명령은 멈춘 라운드와 단계에서 이어서 진행할지, 처음부터 다시 시작할지 선택지를 제시합니다.

**어떻게 제거하나요?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

그다음 review-loop를 실행한 각 저장소에서 `.git/lim/review-loop/`를 삭제합니다.

## 내 것으로 만들기

review-loop는 이미 있는 검사를 그대로 씁니다. `typecheck`, `lint`, `test` 스크립트가 좋을수록, 리뷰에서 읽고 판단하는 부분은 줄고 측정하는 부분은 늘어납니다.

- 무엇이든 바뀌기 전에 심각한 지적 사항을 먼저 보고 싶다면, 모든 P2 또는 모든 P1과 P2를 먼저 확인받으라고 Claude에게 요청합니다.
- 믿을 수 있는 저장소에서 커밋을 매번 승인하기가 번거롭다면, 그 저장소에서는 커밋을 위임합니다. 커밋 게이트가 켜져 있으면 push는 그래도 묻습니다.
- 같은 코멘트를 계속 받는다면, "규칙으로 만들기"를 고릅니다. 다음 리뷰는 그 실수를 사용자의 linter나 테스트가 이미 잡아내는 상태에서 시작합니다.
- 다른 흐름을 원한다면, 플러그인을 fork합니다. 스킬은 250줄 미만의 `SKILL.md` 하나이고, 루프 로직은 스크립트 하나(`plugins/review-loop/skills/review-loop/scripts/loop.mjs`)에 있습니다.

## LIM을 만드는 방식

- **이슈 먼저.** 모든 변경은 이슈에서 시작합니다. 변경은 pull request로 들어가고, 메인테이너가 그 pull request를 squash merge합니다.
- **스스로 리뷰.** 모든 pull request는 자기 diff에 review-loop를 실행합니다. pull request 설명에는 보고서와 지적 사항별 결정이 들어갑니다.
- **플러그인별 버전.** 각 플러그인은 Semantic Versioning을 따르고, 자체 `CHANGELOG.md`를 유지하며, `<plugin>--v<version>` 형식으로 태그를 붙입니다. minor 릴리스와 major 릴리스에는 GitHub Release를 만듭니다.
- **의도적으로 작게.** 플러그인 하나는 진입 스킬 하나, 250줄 미만의 `SKILL.md`, opt-in hook만 가집니다.

## 로드맵

- 단위 테스트로 다룰 수 없는 동작을 위한 `claude plugin eval` 기반 모델 수준 eval, 그리고 리뷰 품질과 비용의 블라인드 비교
- 변경을 작성한 모델과 다른 모델에서 실행하는 리뷰어
- 결정을 하나하나 기록해 두고 사용자가 나중에 검토하는 무인 모드
- 바로 복사해 쓸 수 있는 프롬프트, 실제 출력, 비용을 담은 짧은 가이드

## 기여하기

이슈와 pull request를 환영합니다. 시작하기 전에 [CONTRIBUTING.md](../../CONTRIBUTING.md)를 읽습니다.

## 라이선스

MIT 라이선스입니다. 자세한 내용은 [LICENSE](../../LICENSE)에 있습니다.
