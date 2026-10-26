# LIM

**Less is more.** 小型 Claude Code 外掛。每個外掛只做一件事，並公開它背後的測量結果。

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

本文是截至 2026-10-24 的 [英文 README](../../README.md) 的翻譯。如果兩者內容不一致，以英文 README 為準。

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | 繁體中文 | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | [Bahasa Indonesia](README.id.md)

程式設計 agent 寫程式碼很快，但要察覺自己哪裡寫錯卻差得多。寫出變更的 agent 是這次變更最弱的審查者，因為它透過自己的推理來讀這次變更，總會認同自己。結果，程式碼要不是沒經過審查就被提交，就是只經過寫出它的同一個脈絡所做的審查。

**LIM 是我給出的答案：每個小外掛只做一件事，並附上支撐它的數字。** 第一個外掛是 review-loop。

**review-loop 讓「可以提交」真正代表「已經審查」。** 首先執行你自己的測試、型別檢查和 lint。接著，一個擁有全新脈絡、從不接觸 Claude 推理的審查者把發現項目標記為 P1 到 P5，而且必須為嚴重的發現項目提出證據。Claude 修正 P1 和 P2，一個新的審查者檢查這些修正，何時停止由腳本而不是模型決定。其餘的由你在最後一次決定。

**反覆提出的意見會變成規則。** 當你把某個發現項目標記為「設為規則」時，Claude 會起草一條 lint 規則或一個測試，review-loop 會在修正之前的程式碼上執行它，證明它能抓到這個錯誤。bug 修正也會以同樣的方式得到一個回歸測試。

**刻意保持小巧。** review-loop 為一個工作階段增加約 212 個 token。在你為某個儲存庫啟用它之前，它的 hook 不做任何事。安裝任何東西之前，都會先告訴你它是什麼、如何移除。

Fork 它、修改它，把它變成你自己的。歡迎提交 issue 和 pull request。

## 外掛

| 外掛 | 狀態 | 唯一職責 |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.9.0 | 在你提交之前審查你的變更，修正 P1 和 P2 發現項目，再次審查，然後把其餘發現項目交給你 |
| [clear-explain](../../plugins/clear-explain) | 0.1.0 | 解釋概念、程式碼和錯誤時先給出答案，一個詞只表示一個意思，技術術語使用官方英文名稱 |
| [verify](../../plugins/verify) | 0.3.0 | 透過實際執行來證明功能可用，並把指令和輸出保存為證據 |

## 安裝

你需要 Claude Code、git，以及 Node.js 18 或更新版本。

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

如果 Claude Code 要求重新啟動，請重新啟動它。新增 marketplace 只會註冊外掛清單。每個外掛分開安裝，所以你只會得到你選擇的外掛。

## 開始使用

只需要兩個步驟：

1. 依照上述方式安裝 review-loop。
2. 在一個有未提交變更的 git 儲存庫中輸入：

```
/review-loop:review-loop
```

就這樣。review-loop 會執行你的檢查、審查變更、修正必須修正的問題，並就其餘問題詢問你。最後，它會詢問一次是否為此儲存庫啟用提交關卡，然後詢問是否提交。

第一次使用？[指南](../../docs/guide/README.md)（英文）用真實輸出介紹第一次審查、如何決定、提交關卡、成本和常見陷阱。

## 用法

### 只要使用 `/review-loop:review-loop`

每當你準備提交時就輸入它。你可以在指令後面用一般的文字補充你的要求：

```
/review-loop:review-loop I changed the coupon math. Check it before I commit.
```

```
/review-loop:review-loop confirm every P2 with me before you fix anything.
```

當你請 Claude 審查或提交時，Claude 也可以自行啟動 review-loop，但只有在它判斷這個 skill 適用時才會這麼做。使用指令一定會啟動它。

### 一輪是什麼樣子

每一輪都以一份報告結束。Claude 會先顯示報告，再做其他任何事：

```
Review round 2 of 3 (reviewer: session model)
Checks: test (npm run test) passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal (fixed, inferred: the re-review read the fix)
  test: src/coupon.test.js (before the fix: caught, after: passed)

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

在這個例子中，第 1 輪發現了一個 P1。Claude 修正了它並撰寫了回歸測試，review-loop 證明該測試在修正之前的程式碼上失敗。第 2 輪確認了修正，於是迴圈停止。還剩一個 P3 交給你決定。

### 範例

<details>
<summary>所有提示詞</summary>

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
run unattended:         /review-loop:review-loop run unattended. I will read the summary in the morning.
reviewer model:         /review-loop:review-loop run the reviewer on sonnet in this repo.
```

</details>

## 審查如何進行

在你提交之前，review-loop 執行一個短迴圈，並自動停止。

1. **檢查。** review-loop 執行你的專案宣告的 `typecheck`、`lint` 和 `test` 檢查：`package.json` 中的腳本、Makefile 中的目標，或 Go（`go.mod`）、Rust（`Cargo.toml`）的預設指令、你設定的 Python 工具以及 Gradle 和 Maven。如果某個檢查失敗，或者 `package.json` 不是有效的 JSON，review-loop 會將其記為一個 P1 發現項目。如果某個檢查的執行時間超過時間限制，或者它的程式沒有安裝，review-loop 會將其回報為「未驗證」，而不是「失敗」。
2. **全新審查。** 一個獨立的審查者 agent 會收到 diff 和一行說明你想要達成什麼的摘要，但不會收到 Claude 對這次變更的推理。審查者可以讀取周圍的程式碼來了解脈絡。審查者把發現項目標記為 P1 到 P5。P1 和 P2 需要證據：確切的程式碼行、一個失敗情境，以及為什麼現有程式碼沒有防止該問題。每個發現項目都會標明 measured（實測）、inferred（推論）或 guessed（猜測）。沒有證據的 P1 或 P2，以及被標為 guessed 的 P1 或 P2，不會被修正，而是以「未驗證」的狀態顯示給你。
3. **修正。** Claude 先說明它要修正什麼，然後修正 P1 和 P2。如果某個修正需要設計決策（修正方式不只一種、使用者看得到的行為變化、移除功能、修改測試），由你先做選擇。如果你的專案有 test 腳本，Claude 會根據它修正的每個 P1 和 P2 的失敗情境撰寫回歸測試，review-loop 會證明該測試在修正之前的程式碼上失敗。
4. **再次審查。** 一個新的審查者只檢查本輪的修正和仍未解決的發現項目。最多 3 輪。
5. **停止。** 由腳本而不是模型決定何時停止。停止條件：沒有剩餘的 P1 或 P2、達到輪數上限、某個發現項目經過兩次修正後仍然存在、某個已解決的發現項目再次出現、P1 + P2 的數量不再減少，或者某個修正削弱了測試或檢查。
6. **決定。** 其餘發現項目由你一次決定：所有 P3 到 P5，以及仍未解決、無法驗證或針對已審查 diff 之外檔案的 P1 和 P2。對每一個項目，你可以選擇：維持原樣、僅本次修正，或者設為規則。你選擇維持原樣的發現項目，在被引用的那一行改變之前，後續審查不會再次詢問，而是由報告顯示其數量。如果此儲存庫之前的審查已經 3 次或更多次提出審查者關注的四類之一（例如臆測性防禦），Claude 會指出這一點，並建議在最強的適用層級設為規則：先是型別或架構變更，然後是 lint 規則，最後是測試。
7. **提交。** 如果你沒有選擇「在此儲存庫中不再詢問」，Claude 會在提交前詢問你。review-loop 從不執行 push。如果你啟用提交關卡，一個 hook 會把這一點變成強制規則。在審查通過之前，Claude 的提交會被阻擋。

當 Claude 說某個問題已修正時，它會說明自己是怎麼知道的：現在能通過的檢查屬於 measured，它閱讀新程式碼後的判斷屬於 inferred。當你對某個發現項目提出異議時，Claude 會先重新查證該主張再表示同意，並告訴你它查證了什麼。

### 審查者關注什麼

審查者尋找 bug、缺少的需求、被違反的專案規則，以及任何會讓這次變更無法達成你所說目標的問題。它不會質疑你想要的東西本身。它還會尋找 agent 在不了解問題原因時加入的四類程式碼，因為下一個 agent 會照抄它們：

<details>
<summary>四類程式碼</summary>

| 類別 | 是什麼 | 嚴重等級 |
|---|---|---|
| 臆測性防禦 | 針對沒有證據顯示會發生的狀態而加入的檢查、try/catch、後備方案或預設值 | 掩蓋失敗時為 P2，否則為 P3 |
| 歷史註解 | 描述誰要求了什麼、早期版本為什麼改變的註解，或者給 agent 的指示 | P4 |
| 權宜標記 | 沒有 issue 連結的 TODO、HACK、「temporary」或「for now」註解 | P3 |
| 第二種做法 | 為程式碼庫已經用另一種方式完成的工作而加入的輔助函式、模式或相依套件 | P3 |

防禦檢查應該放在合法狀態進入程式碼的地方：使用者輸入、網路或檔案讀取，或者 API 文件說明可能缺少的值。對已經處理過的狀態在更深處再檢查一次，仍然屬於臆測性防禦。[`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/) 中的 fixture 為每一類各包含一個例子，用來檢查審查者能否標記出它們。

</details>

### 嚴重等級

本規則以 Banksalad 公開的 Pn 規則為基礎。

| 等級 | 含義 | 迴圈中的處理 |
|---|---|---|
| P1 | 必須修正：檢查失敗、資料遺失、資安漏洞、當機，或者所要求的功能無法運作 | 僅在有證據時修正 |
| P2 | 應該修正：特定輸入可以重現的 bug、缺少的需求、被違反的專案規則 | 僅在有證據時修正 |
| P3 | 值得修正：可維護性、容易誤解的名稱、次要路徑上缺少測試 | 由你決定 |
| P4 | 可選：大家意見不一致的結構偏好 | 由你決定 |
| P5 | 瑣碎：錯字或格式問題 | 由你決定 |

針對該輪所審查 diff 中沒有的檔案的 P1 或 P2，不會在迴圈中修正。它會在最後交給你，標示為在已審查 diff 之外，並保留原有嚴重等級。

### 規則與回歸測試

審查者不得不反覆提出的意見，代表缺少一條規則。review-loop 會計數：每次審查都會把每個發現項目的類別記錄到一個由該儲存庫所有 worktree 共用的檔案中。如果之前的審查已經 3 次或更多次提出上述四類中的某一類，該類發現項目會被標記為重複。correctness 這類寬泛標籤會被記錄，但永遠不算作重複。當你為某個發現項目選擇「設為規則」時，Claude 會先在你的 lint 設定或測試中尋找本來應該抓到它的現有規則。然後，它選擇第一個可行的形式：啟用一條現有的 lint 規則、為你已在使用的 linter 撰寫自訂規則，或者撰寫一個測試。草稿絕不會寫進該發現項目所涉及的檔案。

接著，review-loop 會證明這份草稿。它把修正之前的程式碼寫入一個暫存資料夾，並在那裡分別在有草稿和沒有草稿的情況下執行你的檢查：

| 結果 | 含義 |
|---|---|
| `caught` | 只有加上草稿時檢查才會失敗。規則抓到了這個錯誤 |
| `missed` | 加上草稿後所有檢查仍然通過。Claude 會修改一次草稿 |
| `unproven` | 某個檢查逾時，或者沒有草稿時也會失敗。Claude 會告訴你是哪一種 |

規則需要一個會執行它的檢查。如果沒有 `typecheck`、`lint` 或 `test` 腳本，這個選擇會被記錄為「僅本次修正」，Claude 會告訴你原因。經過證明的草稿會和修正放進同一個提交，提交訊息中會寫明它。

如果你的專案有 test 腳本，Claude 修正的每個 P1 或 P2 都會以同樣的方式得到一個回歸測試，不需要詢問。對回歸測試來說，只有 test 檢查才算證明：如果加上它之後只有 lint 失敗，代表這個測試沒有抓到該 bug。沒有測試的修正會在報告中說明原因。

### 提交關卡

提交關卡是一個 hook。在你為某個儲存庫啟用它之前，它處於關閉狀態。在審查結束時，Claude 會詢問一次是否啟用它。啟用關卡後，Claude 執行的每個 `git commit` 都會先由關卡檢查。

<details>
<summary>關卡的行為</summary>

| 情況 | 關卡的行為 |
|---|---|
| 沒有審查，或者有審查未涵蓋的檔案發生了變更 | 阻擋提交，並要求 Claude 執行審查 |
| 審查迴圈正在進行，或者還有待定的決定 | 阻擋提交 |
| 審查已通過 | 提交前詢問你。如果你在此儲存庫中委派了提交，則允許提交 |
| 審查後只有已審查的檔案或經 `loop rule` 檢查的規則草稿和回歸測試發生了變更 | 詢問你 |
| `git push` 或強制推送（force push） | 即使你已委派提交，也一定詢問你 |
| 帶有 `--no-verify` 的提交 | 即使你已委派提交，也詢問你。未通過審查的提交仍會被阻擋 |
| 在關卡無法辨識的資料夾中提交（例如 `cd "$(...)"` 或不存在的路徑） | 如果啟動 Claude Code 的儲存庫開啟了關卡，即使你已委派提交，也詢問你 |

如果要不經審查提交一次，請要求 Claude 這次跳過審查。關卡設定和提交委派適用於整個儲存庫，包括它連結的 worktree。每個 worktree 有各自的審查。

</details>

### 設定

前五項設定只作用於一個儲存庫。要修改設定，請在 `/review-loop:review-loop` 後面輸入你的要求，這樣 Claude 會在載入該 skill 指令的狀態下處理。檢查時間限制是一個環境變數，因此在你設定它的任何地方都會生效，而合計 9 分鐘是固定的。

| 設定 | 預設值 | 輸入內容 |
|---|---|---|
| 修正前確認 | 關閉 | 「每個 P2 都先跟我確認」或「每個 P1 和 P2 都先跟我確認」 |
| 提交關卡 | 在第一次審查結束時詢問一次 | 「啟用（或停用）提交關卡」 |
| 提交委派 | 每次提交前詢問 | 「在此儲存庫中提交前不再詢問」 |
| 無人值守 | 關閉 | 單次執行輸入「無人值守執行」，或輸入「在此儲存庫中啟用（或停用）無人值守模式」。Claude 不提出任何問題，把需要你處理的事留到之後，最後總結它做了什麼以及哪些事在等你處理 |
| 審查者模型 | 工作階段的模型 | 「在此儲存庫中讓審查者用 sonnet 執行」（或 opus、haiku、fable），或「讓審查者用工作階段的模型執行」。各模型找出了什麼、花費多少，見測量結果 |
| 檢查時間限制 | 每個檢查 5 分鐘，合計 9 分鐘 | 設定 `LIM_CHECK_TIMEOUT_MS` 以修改單一檢查的時間限制 |

## 測量結果

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) 列出了六個面向上的 201 個行為。六個面向是：執行（do）、告知（tell）、詢問（ask）、靜默（silence）、停止（stop）和證據（evidence）。CI 中的單元測試涵蓋其中 190 個行為，包括在真實的暫存 git 儲存庫上執行的測試和針對提交關卡 hook 的測試。其餘 11 個行為需要實際執行模型：對 P3 到 P5 只詢問一次、在任何提問之前先顯示報告、把每個步驟都留在待辦清單中並為每個略過的步驟寫下原因、為每個修正的 P1 和 P2 撰寫回歸測試、為每個發現項目標明 measured、inferred 或 guessed、說明如何確認修正有效、在你提出異議時重新查證發現項目、為反覆出現的同類發現項目建議設為規則、在無人值守執行中不提出任何問題、用你選擇的模型啟動審查者、回報在原因不明時加入的程式碼。最後一個行為在 [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/) 中有一個 fixture，前兩個行為在 [`evals/review-loop/manual-behaviors.md`](../../evals/review-loop/manual-behaviors.md) 中有手動執行紀錄。

偵測基準測試給審查者一些變更，這些變更放在名稱看不出是測試的暫存儲存庫中。[`evals/review-loop/detection/`](../../evals/review-loop/detection/) 中有 12 個各植入一個 bug 的變更和 6 個乾淨的變更。[`evals/review-loop/detection-hard/`](../../evals/review-loop/detection-hard/) 中有 10 個更難的 bug，以及 6 個看起來可疑的乾淨變更。這些更難的 bug 包括：只有查看 diff 沒有改動的檔案才能發現的 bug、只有順著四個檔案追下去才能發現的 bug、藏在 183 行 diff 中的 bug、兩次搜尋之間的競態、在非同步寫入讀取之前就被清空的緩衝區，以及在錯誤路徑上沒有釋放的鎖。結果如下，每個案例執行 3 次，一般組於 2026-10-25 執行，困難組於 2026-10-26 執行：

| 審查者模型 | 一般組：以 P1 或 P2 找出的 bug | 一般組：對乾淨變更誤報的 P1 或 P2 | 困難組：以 P1 或 P2 找出的 bug | 困難組：對乾淨變更誤報的 P1 或 P2 | 困難組的費用（48 次執行） |
|---|---|---|---|---|---|
| claude-opus-5-5 | 36 個中 36 個 | 18 個中 0 個 | 30 個中 30 個 | 18 個中 0 個 | $3.11 |
| claude-sonnet-5-5 | 未執行 | 未執行 | 30 個中 29 個 | 18 個中 0 個 | $1.14 |
| claude-haiku-5-5 | 未執行 | 未執行 | 30 個中 30 個 | 18 個中 3 個 | $0.09（Claude Code 回報的數值） |

預設情況下，審查者使用你工作階段中的模型執行。Opus 在兩組案例中找出了所有植入的 bug，所以這個基準測試目前還無法顯示它找出的 bug 有所減少。為了看看這個基準測試到底能不能顯示出更差的 `reviewer.md`，Opus 還用一個刪減到只剩輸出格式的 `reviewer.md` 執行了困難組：它仍然找出了 30 個中 30 個，在 18 次乾淨執行中誤報了 1 個 P2，並提出了 83 個 P3 到 P5 的發現項目，而完整的審查者提出的是 55 個。對 Opus 來說，能否找出這些 bug 更多取決於模型而不是指令，更差的 `reviewer.md` 會表現為誤報和雜訊。Sonnet 漏掉的那一個，對在非同步寫入之前被清空的緩衝區沒有給出任何發現項目。Haiku 的 3 個誤報都出現在同一個乾淨案例上，這個案例在兩天內用完整審查者進行的 9 次 Opus 執行中也誤報了 1 個 P2。發現項目在改動過的行上指出植入的 bug 時才算數；對於只有在另一個檔案中才能發現的 bug，則要在那個檔案中標記的行上指出。第一批執行之後，有四個案例的審查者用評分不接受的措辭指出了植入的 bug，於是為這四個案例補充了關鍵字，並用它們重新為所有已儲存的執行評分。可以用 `node evals/review-loop/run-detection.mjs --runs 3` 再次執行，加上 `--cases evals/review-loop/detection-hard` 可執行困難組。

上表就是審查者預設模型的依據。在困難組中，Opus 找出了 30 個中 30 個，沒有誤報的 P1 或 P2；Sonnet 找出了 30 個中 29 個，也沒有誤報，費用約為 Opus 的 37%；Haiku 找出了 30 個中 30 個，在 18 次乾淨執行中誤報了 3 個 P1 或 P2。因此預設仍然是工作階段的模型，而當你希望審查者使用與撰寫變更的模型不同的模型時，Sonnet 是更便宜的選擇。

<details>
<summary>成本</summary>

`claude plugin details` 對 review-loop 成本的估算如下：

| 部分 | 一律載入（每個工作階段） | 每次執行 |
|---|---|---|
| review-loop skill | 約 140 個 token | 約 5,600 個 token |
| 審查者 agent | 約 70 個 token | 約 1,700 個 token，另加 diff 和它讀取的程式碼 |

skill 的成本在每次執行時支付一次。審查者的成本在每輪支付一次，一個迴圈最多執行 3 輪。審查者模型會改變這項成本，上方的基準測試表列出了每個模型的費用。你的檢查在你自己的電腦上執行，不消耗 token。

</details>

review-loop 審查 LIM 自己的 pull request。[#8](https://github.com/lee-eojin/lim/pull/8) 展示了 review-loop 第一個版本上執行的兩次迴圈。其中一次停止是由 review-loop 自己的測試削弱檢查中的誤判造成的，這個誤判之後已經修正。最近的 pull request（例如 [#46](https://github.com/lee-eojin/lim/pull/46)）展示了 review-loop 的報告以及對每個發現項目的決定。

## 為什麼這樣設計

<details>
<summary>為什麼要用全新的審查者？</summary>

寫出變更的 agent 知道每一行為什麼存在，所以它會把變更讀成正確的。只拿到 diff 和一行意圖的審查者，必須在程式碼中找到理由。如果程式碼裡找不到理由，那就是一個發現項目。每一輪都啟動一個新的審查者，所以審查者永遠不會替自己之前的結論打分數。

</details>

<details>
<summary>為什麼由腳本決定何時停止？</summary>

被問到「完成了嗎？」時，模型往往會回答「是」。review-loop 的腳本改為計數：沒有剩餘的 P1 或 P2 時、3 輪之後、某個發現項目經過兩次修正仍然存在時、已解決的發現項目再次出現時、P1 + P2 不再下降時，或者某個修正削弱了測試時，它就會停止。帶著未解決的發現項目停止是正常結果，Claude 會明確說明這一點。

</details>

<details>
<summary>為什麼 P1 和 P2 需要證據？</summary>

在報告裡，有自信的主張和經過證明的主張看起來一模一樣。P1 或 P2 必須引用確切的程式碼行，提出一個會產生錯誤結果的輸入，並說明為什麼現有程式碼沒有防止它。三者缺一，或者審查者把它標為 guessed 時，它會顯示為未驗證，Claude 不會為它修改程式碼。

</details>

<details>
<summary>為什麼提交關卡需要主動啟用？</summary>

阻擋提交的 hook 會改變你的工作方式，所以應該由你依儲存庫來選擇。沒有關卡時，「提交前詢問」是 Claude 遵循的一條指示。有了關卡，hook 會阻擋 Claude 在未通過審查時執行的 `git commit`。但它並不能看到一切。[限制](#限制)列出了它會漏掉的情況，例如你在自己的終端機中輸入的提交。

</details>

<details>
<summary>為什麼它從不 push？</summary>

提交留在本機，很容易復原。push 則不然。review-loop 停在提交這一步，即使你委派了提交，關卡也會在每次 push 前詢問你。

</details>

## 資料

狀態、diff、檢查日誌和決策紀錄存放在你的儲存庫內的 `.git/lim/review-loop/` 資料夾中。Claude 會把每次審查短暫寫入工作目錄中的 `.lim-review/`；git 透過 `.git/info/exclude` 忽略這個資料夾，review-loop 讀取後會刪除該檔案。為了檢查規則，review-loop 會把修正之前的程式碼寫入儲存庫之外的暫存資料夾，並在之後刪除它。如果要重設，請刪除 `.git/lim/review-loop/`。

review-loop 本身不會發出任何網路請求。Claude 和審查者讀取 diff、發現項目和檢查輸出的方式，與讀取你工作階段中其他檔案的方式相同。因此，這些內容會和你的 Claude Code 工作階段的其餘內容一樣傳送給模型供應商。

## 限制

- review-loop 依序從 `package.json` 的 scripts、Makefile 的目標、Go、Rust、已設定的 Python 工具（pytest、ruff、mypy）、Gradle 和 Maven 中偵測檢查，範圍是儲存庫根目錄和變更涉及的子資料夾專案（每輪最多 4 個）。
- 每個檢查最多執行 5 分鐘，所有檢查合計最多執行 9 分鐘。
- 如果沒有啟用提交關卡，提交前詢問只是給 Claude 的指示，而不是保證。
- 提交關卡只檢查 Claude 透過它的 Bash 工具執行的指令。你在自己的終端機中輸入的提交不會被檢查。透過 `git ci` 這類 git 別名進行的提交會像 `git commit` 一樣被檢查。會提交的 shell 別名（`!...`）會先詢問你，因為關卡看不到它的內部。用 `git -c alias.ci=commit` 在指令中臨時設定的別名不會被辨識。
- 如果你在不是儲存庫的資料夾中啟動 Claude Code，關卡無法檢查它辨識不出儲存庫的提交，例如 `cd "$(...)"` 之後的提交。
- review-loop 審查 `git add -A` 會包含的所有內容，而不是你手動挑選的一組已暫存變更。
- 規則和回歸測試在一個暫存副本中檢查。該副本包含你已追蹤的檔案，以及一個指向根目錄 `node_modules` 的連結。其他被忽略的檔案（例如 `.env` 或巢狀的 `node_modules`）不在其中，因此依賴這些檔案的檢查會把規則或測試回報為未證實，或因錯誤的原因被抓到。Claude 會讀取失敗訊息來判斷是哪一種。

## 常見問題

**review-loop 會自動啟動嗎？**
不一定。只有當 Claude 判斷某個 skill 的描述符合目前的對話時，Claude 才會啟動該 skill。如果你請 Claude 審查或提交，Claude 可以啟動 review-loop，但這一點沒有保證。指令 `/review-loop:review-loop` 一定會啟動 review-loop。如果你啟用提交關卡，沒有經過審查的提交會被阻擋。此時 Claude 會收到先執行 review-loop 的提示。

**它會執行 push 或 merge 嗎？**
不會。如果你沒有選擇「在此儲存庫中不再詢問」，review-loop 會在每次提交前詢問你。如果要撤銷這個選擇，請要求 Claude 關閉 review-loop 的提交委派。

**它會與我的其他外掛衝突嗎？**
review-loop 新增一個 skill、一個 agent 和一個 hook。這個 hook 讀取 Bash 指令，只對 `git commit` 和 `git push` 起作用。如果你沒有在該儲存庫中啟用提交關卡，這個 hook 不做任何事。它的名稱都以 `review-loop:` 開頭，因此不會與其他外掛的名稱衝突。如果你用一般的自然語言提出要求，Claude 可以改為選擇另一個審查 skill。該指令一定會啟動 review-loop。

**如果工作階段在迴圈中途結束，會發生什麼事？**
再次執行該指令。指令會提供兩個選項：從停止時的輪次和步驟繼續，或者重新開始。

**如何解除安裝？**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

接著，在每個執行過 review-loop 的儲存庫中刪除 `.git/lim/review-loop/`，以及 `.git/info/exclude` 中的 `.lim-review/` 這一行。

## 打造你自己的版本

review-loop 使用你已有的檢查。你的 `typecheck`、`lint` 和 `test` 腳本越完善，審查中靠測量得出的部分就越多，靠閱讀判斷的部分就越少。

- 想在任何變更發生之前看到嚴重的發現項目？請 Claude 先跟你確認每個 P2，或者每個 P1 和 P2。
- 在你信任的儲存庫裡厭倦了逐一核准提交？在那裡委派提交。啟用提交關卡後，push 仍會詢問你。
- 總是收到同樣的意見？選擇「設為規則」，下一次審查開始時，你自己的 linter 或測試就已經能抓到這個錯誤。
- 想要不同的流程？Fork 這個外掛。skill 是一個不到 250 行的 `SKILL.md`，迴圈邏輯是一個腳本：`plugins/review-loop/skills/review-loop/scripts/loop.mjs`。

## LIM 的開發方式

- **先有 issue。** 每個變更都從一個 issue 開始，並透過 pull request 合併進來。維護者使用 squash merge 合併該 pull request。
- **用自己審查自己。** 每個 pull request 都會對自己的 diff 執行 review-loop，說明中會展示報告和對每個發現項目的決定。
- **每個外掛獨立版本。** 每個外掛遵循語意化版本（Semantic Versioning），維護自己的 `CHANGELOG.md`，並使用 `<plugin>--v<version>` 格式的標籤。minor 和 major 版本會發布 GitHub Release。
- **刻意保持小巧。** 一個外掛只有一個入口 skill，`SKILL.md` 少於 250 行，並且只包含需要主動啟用的 hook。

## 路線圖

- 使用 `claude plugin eval` 進行模型層級的 eval，涵蓋單元測試無法涵蓋的行為，並對審查品質和成本做盲測比較

## 參與貢獻

歡迎提交 issue 和 pull request。請先閱讀 [CONTRIBUTING.md](../../CONTRIBUTING.md)。

## 授權條款

MIT。詳見 [LICENSE](../../LICENSE)。
