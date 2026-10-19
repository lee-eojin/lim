# LIM

**Less is more.** 小型 Claude Code 外掛。每個外掛只做一件事，並公開它背後的測量結果。

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

本文是截至 2026-10-19 的 [英文 README](../../README.md) 的翻譯。如果兩者內容不一致，以英文 README 為準。

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | 繁體中文 | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | [Bahasa Indonesia](README.id.md)

## 為什麼選擇 LIM

大型 agent harness 會在每個工作階段載入大量指示，並在許多指令上執行 hook。LIM 讓每個外掛保持小巧、可選用，並且經過測量。

- **一個外掛，一件事。** 只安裝你需要的外掛。根據 `claude plugin details` 的報告，review-loop 為一個工作階段增加約 188 個 token。
- **先檢查，後意見。** 在任何模型審查之前，先執行你的測試、型別檢查和 lint。
- **Hook 需要主動啟用。** 在你為某個儲存庫啟用 hook 之前，hook 不做任何事。
- **安裝前先詢問。** 外掛需要的任何東西都會先得到說明：它是什麼、它改善什麼、它存放在哪裡、如何移除它。
- **公開數字。** 每個外掛都附帶兩項說明：測量了什麼，以及該測量不涵蓋什麼。

## 外掛

| 外掛 | 狀態 | 唯一職責 |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.1.1 | 在你提交之前審查你的變更，修正 P1 和 P2 發現項目，再次審查，然後把其餘發現項目交給你。 |
| forge | 規劃中 | 把審查者在 pull request 中的留言轉換為審查者 skill，並附帶一份忠實度報告，說明該 skill 與審查者本人的一致程度。 |

## 快速開始

你需要 Claude Code、git，以及 Node.js 18 或更新版本。

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

如果 Claude Code 要求重新啟動，請重新啟動它。接著，在一個有未提交變更的 git 儲存庫中執行：

```
/review-loop:review-loop
```

新增 marketplace 只會註冊外掛清單。每個外掛分開安裝，所以你只會得到你選擇的外掛。

## review-loop

在你提交之前，review-loop 執行一個短迴圈，並自動停止。

1. **檢查。** review-loop 執行你的 `package.json` 中的 `typecheck`、`lint` 和 `test` 腳本。如果某個檢查失敗，或者 `package.json` 不是有效的 JSON，review-loop 會將其記為一個 P1 發現項目。如果某個檢查的執行時間超過時間限制，review-loop 會將其回報為「未驗證」，而不是「失敗」。
2. **全新審查。** 一個獨立的審查者 agent 會收到 diff 和一行摘要，該摘要說明你想要達成什麼。審查者不會收到 Claude 對這次變更的推理。審查者可以讀取周圍的程式碼來了解脈絡。審查者把發現項目標記為 P1 到 P5。P1 和 P2 需要證據：確切的程式碼行、一個失敗情境，以及為什麼現有程式碼沒有防止該問題。沒有證據的主張會以「未驗證」的狀態顯示給你。
3. **修正。** Claude 先說明它要修正什麼，然後修正 P1 和 P2。如果某個修正需要設計決策（修正方式不只一種、使用者看得到的行為變化、移除功能、修改測試），由你先做選擇。
4. **再次審查。** 一個新的審查者只檢查本輪的修正和仍未解決的發現項目。最多 3 輪。
5. **停止。** 由腳本而不是模型決定何時停止。停止條件：沒有剩餘的 P1 或 P2、達到輪數上限、某個發現項目經過兩次修正後仍然存在、某個已解決的發現項目再次出現、P1 + P2 的數量不再減少，或者某個修正削弱了測試或檢查。
6. **決定。** 其餘發現項目由你一次決定：所有 P3 到 P5，以及仍未解決或無法驗證的 P1 和 P2。對每一個項目，你可以選擇：維持原樣、僅本次修正，或者設為規則。
7. **提交。** 如果你沒有選擇「在此儲存庫中不再詢問」，Claude 會在提交前詢問你。review-loop 從不執行 push。 如果你啟用提交關卡，一個 hook 會把這一點變成強制規則。在審查通過之前，Claude 的提交會被阻擋。

### 提交關卡

提交關卡是一個 hook。在你為某個儲存庫啟用它之前，它處於關閉狀態。在審查結束時，Claude 會詢問一次是否啟用它。啟用關卡後，Claude 執行的每個 `git commit` 都會先由關卡檢查：

| 情況 | 關卡的行為 |
|---|---|
| 沒有審查，或者有審查未涵蓋的檔案發生了變更 | 阻擋提交，並要求 Claude 執行審查 |
| 審查迴圈正在進行，或者還有待定的決定 | 阻擋提交 |
| 審查已通過 | 提交前詢問你。如果你在此儲存庫中委派了提交，則允許提交 |
| 審查後只有已審查的檔案發生了變更 | 詢問你 |
| `git push` 或強制推送（force push） | 即使你已委派提交，也一定詢問你 |
| 帶有 `--no-verify` 的提交 | 即使你已委派提交，也詢問你。未通過審查的提交仍會被阻擋 |

如果要不經審查提交一次，請要求 Claude 這次跳過審查。

每一輪都以一份報告結束：

```
Review round 2 of 3
Checks: test passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

### 嚴重等級

本規則以 Banksalad 公開的 Pn 規則為基礎。

| 等級 | 含義 | 迴圈中的處理 |
|---|---|---|
| P1 | 必須修正：檢查失敗、資料遺失、資安漏洞、當機，或者所要求的功能無法運作 | 僅在有證據時修正 |
| P2 | 應該修正：特定輸入可以重現的 bug、缺少的需求、被違反的專案規則 | 僅在有證據時修正 |
| P3 | 值得修正：可維護性、容易誤解的名稱、次要路徑上缺少測試 | 由你決定 |
| P4 | 可選：大家意見不一致的結構偏好 | 由你決定 |
| P5 | 瑣碎：錯字或格式問題 | 由你決定 |

### 測量結果

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) 列出了六個面向上的 49 個行為。六個面向是：執行（do）、告知（tell）、詢問（ask）、靜默（silence）、停止（stop）和證據（evidence）。CI 中的單元測試涵蓋其中 47 個行為，包括在真實的暫存 git 儲存庫上執行的測試和針對提交關卡 hook 的測試。其餘 2 個行為需要實際執行模型，預計使用 `claude plugin eval` 測試：對 P3 到 P5 只詢問一次、在任何提問之前先顯示報告。

review-loop 審查 LIM 自己的 pull request。[#8](https://github.com/lee-eojin/lim/pull/8) 展示了 review-loop 第一個版本上執行的兩次迴圈。其中一次停止是由 review-loop 自己的測試削弱檢查中的誤判造成的，這個誤判之後已經修正。

### 資料

狀態、diff、檢查日誌和決策紀錄存放在你的儲存庫內的 `.git/lim/review-loop/` 資料夾中。review-loop 不會在你的工作目錄寫入任何內容。如果要重設，請刪除該資料夾。

review-loop 本身不會發出任何網路請求。Claude 和審查者讀取 diff、發現項目和檢查輸出的方式，與讀取你工作階段中其他檔案的方式相同。因此，這些內容會和你的 Claude Code 工作階段的其餘內容一樣傳送給模型供應商。

### 限制

- review-loop 只從 `package.json` 的 scripts 中偵測檢查。
- 每個檢查最多執行 5 分鐘，所有檢查合計最多執行 9 分鐘。如果要修改單一檢查的時間限制，請設定 `LIM_CHECK_TIMEOUT_MS`。
- 如果沒有啟用提交關卡，提交前詢問只是給 Claude 的指示，而不是保證。
- 提交關卡只檢查 Claude 透過它的 Bash 工具執行的指令。你在自己的終端機中輸入的提交不會被檢查。`git ci` 這類 git 別名也不會被辨識。
- review-loop 審查 `git add -A` 會包含的所有內容，而不是你手動挑選的一組已暫存變更。

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

接著，在每個執行過 review-loop 的儲存庫中刪除 `.git/lim/review-loop/`。

## LIM 的開發方式

- **先有 issue。** 每個變更都從一個 issue 開始，並透過 pull request 合併進來。維護者使用 squash merge 合併該 pull request。
- **每個外掛獨立版本。** 每個外掛遵循語意化版本（Semantic Versioning），維護自己的 `CHANGELOG.md`，並使用 `<plugin>--v<version>` 格式的標籤。minor 和 major 版本會發布 GitHub Release。
- **刻意保持小巧。** 一個外掛只有一個入口 skill，`SKILL.md` 少於 250 行，並且只包含需要主動啟用的 hook。

## 路線圖

- review-loop：在修正前逐一確認 P2 的選項（[#4](https://github.com/lee-eojin/lim/issues/4)）、更強的測試削弱檢查（[#6](https://github.com/lee-eojin/lim/issues/6)）、在大型儲存庫上更快的快照（[#7](https://github.com/lee-eojin/lim/issues/7)）
- forge：為從 pull request 留言中萃取出的審查者 skill 提供忠實度報告
- 使用 `claude plugin eval` 進行模型層級的 eval，涵蓋單元測試無法涵蓋的行為

## 參與貢獻

歡迎提交 issue 和 pull request。請先閱讀 [CONTRIBUTING.md](../../CONTRIBUTING.md)。

## 授權條款

MIT。詳見 [LICENSE](../../LICENSE)。
