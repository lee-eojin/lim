# Korean rules

Read this when the explanation is in Korean. The rules are in English; the Korean words and sentences are examples. The base is ASD-STE100 principles, the National Institute of Korean Language guidance on plain public language, and the Ministry of Government Legislation guideline for plain legal text (see `sources.md`). The patterns that `scripts/check-clarity.mjs` matches are in `data/vague-words-ko.txt`.

## 1. Sentences

| Rule | Example |
|---|---|
| One piece of information per sentence (one or two verbs). Split a descriptive sentence over about 100 characters with spaces. The number is an estimate from STE's 25 words; Korean sources give no number | Split at each new verb |
| Name the subject, always when the actor changes | 다시 실행된다 -> React가 컴포넌트 함수를 다시 호출한다 |
| No double passive | 결정되어진다 -> 결정된다, 보여진다 -> 보인다 |
| Condition first | dependency array가 비어 있으면, React는 Effect를 마운트 직후에 한 번만 실행한다 |
| At most two 의 in a row (STE's three-noun limit) | 사용자의 주문의 결제의 상태 -> 사용자가 주문한 결제의 상태 |
| ~할 수 있다 carries one meaning: ability, possibility, or permission | 설정 파일을 바꾸면 기존 설정이 영향을 받을 수 있다 -> 설정 파일을 바꾸면 기존 설정이 삭제된다 |
| One negation | ~하지 않으면 안 된다 -> ~해야 한다 |
| One relative clause layer; say how far a modifier reaches | Split two stacked 관형절 into two sentences |
| One register per answer | Do not mix 합니다 and 해요 endings |

## 2. Broad verbs

| Vague | Why | Write instead |
|---|---|---|
| 처리하다 | could mean save, convert, validate, ignore, retry, or show | 에러를 처리한다 -> 에러를 잡아서 기본값을 반환한다 |
| 관리하다 | mixes create, store, update, release | 토큰을 관리한다 -> 토큰을 발급하고 만료되면 갱신한다 |
| 진행하다, 수행하다, 실시하다 | filler after a noun; the action is hidden | 배포를 진행한다 -> 배포한다 |
| 반영하다 | code change, merge, deploy, or screen update? | 리뷰를 반영했다 -> 리뷰에서 지적한 변수명 3개를 고쳤다 |
| 확인하다 | what, where, and what result? | 로그를 확인하세요 -> 서버의 `/var/log/app/error.log`를 열어 보세요 |
| 지원하다 | has the feature, is compatible, or can be used? | SSR을 지원한다 -> Next.js 13 이상에서 SSR로 렌더링할 수 있다 |
| 제공하다 | no direction (input or output) | 함수가 값을 제공한다 -> 반환한다 |
| 활용하다, 이용하다 | same as 사용하다; mixing them reads as different actions | use 사용하다 throughout |
| 연동하다 | which side calls what? | 주문 페이지가 결제 API를 호출해서 결과를 받는다 |
| 개선하다, 최적화하다 | how much, on which measure? | 첫 화면 로딩 시간을 2.1초에서 0.8초로 줄였다 |
| 안 된다 | how does it fail? | 버튼을 눌러도 요청이 가지 않는다 |

## 3. Developer jargon

| Jargon | Write instead |
|---|---|
| (API를) 쏘다, 찌르다, 때리다, 날리다 | 요청을 보낸다, API를 호출한다 |
| (데이터를) 태우다 | 넘긴다, 인자로 전달한다 |
| (값을) 꽂다, 박다 | 넣는다, 설정한다, 코드에 직접 적는다 |
| (서버를) 올리다, 띄우다 / 내리다 | 실행한다, 배포한다 / 멈춘다 |
| (스타일이) 먹히다 | 적용된다 |
| (상태가) 꼬이다 | say what differs: 화면의 수량과 state의 수량이 다르다 |
| (앱이) 터지다, 죽다 | say what stopped: 예외가 나서 화면이 비었다 |

에러를 던진다 is fine, because it pairs with `throw`.

## 4. Degree, scope, and pointing words

| Vague | Write instead |
|---|---|
| 적절히, 적당히, 어느 정도, 많이, 빠르게 | a criterion or a number: 300ms마다, 10,000건을 넘으면 |
| 자주, 가끔, 최근 | 렌더링할 때마다, v18부터 |
| 해당 (해당 함수) | the noun: 이 함수, `fetchUser` 함수 |
| 이것, 그것, 이는 | fine with one candidate; with two, repeat the noun |
| 관련 (관련 코드) | what it does: 로그인 요청을 보내는 코드 |
| 등 | a closed list names every item (A와 B 두 가지); an open list says so (A와 B를 포함한 여러 가지) |
| 및, 또는 | A와 B 모두 / A나 B 중 하나 / A나 B 또는 둘 다 |
| 내지 | 또는, or a range: ~부터 ~까지 |

Vague words are not banned. Replace them where the reader has to judge or act by them.

## 5. Words with several meanings

| Word | Meanings mixed | How to write |
|---|---|---|
| 속성 | HTML attribute, DOM property, CSS property | write attribute or property |
| 인자 | parameter, argument | 매개변수 (parameter) in a definition, 인자 (argument) for a value passed in a call |
| 렌더링 | React render, commit, browser paint, server HTML (SSR) | name the phase |
| 인증 | authentication, authorization | write the English term |
| 업데이트 | change a value, re-render, raise a version, install | state를 바꾼다 / 다시 렌더링된다 / 18.3으로 올린다 |
| 초기화 | initialize (first value), reset (back to the first value) | 첫 값을 넣는다 / 첫 값으로 되돌린다 |
| 동기화 | synchronization, synchronous | `useEffect`의 동기화 means keeping in step |
| 저장 | state, `localStorage`, server database | say where |
| 이슈, 로직 | bug or request; formula, rule, or branch | say which |

## 6. Filler and hedges

| Phrase | Problem | Write instead |
|---|---|---|
| 효율적, 안정적, 유연하다, 직관적, 깔끔하다 | no measure | the criterion and the result |
| 기본적으로, 일반적으로, 사실상 | usually removable | remove, or name the exception |
| 간단히, 그냥, 당연히, 쉽게 말해 | no information; talks down | remove |
| ~같은 경우, ~의 경우 | long (not an error) | ~는, ~면: 빈 배열의 경우 -> 빈 배열이면 |
| ~라고 할 수 있다 | turns the claim around once more | ~이다 |
| ~것 같다, ~일 수도 있을 것 같습니다 | certainty is hidden, hedges stack | state it, or mark it as an inference with a reason |
| 앞서 설명했듯이, 아시겠지만 | talk about the talk | remove |

## 7. Stiff phrases

Strong means the National Institute of Korean Language or the Ministry of Government Legislation guidance supports the change. Weak means the support is mixed; change it only when the sentence gets long.

| Phrase | Alternative | Support |
|---|---|---|
| ~에 있어서 | ~에서, ~할 때 | strong |
| ~에 의해 ~되다 | the actor as subject; ~으로 for a means | strong |
| 진행, 수행, 실시 + noun | the noun as a verb: 설정 진행 -> 설정한다 | strong |
| 필요로 하다, 요하다 | ~이 필요하다 | strong |
| ~를 가지고 있다 | ~가 있다: 권한을 가지고 있지 않다 -> 권한이 없다 | strong |
| ~로부터 | ~에게서, ~에서 | strong |
| ~에 대해(서) | an object particle: 요금에 대해 신경 쓰다 -> 요금을 신경 쓰다 | medium |
| ~를 통해(서) | ~로: 이 API를 통해 -> 이 API로 | weak |
| ~로 인해, ~함에 따라 | ~ 때문에, ~해서 | weak; not a translation error |

## 8. Hard Sino-Korean words

From the public plain-language word lists. Choose the plain word in explanations.

| Hard | Plain |
|---|---|
| 기재하다 | 적다 |
| 용이하다 | 쉽다 |
| 상이하다 | 서로 다르다 |
| 부합하다 | 맞다 |
| 간주하다 | (~로) 보다 |
| 도출하다 | 이끌어 내다 |
| 초래하다 | 일으키다 |
| 소요되다 | 걸리다, 들다 |
| 향후 | 앞으로 |
| 상기 | 위에 적은 |
| 제반 | 모든, 여러 |

Everyday loanwords become Korean words: 케이스 -> 경우, 플로우 -> 흐름, 세팅 -> 설정, 핸들링 -> what is done. Developer terms are not loanwords in this sense; they follow `dev-terms.md`.

## 9. Technical terms in Korean

- Named concepts stay in English: Error Boundary, not 에러 경계 (translation) or 에러 바운더리 (transliteration). The English name is the one the reader can search.
- Basic terms settled in Korean stay Korean: 컴포넌트, 렌더링, 함수, 변수, 에러, 이벤트 핸들러, 콜백, 비동기, 캐시, 데이터베이스, 테이블, 쿼리, 커밋.
- Design principle terms stay Korean, with the abbreviation on first use: 의존성 주입(DI), 결합도, 응집도, 무상태.
- Database and analytics terms: English, with the common Korean term in parentheses on first use only, when it is not a transliteration: primary key(기본키), denormalization(반정규화), churn rate(이탈률). index(인덱스) needs no gloss.
- Do not pluralize an English term in a Korean sentence: Hook, not Hooks (props is the real name).

Particles after an English term follow how the term is read aloud. After a final consonant, use 은, 을, 이, 으로; otherwise 는, 를, 가, 로 (after ㄹ, 로).

| Term | Read as | Particles |
|---|---|---|
| Effect | 이펙트 | Effect는, Effect를 |
| Hook | 훅 | Hook은, Hook을 |
| state | 스테이트 | state는, state를 |
| props | 프롭스 | props는 |
| ref | 레프 | ref는 |
| closure | 클로저 | closure는 |
| event loop | 이벤트 루프 | event loop는 |
| DOM | 돔 | DOM은, DOM을 |
| URL | 유알엘 | URL은, URL로 |
| SQL | 에스큐엘 | SQL은, SQL로 |
| index | 인덱스 | index는 |
| transaction | 트랜잭션 | transaction은 |
| lock | 락 | lock은, lock을 |

## 10. Over-correction

These are clearer choices, not corrections. A passive verb (~로 확인됩니다), 경우, and ~로 인해 are grammatical; the National Institute of Korean Language says so in its public answers. When you point at a user's text, say "이렇게 쓰면 더 분명하다", not "틀렸다". Do not replace developer terms with old Korean coinages.

## 11. Example

Question: let도 hoisting돼? 그런데 왜 선언 전에 쓰면 에러가 나?

A common answer:

> let도 기본적으로 호이스팅이 되긴 하는데요, TDZ라는 것 때문에 선언 전에 접근하게 되면 에러가 발생하게 되어집니다. 그래서 var와는 다르게 동작한다고 할 수 있습니다.

A clear answer:

> 네, `let` 선언도 hoisting됩니다. 다만 JavaScript 엔진은 선언문에 도달하기 전까지 그 변수를 초기화하지 않아서, 그 사이에 읽으면 `ReferenceError`를 던집니다.
>
> hoisting은 선언이 scope 맨 위로 올라간 것처럼 보이는 현상을 부르는 이름입니다. TDZ(temporal dead zone)는 scope가 시작된 지점부터 `let` 선언문까지, 변수를 읽을 수 없는 구간입니다.
>
> | 선언 | 선언 전에 읽으면 |
> |---|---|
> | `var x` | `undefined` |
> | `let x`, `const x` | `ReferenceError` |

What changed: the answer comes first. 호이스팅 became hoisting, and TDZ is defined on first use. The subject (JavaScript 엔진) is named. 되어집니다 (double passive), 기본적으로, and ~라고 할 수 있습니다 are gone. The difference from `var` is a table.
