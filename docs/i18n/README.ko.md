# LIM

**Less is more.** 작은 Claude Code 플러그인 모음입니다. 각 플러그인은 한 가지 일만 하고, 그 근거가 되는 측정 결과를 함께 보여 줍니다.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

> 이 문서는 2026-10-19 시점의 [영어 README](../../README.md)를 번역한 문서입니다. 두 문서의 내용이 다르면 영어 README가 맞습니다.

[English](../../README.md) | 한국어 | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | [Bahasa Indonesia](README.id.md)

## LIM을 만든 이유

큰 에이전트 하네스는 모든 세션에 많은 지시문을 불러오고, 많은 명령에서 hook을 실행합니다. LIM은 각 플러그인을 작게 유지합니다. 각 플러그인은 선택해서 설치하고, 측정 결과를 함께 제공합니다.

- **플러그인 하나에 일 하나.** 필요한 플러그인만 설치합니다. `claude plugin details`의 보고에 따르면, review-loop가 세션에 추가하는 양은 약 188 토큰입니다.
- **의견보다 검사가 먼저.** 모델 리뷰보다 먼저 프로젝트의 테스트, 타입 검사, lint를 실행합니다.
- **hook은 opt-in 방식.** 사용자가 켜지 않으면, 어떤 기능도 프롬프트나 명령을 감시하지 않습니다.
- **설치 전에 확인.** 플러그인에 필요한 것이 있으면 먼저 설명합니다. 설명 항목은 그것이 무엇인지, 무엇을 개선하는지, 어디에 저장되는지, 어떻게 제거하는지입니다.
- **숫자 공개.** 모든 플러그인은 무엇을 측정했는지와 그 측정이 다루지 않는 범위를 함께 제공합니다.

## 플러그인

| 플러그인 | 상태 | 하는 일 |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.1.1 | 커밋 전에 변경 사항을 리뷰하고, P1과 P2 지적 사항을 수정하고, 다시 리뷰한 뒤, 나머지를 사용자에게 넘깁니다. |
| forge | 계획됨 | 리뷰어의 pull request 코멘트를 리뷰어 스킬로 바꾸고, 그 스킬의 충실도 보고서를 함께 제공합니다. |

## 빠른 시작

Claude Code, git, Node.js 18 이상이 필요합니다.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Claude Code가 재시작을 요청하면 재시작합니다. 그다음, 커밋하지 않은 변경 사항이 있는 git 저장소에서 다음 명령을 실행합니다.

```
/review-loop:review-loop
```

marketplace를 추가하면 카탈로그만 등록됩니다. 각 플러그인은 따로 설치하므로, 사용자가 고른 플러그인만 설치됩니다.

## review-loop

커밋하기 전에 review-loop는 짧은 루프를 실행하고, 스스로 멈춥니다.

1. **검사.** `package.json`의 `typecheck`, `lint`, `test` 스크립트를 실행합니다. 검사가 실패하거나 `package.json`이 올바른 JSON이 아니면, 그 결과는 P1 지적 사항이 됩니다. 검사가 제한 시간을 넘기면, 실패 대신 "검증되지 않음"(not verified)으로 보고합니다.
2. **새 리뷰.** 별도의 리뷰어 에이전트가 diff와, 사용자가 원한 내용을 요약한 한 줄을 받습니다. 리뷰어는 이 변경에 대한 Claude의 추론을 받지 않습니다. 리뷰어는 맥락을 파악하기 위해 주변 코드를 읽을 수 있습니다. 리뷰어는 지적 사항에 P1부터 P5까지 등급을 붙입니다. P1과 P2에는 근거가 필요합니다. 근거는 정확한 줄, 실패 시나리오, 기존 장치가 그 실패를 막지 못하는 이유입니다. 근거가 없는 지적 사항은 미검증 상태로 사용자에게 보여 줍니다.
3. **수정.** Claude가 무엇을 수정할지 먼저 말하고, 그다음 P1과 P2를 수정합니다. 수정에 설계 선택이 필요하면(수정 방법이 둘 이상, 사용자에게 보이는 동작 변경, 기능 제거, 테스트 변경) 사용자가 먼저 선택합니다.
4. **재리뷰.** 새 리뷰어가 수정한 부분과 아직 해결되지 않은 지적 사항만 확인합니다. 최대 3라운드까지 진행합니다.
5. **중단.** 멈출 시점은 모델 대신 스크립트가 결정합니다. 스크립트는 다음 중 하나에 해당하면 멈춥니다: P1이나 P2가 남지 않음, 라운드 한도에 도달함, 두 번 수정해도 남는 지적 사항이 있음, 해결된 지적 사항이 다시 나타남, P1 + P2 개수가 더 줄지 않음, 수정이 테스트나 검사를 약하게 만듦.
6. **결정.** 나머지 지적 사항은 사용자가 한 번만 결정합니다. 대상은 P3부터 P5까지 전부와, 아직 해결되지 않았거나 검증하지 못한 P1과 P2입니다. 사용자는 지적 사항마다 그대로 두기, 이번만 수정하기, 규칙으로 만들기 중 하나를 고릅니다.
7. **커밋.** 사용자가 "이 저장소에서는 더 묻지 않기"를 선택하지 않았다면, Claude는 커밋 전에 묻습니다. push는 절대 하지 않습니다.

모든 라운드는 보고서로 끝납니다.

```
Review round 2 of 3
Checks: test passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

### 심각도

뱅크샐러드가 공개한 Pn 규칙을 기반으로 합니다.

| 등급 | 의미 | 루프 동작 |
|---|---|---|
| P1 | 반드시 수정: 검사 실패, 데이터 손실, 보안 취약점, 크래시, 또는 요청한 기능이 동작하지 않음 | 근거가 있을 때만 수정 |
| P2 | 수정 권장: 특정 입력으로 재현되는 버그, 누락된 요구 사항, 프로젝트 규칙 위반 | 근거가 있을 때만 수정 |
| P3 | 수정할 가치 있음: 유지보수성, 오해를 부르는 이름, 중요도가 낮은 경로의 테스트 누락 | 사용자가 결정 |
| P4 | 선택: 사람마다 의견이 갈리는 구조 선호 | 사용자가 결정 |
| P5 | 사소함: 오타나 포맷 | 사용자가 결정 |

### 측정 결과

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv)에는 6개 축(do, tell, ask, silence, stop, evidence)에 걸친 35개 동작이 있습니다. CI의 단위 테스트가 그중 32개를 다룹니다. 이 테스트에는 실제 임시 git 저장소에서 실행하는 테스트도 있습니다. 나머지 3개는 모델 실행이 필요하므로, `claude plugin eval`로 측정할 계획입니다. 그 3개는 P3부터 P5까지를 한 번만 묻기, 커밋 전에 묻기, 질문보다 보고서를 먼저 보여 주기입니다.

review-loop는 LIM 자체의 pull request를 리뷰합니다. [#8](https://github.com/lee-eojin/lim/pull/8)은 review-loop 첫 버전에서 실행한 루프 두 번을 보여 줍니다. 그중 한 번은 review-loop 자체의 테스트 약화 검사가 낸 오탐 때문에 멈췄고, 그 오탐은 이후에 수정되었습니다.

### 데이터

상태, diff, 검사 로그, 결정 기록(decision ledger)은 저장소 안의 `.git/lim/review-loop/`에 저장됩니다. review-loop는 작업 트리에 아무것도 쓰지 않습니다. 초기화하려면 그 폴더를 삭제합니다.

review-loop는 자체적으로 네트워크 요청을 보내지 않습니다. Claude와 리뷰어는 diff, 지적 사항, 검사 출력을 세션의 다른 파일과 같은 방식으로 읽습니다. 그래서 이 내용은 Claude Code 세션의 나머지 내용과 같은 방식으로 모델 제공자에게 전달됩니다.

### 제한 사항

- 검사는 `package.json` 스크립트에서만 감지합니다.
- 검사 하나는 최대 5분, 모든 검사는 합쳐서 최대 9분까지 실행합니다. 검사 하나의 제한 시간을 바꾸려면 `LIM_CHECK_TIMEOUT_MS`를 설정합니다.
- 커밋 전에 묻는 동작은 Claude에게 주는 지시이며, hook으로 강제하지 않습니다. opt-in 커밋 게이트 hook을 계획하고 있습니다([#5](https://github.com/lee-eojin/lim/issues/5)).
- 리뷰 범위는 `git add -A`가 포함할 모든 변경입니다. 사용자가 직접 골라서 stage한 변경만 리뷰하지는 않습니다.

## FAQ

**review-loop는 자동으로 시작되나요?**
항상 시작되지는 않습니다. Claude는 스킬 설명이 대화에 맞는다고 판단할 때만 그 스킬을 시작합니다. 사용자가 Claude에게 리뷰나 커밋을 요청하면 Claude가 review-loop를 시작할 수 있지만, 시작한다는 보장은 없습니다. `/review-loop:review-loop` 명령은 항상 review-loop를 시작합니다. 계획 중인 커밋 게이트 hook([#5](https://github.com/lee-eojin/lim/issues/5))을 사용자가 켜면, 모든 커밋 전에 review-loop가 실행됩니다.

**push나 merge를 하나요?**
절대 하지 않습니다. 사용자가 "이 저장소에서는 더 묻지 않기"를 선택하지 않았다면, 모든 커밋 전에 묻습니다. 이 설정을 다시 끄려면, Claude에게 review-loop의 커밋 위임을 끄라고 요청합니다.

**다른 플러그인과 충돌하나요?**
review-loop는 스킬 하나와 에이전트 하나를 추가하고, hook은 추가하지 않습니다. 이름이 모두 `review-loop:`로 시작하므로, 다른 플러그인의 이름과 겹치지 않습니다. 사용자가 일반 문장으로 요청하면, Claude가 다른 리뷰 스킬을 고를 수 있습니다. 명령을 쓰면 항상 review-loop가 시작됩니다.

**루프 도중에 세션이 끝나면 어떻게 되나요?**
명령을 다시 실행합니다. 명령은 멈춘 라운드와 단계에서 이어서 진행할지, 처음부터 다시 시작할지 선택지를 제시합니다.

**어떻게 제거하나요?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

그다음 review-loop를 실행한 각 저장소에서 `.git/lim/review-loop/`를 삭제합니다.

## LIM을 만드는 방식

- **이슈 먼저.** 모든 변경은 이슈에서 시작합니다. 변경은 pull request로 들어가고, 메인테이너가 그 pull request를 squash merge합니다.
- **플러그인별 버전.** 각 플러그인은 Semantic Versioning을 따르고, 자체 `CHANGELOG.md`를 유지하며, `<plugin>--v<version>` 형식으로 태그를 붙입니다. minor 릴리스와 major 릴리스에는 GitHub Release를 만듭니다.
- **의도적으로 작게.** 플러그인 하나는 진입 스킬 하나, 250줄 미만의 `SKILL.md`, opt-in hook만 가집니다.

## 로드맵

- review-loop: opt-in 커밋 게이트 hook([#5](https://github.com/lee-eojin/lim/issues/5)), 수정 전에 모든 P2를 확인하는 옵션([#4](https://github.com/lee-eojin/lim/issues/4)), 더 강한 테스트 약화 검사([#6](https://github.com/lee-eojin/lim/issues/6)), 큰 저장소에서 더 빠른 스냅샷([#7](https://github.com/lee-eojin/lim/issues/7))
- forge: pull request 코멘트에서 추출한 리뷰어 스킬의 충실도 보고서
- 단위 테스트로 다룰 수 없는 동작을 위한, `claude plugin eval` 기반 모델 수준 eval

## 기여하기

이슈와 pull request를 환영합니다. 시작하기 전에 [CONTRIBUTING.md](../../CONTRIBUTING.md)를 읽습니다.

## 라이선스

MIT 라이선스입니다. 자세한 내용은 [LICENSE](../../LICENSE)에 있습니다.
