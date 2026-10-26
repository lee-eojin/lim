# LIM

**Less is more.** Các plugin Claude Code nhỏ. Mỗi plugin làm một việc và cho thấy các số đo đứng sau nó.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Đây là bản dịch của [README tiếng Anh](../../README.md) tại ngày 2026-10-24. Nếu hai bản khác nhau, README tiếng Anh là bản đúng.

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | Tiếng Việt | [Bahasa Indonesia](README.id.md)

Coding agent viết code rất nhanh. Nhưng chúng kém hơn nhiều trong việc nhận ra mình đã sai ở đâu. Agent đã viết một thay đổi là reviewer yếu nhất cho thay đổi đó, vì nó đọc thay đổi qua chính lập luận của mình và đồng ý với chính mình. Vì vậy, code được commit mà không có review, hoặc với một lần review từ chính ngữ cảnh đã viết ra nó.

**LIM là câu trả lời của tôi: những plugin nhỏ, mỗi plugin làm một việc, kèm theo con số để chứng minh.** Plugin đầu tiên là review-loop.

**review-loop khiến "sẵn sàng để commit" có nghĩa là đã được review.** Test, kiểm tra kiểu và lint của bạn chạy trước. Sau đó, một reviewer với ngữ cảnh mới, không bao giờ thấy lập luận của Claude, gắn nhãn các phát hiện từ P1 đến P5 và phải đưa ra bằng chứng cho những phát hiện nghiêm trọng. Claude sửa P1 và P2, một reviewer mới kiểm tra các bản sửa, và một script, không phải mô hình, quyết định khi nào dừng. Bạn quyết định phần còn lại một lần, ở cuối.

**Những nhận xét bạn cứ phải lặp lại sẽ trở thành quy tắc.** Khi bạn đánh dấu một phát hiện là "biến nó thành một quy tắc", Claude soạn bản nháp một quy tắc lint hoặc một test, và review-loop chạy nó trên code từ trước bản sửa để chứng minh rằng nó bắt được lỗi đó. Một bản sửa bug cũng nhận được một regression test theo cùng cách.

**Nhỏ có chủ đích.** review-loop thêm khoảng 212 token vào một session. Hook của nó không làm gì cho đến khi bạn bật nó trong một repository. Không có gì được cài đặt mà không cho bạn biết nó là gì và cách gỡ nó.

Hãy fork, chỉnh sửa và biến nó thành của bạn. Chúng tôi hoan nghênh issue và pull request.

## Plugin

| Plugin | Trạng thái | Một việc |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.6.1 | Review các thay đổi của bạn trước khi commit, sửa các phát hiện P1 và P2, review lại và giao phần còn lại cho bạn. |
| [clear-explain](../../plugins/clear-explain) | 0.1.0 | Giải thích khái niệm, code và lỗi với câu trả lời đặt trước, mỗi từ một nghĩa, và thuật ngữ kỹ thuật giữ tên tiếng Anh chính thức. |
| [verify](../../plugins/verify) | 0.2.0 | Chứng minh các tính năng hoạt động bằng cách chạy chúng, và lưu lệnh cùng output làm bằng chứng. |

## Cài đặt

Bạn cần Claude Code, git và Node.js 18 trở lên.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Nếu Claude Code yêu cầu, hãy khởi động lại Claude Code. Việc thêm marketplace chỉ đăng ký danh mục. Mỗi plugin được cài riêng, vì vậy bạn chỉ nhận những gì bạn chọn.

## Bắt đầu

Hai bước:

1. Cài review-loop như trên.
2. Trong một git repository có thay đổi chưa commit, gõ:

```
/review-loop:review-loop
```

Vậy là xong. review-loop chạy các check của bạn, review thay đổi, sửa những gì phải sửa và hỏi bạn về phần còn lại. Ở cuối, nó hỏi một lần xem có bật commit gate cho repository này không, rồi hỏi có commit không.

Mới bắt đầu? [Hướng dẫn](../../docs/guide/README.md) (bằng tiếng Anh) đi qua lần review đầu tiên, cách quyết định, commit gate, chi phí và các lỗi thường gặp, với output thật.

## Cách dùng

### Chỉ cần dùng `/review-loop:review-loop`

Gõ lệnh này mỗi khi bạn sắp commit. Bạn có thể thêm điều bạn muốn bằng lời thông thường sau lệnh:

```
/review-loop:review-loop I changed the coupon math. Check it before I commit.
```

```
/review-loop:review-loop confirm every P2 with me before you fix anything.
```

Claude cũng có thể tự khởi động review-loop khi bạn yêu cầu nó review hoặc commit, nhưng chỉ khi Claude quyết định rằng skill đó phù hợp. Lệnh này thì luôn khởi động nó.

### Một vòng trông như thế nào

Mỗi vòng kết thúc bằng một báo cáo. Claude hiển thị báo cáo này trước mọi thứ khác:

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

Ở đây, vòng 1 tìm thấy một P1. Claude đã sửa nó và viết một regression test, và review-loop cho thấy test đó thất bại trên code từ trước bản sửa. Vòng 2 xác nhận bản sửa, nên vòng lặp dừng lại. Còn một P3 dành cho bạn.

### Ví dụ

<details>
<summary>Tất cả các prompt</summary>

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

## Một lần review diễn ra như thế nào

Trước khi bạn commit, review-loop chạy một vòng lặp ngắn và tự dừng.

1. **Check.** review-loop chạy các check `typecheck`, `lint` và `test` mà dự án của bạn khai báo: script trong `package.json`, target trong Makefile, hoặc lệnh mặc định cho Go (`go.mod`), Rust (`Cargo.toml`) và các công cụ Python bạn đã cấu hình. Một check thất bại, hoặc một `package.json` không phải JSON hợp lệ, sẽ trở thành một phát hiện P1. Một check chạy quá giới hạn thời gian, hoặc có chương trình chưa được cài đặt, được báo cáo là "chưa xác minh" thay vì thất bại.
2. **Review mới.** Một reviewer agent riêng nhận diff và một bản tóm tắt một dòng về mục tiêu của bạn, nhưng không nhận lập luận của Claude về thay đổi đó. Agent này có thể đọc code xung quanh để hiểu ngữ cảnh. Agent này gắn nhãn các phát hiện từ P1 đến P5. P1 và P2 cần bằng chứng: dòng chính xác, một kịch bản lỗi và lý do vì sao chưa có gì ngăn lỗi đó. Mỗi phát hiện được gắn nhãn measured, inferred hoặc guessed. Một P1 hoặc P2 không có bằng chứng, hoặc có nhãn guessed, được hiển thị cho bạn là chưa xác minh thay vì được sửa.
3. **Sửa.** Claude nói nó sẽ sửa gì, sau đó sửa P1 và P2. Nếu một bản sửa cần một lựa chọn thiết kế (có nhiều cách sửa, hành vi nhìn thấy được bị thay đổi, xóa một tính năng, thay đổi test), bạn chọn trước. Nếu dự án của bạn có script test, Claude viết một regression test từ kịch bản lỗi của mỗi P1 hoặc P2 mà nó sửa, và review-loop cho thấy test đó thất bại trên code từ trước bản sửa.
4. **Review lại.** Một reviewer mới chỉ kiểm tra các bản sửa và các phát hiện còn mở. Tối đa 3 vòng.
5. **Dừng.** Một script, không phải mô hình, quyết định khi nào dừng: không còn P1 hoặc P2, đạt giới hạn số vòng, một phát hiện vẫn còn sau hai lần sửa, một phát hiện đã giải quyết quay lại, P1 + P2 không giảm nữa, hoặc một bản sửa làm yếu test hay check.
6. **Quyết định.** Bạn quyết định phần còn lại một lần: mọi P3 đến P5, cùng với mọi P1 hoặc P2 vẫn còn mở, chưa xác minh được, hoặc nói về một file nằm ngoài diff đã review. Với mỗi phát hiện, bạn chọn: giữ nguyên, chỉ sửa lần này, hoặc biến nó thành một quy tắc. Một phát hiện bạn chọn giữ nguyên sẽ không bị hỏi lại ở lần review sau cho đến khi dòng được trích dẫn thay đổi, và báo cáo sẽ đếm nó thay vào đó. Nếu các lần review trước trong repository này đã nêu một trong bốn loại mà reviewer tìm (chẳng hạn guard phỏng đoán) từ 3 lần trở lên, Claude sẽ nói rõ điều đó và đề xuất biến nó thành một quy tắc ở tầng mạnh nhất phù hợp: trước tiên là thay đổi kiểu hoặc kiến trúc, sau đó là quy tắc lint, rồi đến test.
7. **Commit.** Claude hỏi trước khi commit, trừ khi bạn đã chọn "không hỏi nữa trong repo này". Claude không bao giờ push. Nếu bạn bật commit gate, một hook biến điều này thành quy tắc: commit của Claude bị chặn cho đến khi một lần review đạt.

Khi Claude nói một điều gì đó đã được sửa, Claude cũng nói nó biết điều đó bằng cách nào: một check giờ đã đạt là measured, còn việc nó đọc code mới là inferred. Khi bạn phản bác một phát hiện, Claude kiểm tra lại nhận định đó trước khi đồng ý và cho bạn biết nó đã kiểm tra những gì.

### Reviewer tìm gì

Reviewer tìm bug, yêu cầu bị thiếu, quy tắc dự án bị vi phạm và bất cứ điều gì khác khiến thay đổi không đạt được điều bạn nói rằng bạn muốn. Reviewer không tranh luận về điều bạn muốn. Nó cũng tìm bốn loại code mà các agent thêm vào khi không biết nguyên nhân của một vấn đề, vì agent tiếp theo sẽ sao chép chúng:

<details>
<summary>Bốn loại đó</summary>

| Loại | Đó là gì | Mức độ nghiêm trọng |
|---|---|---|
| Guard phỏng đoán | Một check, try/catch, fallback hoặc giá trị mặc định cho một trạng thái mà không có gì cho thấy có thể xảy ra | P2 khi nó che giấu một lỗi, nếu không thì P3 |
| Comment lịch sử | Một comment về việc ai yêu cầu gì, vì sao một phiên bản trước đã thay đổi, hoặc một chỉ dẫn cho agent | P4 |
| Dấu hiệu đi tắt | Một comment TODO, HACK, "temporary" hoặc "for now" không có liên kết đến issue | P3 |
| Cách thứ hai | Một helper, pattern hoặc dependency cho một việc mà codebase đã làm theo cách khác | P3 |

Một guard là đúng ở nơi một trạng thái hợp lệ đi vào code: dữ liệu người dùng nhập, việc đọc từ mạng hoặc file, hoặc một giá trị mà tài liệu API ghi là có thể không có. Một check thứ hai nằm sâu hơn bên trong, cho một trạng thái đã được xử lý, vẫn là phỏng đoán. Một fixture trong [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/) chứa một ví dụ cho mỗi loại và kiểm tra rằng reviewer đánh dấu được chúng.

</details>

### Mức độ nghiêm trọng

Các mức này dựa trên quy tắc Pn công khai của Banksalad.

| Mức | Ý nghĩa | Hành vi của vòng lặp |
|---|---|---|
| P1 | Phải sửa: một check thất bại, mất dữ liệu, một lỗ hổng bảo mật, một crash, hoặc tính năng được yêu cầu không hoạt động | Được sửa nếu có bằng chứng |
| P2 | Nên sửa: một bug mà một đầu vào cụ thể tái hiện được, một yêu cầu bị thiếu, một quy tắc dự án bị vi phạm | Được sửa nếu có bằng chứng |
| P3 | Đáng sửa: khả năng bảo trì, một tên gây hiểu nhầm, thiếu test cho một nhánh phụ | Bạn quyết định |
| P4 | Tùy chọn: một sở thích về cấu trúc mà mọi người không đồng ý với nhau | Bạn quyết định |
| P5 | Nhỏ: lỗi chính tả hoặc định dạng | Bạn quyết định |

P1 hoặc P2 về một file không có trong diff mà vòng đó đã review sẽ không được sửa trong vòng lặp. Nó đến với bạn ở cuối, được đánh dấu là nằm ngoài diff đã review, và giữ nguyên mức độ nghiêm trọng.

### Quy tắc và regression test

Một nhận xét mà reviewer phải lặp lại là dấu hiệu của một quy tắc còn thiếu. review-loop luôn đếm: mỗi lần review ghi lại loại của từng phát hiện vào một file dùng chung cho mọi worktree của repository, và một phát hiện thuộc một trong bốn loại ở trên có loại đã được các lần review trước nêu từ 3 lần trở lên sẽ được đánh dấu là lặp lại. Các nhãn rộng như correctness vẫn được ghi lại nhưng không bao giờ được tính là lặp lại. Khi bạn chọn "biến nó thành một quy tắc" cho một phát hiện, Claude trước tiên tìm một quy tắc có sẵn trong cấu hình lint hoặc test của bạn mà lẽ ra đã phải bắt được nó. Sau đó, Claude chọn hình thức đầu tiên có tác dụng: bật một quy tắc lint có sẵn, viết một quy tắc tùy chỉnh cho linter bạn đang dùng, hoặc viết một test. Bản nháp không bao giờ được đặt vào file mà phát hiện nói đến.

Tiếp theo, review-loop chứng minh bản nháp đó. Nó ghi code từ trước bản sửa vào một thư mục tạm và chạy các check của bạn ở đó, có và không có bản nháp:

| Kết quả | Ý nghĩa |
|---|---|
| `caught` | Một check chỉ thất bại khi có bản nháp. Quy tắc bắt được lỗi đó. |
| `missed` | Mọi check đều đạt dù có bản nháp. Claude sửa lại bản nháp một lần. |
| `unproven` | Một check bị quá thời gian, hoặc vẫn thất bại khi không có bản nháp. Claude cho bạn biết đó là trường hợp nào. |

Một quy tắc cần một check có thể chạy nó. Nếu không có script `typecheck`, `lint` hoặc `test`, lựa chọn đó được ghi lại là "chỉ sửa lần này" và Claude cho bạn biết lý do. Một bản nháp đã được chứng minh sẽ đi vào cùng commit với bản sửa, và commit message có nhắc tên nó.

Mỗi P1 hoặc P2 mà Claude sửa cũng nhận được một regression test theo cùng cách, không cần hỏi, khi dự án của bạn có script test. Với regression test, chỉ check test mới được tính là bằng chứng: nếu chỉ có lint thất bại khi có test đó, thì test đó chưa bắt được bug. Một bản sửa không có test sẽ nêu lý do trong báo cáo.

### Commit gate

Commit gate là một hook luôn tắt cho đến khi bạn bật nó trong một repository. Khi một lần review kết thúc, Claude hỏi một lần xem có bật hook này không. Khi gate đang bật, mọi `git commit` mà Claude chạy đều được kiểm tra trước.

<details>
<summary>Gate làm gì</summary>

| Tình huống | Gate làm gì |
|---|---|
| Chưa có review, hoặc có file thay đổi mà review chưa bao phủ | Chặn commit và yêu cầu Claude chạy review |
| Một vòng lặp review đang chạy, hoặc vẫn còn quyết định đang chờ | Chặn commit |
| Review đã đạt | Hỏi bạn trước khi commit, hoặc cho phép commit nếu bạn đã ủy quyền commit trong repository này |
| Sau review, chỉ có các file đã review hoặc bản nháp quy tắc và regression test mà `loop rule` đã kiểm tra thay đổi | Hỏi bạn |
| `git push` hoặc force push | Luôn hỏi, kể cả khi đã ủy quyền |
| Commit với `--no-verify` | Hỏi, kể cả khi đã ủy quyền, và vẫn chặn commit chưa có review đạt |
| Commit trong thư mục mà gate không đọc được, ví dụ `cd "$(...)"` hoặc đường dẫn không tồn tại | Hỏi bạn, kể cả khi đã ủy quyền, nếu gate đang bật trong repository nơi bạn khởi động Claude Code |

Để commit một lần mà không review, hãy yêu cầu Claude bỏ qua review lần này. Thiết lập gate và việc ủy quyền commit áp dụng cho toàn bộ repository, kể cả các worktree liên kết. Mỗi worktree có review riêng.

</details>

### Thiết lập

Năm thiết lập đầu tiên áp dụng cho một repository. Để thay đổi, hãy gõ yêu cầu sau `/review-loop:review-loop`, để Claude đã nạp sẵn các lệnh của skill. Giới hạn thời gian của check là một biến môi trường, nên nó áp dụng ở bất cứ nơi nào bạn đặt, và tổng 9 phút là cố định.

| Thiết lập | Mặc định | Cần gõ |
|---|---|---|
| Xác nhận trước khi sửa | Tắt | "xác nhận mọi P2 với tôi" hoặc "xác nhận mọi P1 và P2 với tôi" |
| Commit gate | Được hỏi một lần ở cuối lần review đầu tiên | "bật (hoặc tắt) commit gate" |
| Ủy quyền commit | Hỏi trước mỗi commit | "không hỏi nữa trước khi commit trong repo này" |
| Không giám sát | Tắt | "chạy không giám sát" cho một lần chạy, hoặc "bật (hoặc tắt) chế độ không giám sát trong repo này". Claude không hỏi gì, để lại cho sau những việc cần đến bạn, và kết thúc bằng một bản tóm tắt những gì đã làm và những gì đang chờ bạn |
| Model của reviewer | Model của session | "chạy reviewer bằng sonnet trong repo này" (hoặc opus, haiku, fable), hoặc "chạy reviewer bằng model của session". Phần Số đo cho thấy mỗi model tìm được gì và tốn bao nhiêu |
| Giới hạn thời gian của check | 5 phút cho mỗi check, tổng cộng 9 phút | Đặt `LIM_CHECK_TIMEOUT_MS` để thay đổi giới hạn cho mỗi check |

## Số đo

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) liệt kê 182 hành vi trên sáu trục: do, tell, ask, silence, stop và evidence. Unit test trong CI bao phủ 171 hành vi trong số đó, bao gồm cả các lần chạy trên git repository tạm thời thật và hook commit gate. 11 hành vi còn lại cần một lần chạy với mô hình: hỏi về P3 đến P5 một lần, hiển thị báo cáo trước mọi câu hỏi, giữ mọi bước trong danh sách việc cần làm kèm lý do cho mỗi bước bị bỏ qua, viết regression test cho mỗi P1 hoặc P2 đã sửa, gắn nhãn measured, inferred hoặc guessed cho mỗi phát hiện, nói rõ làm sao biết một bản sửa đã hiệu quả, kiểm tra lại một phát hiện khi bạn phản bác, đề xuất một quy tắc cho loại phát hiện cứ lặp lại, không hỏi gì trong một lần chạy không giám sát, khởi động reviewer bằng model bạn đã chọn, và báo cáo code được thêm vào mà không rõ nguyên nhân. Hành vi cuối cùng có một fixture trong [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/), và hai hành vi đầu tiên có một lần chạy thủ công trong [`evals/review-loop/manual-behaviors.md`](../../evals/review-loop/manual-behaviors.md).

Một benchmark phát hiện lỗi đưa cho reviewer các thay đổi trong các repository tạm thời có tên không cho biết đó là một bài test. [`evals/review-loop/detection/`](../../evals/review-loop/detection/) có 12 thay đổi, mỗi thay đổi được cài sẵn một bug, cùng 6 thay đổi sạch. [`evals/review-loop/detection-hard/`](../../evals/review-loop/detection-hard/) có 10 bug khó hơn, chẳng hạn một bug chỉ thấy được trong một file mà diff không chạm tới, một bug chỉ thấy được khi lần theo bốn file, một bug nằm trong một diff dài 183 dòng, một race giữa hai lần tìm kiếm, một buffer bị làm rỗng trước khi một thao tác ghi bất đồng bộ đọc nó, và một lock không được giải phóng trên một nhánh xử lý lỗi, cùng 6 thay đổi sạch trông có vẻ đáng ngờ. Kết quả với 3 lần chạy cho mỗi trường hợp, ngày 2026-10-25 cho bộ thường và ngày 2026-10-26 cho bộ khó hơn:

| Model của reviewer | Bộ thường: bug được tìm thấy ở mức P1 hoặc P2 | Bộ thường: P1 hoặc P2 sai trên thay đổi sạch | Bộ khó hơn: bug được tìm thấy ở mức P1 hoặc P2 | Bộ khó hơn: P1 hoặc P2 sai trên thay đổi sạch | Chi phí của bộ khó hơn (48 lần chạy) |
|---|---|---|---|---|---|
| claude-opus-5-5 | 36 trên 36 | 0 trên 18 | 30 trên 30 | 0 trên 18 | 3,11 USD |
| claude-sonnet-5-5 | chưa chạy | chưa chạy | 29 trên 30 | 0 trên 18 | 1,14 USD |
| claude-haiku-5-5 | chưa chạy | chưa chạy | 30 trên 30 | 3 trên 18 | 0,09 USD, theo báo cáo của Claude Code |

Mặc định, reviewer chạy bằng model mà session của bạn đang dùng. Opus tìm thấy mọi bug được cài sẵn trong cả hai bộ, nên benchmark chưa thể cho thấy số bug tìm được giảm đi đối với nó. Để xem benchmark có cho thấy được một `reviewer.md` kém hơn hay không, Opus cũng chạy bộ khó hơn với một `reviewer.md` được cắt gọn chỉ còn định dạng đầu ra: nó vẫn tìm được 30 trên 30, tạo ra 1 P2 sai trong 18 lần chạy sạch, và nêu 83 phát hiện từ P3 đến P5, trong khi reviewer đầy đủ nêu 55. Với Opus, việc tìm ra các bug này phụ thuộc vào model nhiều hơn vào hướng dẫn, và một `reviewer.md` kém hơn lộ ra dưới dạng cảnh báo sai và nhiễu. Lần bỏ sót duy nhất của Sonnet không trả về phát hiện nào cho buffer bị làm rỗng trước một thao tác ghi bất đồng bộ. Cả 3 cảnh báo sai của Haiku đều nằm trên cùng một trường hợp sạch, và trường hợp này cũng tạo ra 1 P2 sai trong 9 lần chạy Opus với reviewer đầy đủ qua hai ngày. Một phát hiện được tính khi nó nêu bug được cài sẵn tại một dòng đã thay đổi, hoặc, với bug chỉ thấy được trong một file khác, tại một dòng được đánh dấu trong file đó. Sau các lần chạy đầu tiên, từ khóa đã được thêm vào bốn trường hợp mà reviewer nêu bug được cài sẵn bằng cách diễn đạt mà cách chấm điểm không chấp nhận, và mọi lần chạy đã lưu đều được chấm lại với các từ khóa đó. Chạy lại bằng `node evals/review-loop/run-detection.mjs --runs 3`, và thêm `--cases evals/review-loop/detection-hard` cho bộ khó hơn.

Bảng ở trên là cơ sở cho model mặc định của reviewer. Trên bộ khó hơn, Opus tìm được 30 trên 30 và không có P1 hoặc P2 sai, Sonnet tìm được 29 trên 30 và cũng không có P1 hoặc P2 sai, với chi phí khoảng 37% của Opus, còn Haiku tìm được 30 trên 30 với 3 P1 hoặc P2 sai trong 18 lần chạy sạch. Vì vậy mặc định vẫn là model của session, và Sonnet là lựa chọn rẻ hơn khi bạn muốn reviewer chạy trên một model khác với model đã viết thay đổi.

<details>
<summary>Chi phí</summary>

`claude plugin details` ước tính chi phí của review-loop như sau:

| Thành phần | Luôn bật, trong mọi session | Mỗi lần chạy |
|---|---|---|
| skill review-loop | khoảng 140 token | khoảng 5.600 token |
| reviewer agent | khoảng 70 token | khoảng 1.700 token, cộng với diff và code mà nó đọc |

Chi phí của skill được tính một lần cho mỗi lần chạy. Chi phí của reviewer được tính một lần cho mỗi vòng, và một vòng lặp chạy tối đa 3 vòng. Model của reviewer làm thay đổi chi phí đó; bảng benchmark ở trên cho thấy chi phí của từng model. Các check của bạn chạy trên máy của bạn và không tốn token.

</details>

review-loop review chính các pull request của LIM. [#8](https://github.com/lee-eojin/lim/pull/8) cho thấy hai vòng lặp trên phiên bản đầu tiên của nó, trong đó có một lần dừng vì một false positive trong check phát hiện test bị làm yếu của chính nó. Lỗi này sau đó đã được sửa. Các pull request gần đây, như [#46](https://github.com/lee-eojin/lim/pull/46), cho thấy báo cáo của review-loop và quyết định cho từng phát hiện.

## Vì sao nó hoạt động theo cách này

<details>
<summary>Vì sao cần một reviewer mới?</summary>

Agent đã viết một thay đổi biết vì sao từng dòng có mặt ở đó, nên nó đọc thay đổi như thể nó đúng. Một reviewer chỉ nhận diff và một dòng mô tả mục tiêu phải tự tìm ra lý do trong code. Nếu lý do không có ở đó, đó là một phát hiện. Mỗi vòng khởi động một reviewer mới, nên một reviewer không bao giờ chấm điểm kết luận trước đó của chính nó.

</details>

<details>
<summary>Vì sao một script quyết định khi nào dừng?</summary>

Một mô hình khi được hỏi "xong chưa?" thường trả lời là rồi. Thay vào đó, script của review-loop đếm: nó dừng khi không còn P1 hoặc P2, sau 3 vòng, khi một phát hiện vẫn còn sau hai lần sửa, khi một phát hiện đã giải quyết quay lại, khi P1 + P2 không giảm nữa, hoặc khi một bản sửa làm yếu một test. Dừng lại khi vẫn còn phát hiện mở là một kết quả bình thường, và Claude sẽ nói rõ điều đó.

</details>

<details>
<summary>Vì sao P1 và P2 cần bằng chứng?</summary>

Một khẳng định tự tin và một khẳng định đã được chứng minh trông giống nhau trong báo cáo. Một P1 hoặc P2 phải trích dẫn dòng chính xác, đưa ra một đầu vào tạo ra kết quả sai, và nói vì sao chưa có gì ngăn lỗi đó. Nếu thiếu bất kỳ điều nào trong ba điều này, hoặc khi reviewer gắn nhãn guessed, phát hiện đó được hiển thị là chưa xác minh và Claude không thay đổi code vì nó.

</details>

<details>
<summary>Vì sao commit gate là opt-in?</summary>

Một hook chặn commit sẽ thay đổi cách bạn làm việc, nên đó phải là lựa chọn của bạn cho từng repository. Khi không có gate, "hỏi trước khi commit" là một chỉ dẫn mà Claude làm theo. Khi có gate, hook chặn một `git commit` mà Claude chạy khi chưa có review đạt. Nó không thấy được mọi thứ: [Giới hạn](#giới-hạn) liệt kê những gì nó bỏ sót, chẳng hạn như git alias.

</details>

<details>
<summary>Vì sao nó không bao giờ push?</summary>

Một commit nằm ở máy cục bộ và dễ hoàn tác. Một lần push thì không. review-loop dừng ở bước commit, và gate hỏi trước mọi lần push kể cả khi bạn đã ủy quyền commit.

</details>

## Dữ liệu

Trạng thái, diff, log của check và một sổ ghi quyết định nằm trong `.git/lim/review-loop/` bên trong repository của bạn. Claude ghi mỗi review vào `.lim-review/` trong working tree của bạn trong chốc lát; git bỏ qua thư mục này nhờ `.git/info/exclude`, và review-loop xóa file sau khi đọc. Để kiểm tra một quy tắc, review-loop ghi code từ trước bản sửa vào một thư mục tạm bên ngoài repository của bạn và xóa thư mục đó sau khi xong. Xóa `.git/lim/review-loop/` để đặt lại.

review-loop không tự thực hiện lệnh gọi mạng nào. Claude và reviewer đọc diff, các phát hiện và output của check giống như mọi file khác trong session của bạn. Vì vậy, nội dung đó được gửi đến nhà cung cấp mô hình theo cùng cách với phần còn lại của session Claude Code của bạn.

## Giới hạn

- Check được phát hiện từ các script trong `package.json`, sau đó từ target trong Makefile, rồi từ Go, Rust và các công cụ Python đã cấu hình (pytest, ruff, mypy), chỉ ở thư mục gốc của repository.
- Mỗi check có tối đa 5 phút, và tất cả check cộng lại có tối đa 9 phút.
- Khi không có commit gate, việc hỏi trước khi commit là một chỉ dẫn cho Claude, không phải một sự đảm bảo.
- Commit gate chỉ kiểm tra các lệnh mà Claude chạy qua công cụ Bash của nó. Các commit bạn tự gõ trong terminal của mình không được kiểm tra, và git alias như `git ci` không được nhận diện.
- Nếu bạn khởi động Claude Code trong một thư mục không phải repository, gate không thể kiểm tra commit mà nó không xác định được repository, ví dụ sau `cd "$(...)"`.
- Nó review mọi thứ mà `git add -A` sẽ bao gồm, không phải một tập thay đổi đã stage do bạn tự chọn.
- Một quy tắc hoặc một regression test được kiểm tra trong một bản sao tạm có các file được track của bạn và một liên kết tới `node_modules` ở thư mục gốc. Các file bị ignore khác, như `.env` hoặc một `node_modules` lồng bên trong, không có ở đó. Vì vậy, một check cần các file đó sẽ báo kết quả là chưa được chứng minh, hoặc là bắt được nhưng vì sai lý do. Claude đọc lỗi để biết đó là trường hợp nào.

## FAQ

**review-loop có tự khởi động không?**
Không phải lúc nào cũng vậy. Claude chỉ khởi động một skill khi Claude quyết định rằng mô tả của skill phù hợp với cuộc hội thoại. Nếu bạn yêu cầu Claude review hoặc commit, Claude có thể khởi động review-loop, nhưng điều này không được đảm bảo. Lệnh `/review-loop:review-loop` luôn khởi động review-loop. Nếu bạn bật commit gate, một commit không có review sẽ bị chặn và Claude được yêu cầu chạy review-loop trước.

**Nó có push hoặc merge không?**
Không bao giờ. review-loop hỏi trước mỗi commit, trừ khi bạn chọn "không hỏi nữa trong repo này". Bạn có thể tắt lựa chọn đó bằng cách yêu cầu Claude tắt việc ủy quyền commit của review-loop.

**Nó có xung đột với các plugin khác của tôi không?**
review-loop thêm một skill, một agent và một hook. Hook này đọc các lệnh Bash, chỉ xử lý `git commit` và `git push`, và không làm gì trừ khi bạn đã bật commit gate trong repository đó. Tên của nó bắt đầu bằng `review-loop:`, nên không thể trùng với tên từ các plugin khác. Nếu bạn hỏi bằng lời thông thường, Claude có thể chọn một review skill khác. Lệnh luôn khởi động review-loop.

**Điều gì xảy ra nếu một session kết thúc giữa vòng lặp?**
Chạy lại lệnh. review-loop đề xuất tiếp tục từ vòng và bước nơi nó đã dừng, hoặc bắt đầu lại từ đầu.

**Làm sao để gỡ cài đặt?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

Sau đó, xóa `.git/lim/review-loop/` trong mỗi repository mà bạn đã chạy review-loop, cùng dòng `.lim-review/` trong `.git/info/exclude` của repository đó.

## Biến nó thành của bạn

review-loop làm việc với các check bạn đã có. Script `typecheck`, `lint` và `test` của bạn càng tốt, thì phần review được đo càng nhiều thay vì chỉ được đọc.

- Muốn xem các phát hiện nghiêm trọng trước khi có bất kỳ thay đổi nào? Hãy yêu cầu Claude xác nhận mọi P2, hoặc mọi P1 và P2.
- Mệt vì phải duyệt commit trong một repository bạn tin tưởng? Hãy ủy quyền commit ở đó. Khi bật commit gate, push vẫn sẽ hỏi.
- Cứ nhận cùng một nhận xét? Hãy chọn "biến nó thành một quy tắc", và lần review tiếp theo sẽ bắt đầu với lỗi đó đã được linter hoặc test của chính bạn bắt.
- Muốn một quy trình khác? Hãy fork plugin. Skill là một file `SKILL.md` dưới 250 dòng, và logic của vòng lặp nằm trong một script, `plugins/review-loop/skills/review-loop/scripts/loop.mjs`.

## Cách LIM được xây dựng

- **Issue trước.** Mọi thay đổi bắt đầu từ một issue và đi vào dự án qua một pull request mà một maintainer squash-merge.
- **Tự review chính mình.** Mỗi pull request chạy review-loop trên diff của chính nó, và phần mô tả cho thấy báo cáo cùng quyết định cho từng phát hiện.
- **Phiên bản theo từng plugin.** Mỗi plugin tuân theo Semantic Versioning, có `CHANGELOG.md` riêng và được gắn tag `<plugin>--v<version>`. Các bản phát hành minor và major có GitHub Release.
- **Nhỏ có chủ đích.** Một plugin có một entry skill, một `SKILL.md` dưới 250 dòng và chỉ có hook dạng opt-in.

## Lộ trình

- Eval ở cấp mô hình với `claude plugin eval` cho các hành vi mà unit test không bao phủ được, và một phép so sánh mù về chất lượng và chi phí review

## Đóng góp

Chúng tôi hoan nghênh issue và pull request. Hãy bắt đầu với [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Giấy phép

MIT. Xem [LICENSE](../../LICENSE).
