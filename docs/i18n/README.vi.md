# LIM

**Less is more.** Các plugin Claude Code nhỏ. Mỗi plugin làm một việc và cho thấy các số đo đứng sau nó.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Đây là bản dịch của [README tiếng Anh](../../README.md) tại ngày 2026-10-19. Nếu hai bản khác nhau, README tiếng Anh là bản đúng.

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | Tiếng Việt | [Bahasa Indonesia](README.id.md)

## Tại sao chọn LIM

Các agent harness lớn nạp nhiều chỉ dẫn vào mỗi session và chạy hook trên nhiều lệnh. LIM giữ mỗi plugin nhỏ, tùy chọn và có số đo.

- **Một plugin, một việc.** Bạn chỉ cài những gì bạn cần. review-loop thêm khoảng 188 token vào một session. `claude plugin details` báo cáo con số này.
- **Check trước, ý kiến sau.** Test, kiểm tra kiểu và lint của bạn chạy trước mọi lần review bằng mô hình.
- **Hook là opt-in.** Một hook không làm gì cho đến khi bạn bật nó cho một repository.
- **Hỏi trước khi cài.** Mọi thứ một plugin cần đều được giải thích trước: nó là gì, nó cải thiện điều gì, nó nằm ở đâu và cách gỡ nó.
- **Cho thấy con số.** Mỗi plugin đi kèm thông tin về những gì đã được đo và những gì số đo đó không bao gồm.

## Plugin

| Plugin | Trạng thái | Một việc |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.3.0 | Review các thay đổi của bạn trước khi commit, sửa các phát hiện P1 và P2, review lại và giao phần còn lại cho bạn. |

## Bắt đầu nhanh

Bạn cần Claude Code, git và Node.js 18 trở lên.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Nếu Claude Code yêu cầu, hãy khởi động lại Claude Code. Sau đó, trong một git repository có thay đổi chưa commit, chạy lệnh này:

```
/review-loop:review-loop
```

Việc thêm marketplace chỉ đăng ký danh mục. Mỗi plugin được cài riêng. Vì vậy bạn chỉ nhận những gì bạn chọn.

## review-loop

Trước khi bạn commit, review-loop chạy một vòng lặp ngắn và tự dừng.

1. **Check.** review-loop chạy các script `typecheck`, `lint` và `test` từ `package.json` của bạn. Một check thất bại trở thành một phát hiện P1. Một `package.json` không phải JSON hợp lệ cũng trở thành một phát hiện P1. Nếu một check chạy quá giới hạn thời gian, review-loop báo cáo check đó là "chưa xác minh" thay vì thất bại.
2. **Review mới.** Một reviewer agent riêng nhận diff và một bản tóm tắt một dòng về mục tiêu của bạn. Agent này không nhận lập luận của Claude về thay đổi đó. Agent này có thể đọc code xung quanh để hiểu ngữ cảnh. Agent này gắn nhãn các phát hiện từ P1 đến P5. Agent này cũng báo cáo code mà các agent thêm vào khi không biết nguyên nhân: guard cho những trạng thái mà không có gì cho thấy có thể xảy ra, comment về lịch sử code, TODO không có liên kết đến issue, và một cách thứ hai để làm một việc mà codebase đã làm. P1 và P2 cần bằng chứng: dòng chính xác, một kịch bản lỗi và lý do vì sao chưa có gì ngăn lỗi đó. review-loop hiển thị các khẳng định không có bằng chứng cho bạn dưới dạng chưa xác minh.
3. **Sửa.** Claude nói nó sẽ sửa gì, sau đó sửa P1 và P2. Nếu một bản sửa cần một lựa chọn thiết kế (có nhiều cách sửa, hành vi nhìn thấy được bị thay đổi, xóa một tính năng, thay đổi test), bạn chọn trước. Để xem mọi P2 (hoặc mọi P1 và P2) trước khi có bất kỳ thay đổi nào, hãy yêu cầu Claude xác nhận với bạn trước. Nếu dự án của bạn có script test, Claude cũng viết một regression test từ kịch bản lỗi của mỗi P1 hoặc P2 mà nó sửa, và review-loop cho thấy test đó thất bại trên code từ trước bản sửa.
4. **Review lại.** Một reviewer mới chỉ kiểm tra các bản sửa và các phát hiện còn mở. Tối đa 3 vòng.
5. **Dừng.** Một script quyết định khi nào dừng, không phải mô hình. Script dừng vòng lặp trong các trường hợp sau: không còn P1 hoặc P2, đạt giới hạn số vòng, một phát hiện vẫn còn sau hai lần sửa, một phát hiện đã giải quyết quay lại, P1 + P2 không giảm nữa, hoặc một bản sửa làm yếu test hay check.
6. **Quyết định.** Bạn quyết định phần còn lại một lần: mọi P3 đến P5, cùng với mọi P1 hoặc P2 vẫn còn mở, chưa xác minh được, hoặc nói về một file nằm ngoài diff đã review. Với mỗi phát hiện, bạn chọn: giữ nguyên, chỉ sửa lần này, hoặc biến nó thành một quy tắc. Một quy tắc là một quy tắc lint hoặc một test mà Claude viết cùng với bản sửa. review-loop chạy các check của bạn trên code từ trước bản sửa để cho thấy quy tắc đó bắt được vấn đề. Một phát hiện bạn chọn giữ nguyên sẽ không bị hỏi lại ở lần review sau cho đến khi dòng được trích dẫn thay đổi, và báo cáo sẽ đếm nó thay vào đó.
7. **Commit.** Claude hỏi trước khi commit, trừ khi bạn đã chọn "không hỏi nữa trong repo này". Claude không bao giờ push. Nếu bạn bật commit gate, một hook biến điều này thành quy tắc: commit của Claude bị chặn cho đến khi một lần review đạt.

### Commit gate

Commit gate là một hook. Hook này tắt cho đến khi bạn bật nó trong một repository. Khi một lần review kết thúc, Claude hỏi một lần xem có bật hook này không. Khi gate đang bật, gate kiểm tra trước mọi `git commit` mà Claude chạy:

| Tình huống | Gate làm gì |
|---|---|
| Chưa có review, hoặc có file thay đổi mà review chưa bao phủ | Chặn commit và yêu cầu Claude chạy review |
| Một vòng lặp review đang chạy, hoặc vẫn còn quyết định đang chờ | Chặn commit |
| Review đã đạt | Hỏi bạn trước khi commit, hoặc cho phép commit nếu bạn đã ủy quyền commit trong repository này |
| Sau review, chỉ có các file đã review hoặc bản nháp quy tắc và regression test mà `loop rule` đã kiểm tra thay đổi | Hỏi bạn |
| `git push` hoặc force push | Luôn hỏi, kể cả khi đã ủy quyền |
| Commit với `--no-verify` | Hỏi, kể cả khi đã ủy quyền, và vẫn chặn commit chưa có review đạt |
| Commit trong thư mục mà gate không đọc được, ví dụ `cd "$(...)"` hoặc đường dẫn không tồn tại | Hỏi, kể cả khi đã ủy quyền, nếu gate đang bật trong repository nơi bạn khởi động Claude Code |

Để commit một lần mà không review, hãy yêu cầu Claude bỏ qua review lần này. Thiết lập gate và việc ủy quyền commit áp dụng cho toàn bộ repository, kể cả các worktree liên kết. Mỗi worktree có review riêng.

Mỗi vòng kết thúc bằng một báo cáo:

```
Review round 2 of 3
Checks: test passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal
  test: src/coupon.test.js (before the fix: caught, after: passed)

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

### Mức độ nghiêm trọng

Các mức này dựa trên quy tắc Pn công khai của Banksalad.

| Mức | Ý nghĩa | Hành vi của vòng lặp |
|---|---|---|
| P1 | Phải sửa: một check thất bại, mất dữ liệu, một lỗ hổng bảo mật, một crash, hoặc tính năng được yêu cầu không hoạt động | Chỉ được sửa khi có bằng chứng |
| P2 | Nên sửa: một bug mà một đầu vào cụ thể tái hiện được, một yêu cầu bị thiếu, một quy tắc dự án bị vi phạm | Chỉ được sửa khi có bằng chứng |
| P3 | Đáng sửa: khả năng bảo trì, một tên gây hiểu nhầm, thiếu test cho một nhánh phụ | Bạn quyết định |
| P4 | Tùy chọn: một sở thích về cấu trúc mà mọi người không đồng ý với nhau | Bạn quyết định |
| P5 | Nhỏ: lỗi chính tả hoặc định dạng | Bạn quyết định |

P1 hoặc P2 về một file không có trong diff mà vòng đó đã review sẽ không được sửa trong vòng lặp. Nó đến với bạn ở cuối, được đánh dấu là nằm ngoài diff đã review, và giữ nguyên mức độ nghiêm trọng.

### Số đo

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) liệt kê 109 hành vi trên sáu trục: do, tell, ask, silence, stop và evidence. Unit test trong CI bao phủ 104 hành vi trong số đó. Các unit test này bao gồm cả các lần chạy trên git repository tạm thời thật và hook commit gate. 5 hành vi còn lại cần một lần chạy với mô hình và được dự kiến cho `claude plugin eval`: hỏi về P3 đến P5 một lần, hiển thị báo cáo trước mọi câu hỏi, giữ mọi bước trong danh sách việc cần làm kèm lý do cho mỗi bước bị bỏ qua, viết regression test cho mỗi P1 hoặc P2 đã sửa, và báo cáo code được thêm vào mà không rõ nguyên nhân. Hành vi cuối cùng có một fixture trong [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/).

review-loop review chính các pull request của LIM. [#8](https://github.com/lee-eojin/lim/pull/8) cho thấy hai vòng lặp trên phiên bản đầu tiên của review-loop. Một vòng trong đó dừng vì một false positive trong check phát hiện test bị làm yếu của chính nó. Lỗi này sau đó đã được sửa.

### Dữ liệu

Trạng thái, diff, log của check và một sổ ghi quyết định nằm trong `.git/lim/review-loop/` bên trong repository của bạn. review-loop không ghi gì vào working tree của bạn. Để kiểm tra một quy tắc, review-loop ghi code từ trước bản sửa vào một thư mục tạm bên ngoài repository của bạn và xóa thư mục đó sau khi xong. Xóa `.git/lim/review-loop/` để đặt lại.

review-loop không tự thực hiện lệnh gọi mạng nào. Claude và reviewer đọc diff, các phát hiện và output của check giống như mọi file khác trong session của bạn. Vì vậy, nội dung đó được gửi đến nhà cung cấp mô hình theo cùng cách với phần còn lại của session Claude Code của bạn.

### Giới hạn

- review-loop chỉ phát hiện check từ các script trong `package.json`.
- Mỗi check có tối đa 5 phút. Tất cả check cộng lại có tối đa 9 phút. Đặt `LIM_CHECK_TIMEOUT_MS` để thay đổi giới hạn cho mỗi check.
- Khi không có commit gate, việc hỏi trước khi commit là một chỉ dẫn cho Claude, không phải một sự đảm bảo.
- Commit gate chỉ kiểm tra các lệnh mà Claude chạy qua công cụ Bash của nó. Các commit bạn tự gõ trong terminal của mình không được kiểm tra. Git alias như `git ci` không được nhận diện.
- Nếu bạn khởi động Claude Code trong một thư mục không phải repository, gate không thể kiểm tra commit mà nó không xác định được repository, ví dụ sau `cd "$(...)"`.
- review-loop review mọi thứ mà `git add -A` sẽ bao gồm. Nó không review một tập thay đổi đã stage do bạn tự chọn.
- Một quy tắc hoặc một regression test được kiểm tra trong một bản sao tạm. Bản sao này có các file được track của bạn và một liên kết tới `node_modules` ở thư mục gốc. Các file bị ignore khác, như `.env` hoặc một `node_modules` lồng bên trong, không có ở đó. Vì vậy, một check cần các file đó sẽ báo quy tắc hoặc test đó là chưa được chứng minh hoặc bắt được lỗi vì sai lý do. Claude đọc lỗi để biết đó là trường hợp nào.

## FAQ

**review-loop có tự khởi động không?**
Không phải lúc nào cũng vậy. Claude chỉ khởi động một skill khi Claude quyết định rằng mô tả của skill phù hợp với cuộc hội thoại. Nếu bạn yêu cầu Claude review hoặc commit, Claude có thể khởi động review-loop, nhưng điều này không được đảm bảo. Lệnh `/review-loop:review-loop` luôn khởi động review-loop. Nếu bạn bật commit gate, một commit không có review sẽ bị chặn. Khi đó Claude được yêu cầu chạy review-loop trước.

**Nó có push hoặc merge không?**
Không bao giờ. review-loop hỏi trước mỗi commit, trừ khi bạn chọn "không hỏi nữa trong repo này". Bạn có thể tắt lựa chọn đó: hãy yêu cầu Claude tắt việc ủy quyền commit của review-loop.

**Nó có xung đột với các plugin khác của tôi không?**
review-loop thêm một skill, một agent và một hook. Hook này đọc các lệnh Bash và chỉ xử lý `git commit` và `git push`. Nếu bạn chưa bật commit gate trong repository đó, hook này không làm gì. Tên của nó bắt đầu bằng `review-loop:`. Vì vậy các tên này không thể trùng với tên từ các plugin khác. Nếu bạn hỏi bằng lời thông thường, Claude có thể chọn một review skill khác. Lệnh luôn khởi động review-loop.

**Điều gì xảy ra nếu một session kết thúc giữa vòng lặp?**
Chạy lại lệnh. review-loop đề xuất hai lựa chọn: tiếp tục từ vòng và bước nơi nó đã dừng, hoặc bắt đầu lại từ đầu.

**Làm sao để gỡ cài đặt?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

Sau đó, xóa `.git/lim/review-loop/` trong mỗi repository mà bạn đã chạy review-loop.

## Cách LIM được xây dựng

- **Issue trước.** Mọi thay đổi bắt đầu từ một issue. Thay đổi đó đi vào dự án qua một pull request, và một maintainer squash-merge pull request đó.
- **Phiên bản theo từng plugin.** Mỗi plugin tuân theo Semantic Versioning, có `CHANGELOG.md` riêng và được gắn tag `<plugin>--v<version>`. Các bản phát hành minor và major có GitHub Release.
- **Nhỏ có chủ đích.** Một plugin có một entry skill, một `SKILL.md` dưới 250 dòng và chỉ có hook dạng opt-in.

## Lộ trình

- review-loop: soạn bản nháp quy tắc từ các phát hiện bạn đã chọn "biến nó thành một quy tắc" trong các lần review trước
- Eval ở cấp mô hình với `claude plugin eval` cho các hành vi mà unit test không bao phủ được

## Đóng góp

Chúng tôi hoan nghênh issue và pull request. Hãy bắt đầu với [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Giấy phép

MIT. Xem [LICENSE](../../LICENSE).
