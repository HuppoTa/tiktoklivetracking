# Project Context — TikTok LIVE Comment Hub

## Trạng thái hiện tại: manual queue + Gift Tracking (schema v7)

Dashboard hỗ trợ ba nguồn thread: `classifier`, `promoted_comment`, `manual_entry`. Session isolation, TikTok `userId`, classifier scoring và dedupe `sessionId + userId` được giữ nguyên. `queueNumber` lấy từ `session.nextQueueNumber` và không tái sử dụng; `priorityRank` là lớp sắp xếp riêng. Migration v5 → v6 chỉ thêm metadata queue theo thứ tự deterministic, giữ nguyên comment, occurrence, repeatCount và answered state.

API/UI đã có promote comment, nhập câu hỏi, đổi ưu tiên và archive/undo. Analytics tách số thread tự động, promoted và nhập tay.

> Tài liệu handoff dành cho ChatGPT/Codex và developer mới. Đọc file này trước khi đề xuất hoặc triển khai thay đổi.

### Gift Tracking architecture (2026-09-03)

- Connector chuẩn hóa gift legacy/protobuf bằng numeric TikTok `userId`; durable dedupe key là `sessionId + eventId`.
- `src/gift-service.js` quản lý gift summary, attention, link/transfer và priority; mọi liên kết chỉ trong cùng session/user.
- Streak interim chỉ là transient event; mặc định `applyTo: final-only`, final mới được persist và tạo notification.
- Gift trước câu hỏi tạo attention; classifier/promote/manual question đều link trong cùng atomic storage transaction.
- Queue sort mặc định: manual pin (nếu configured), eligible gift diamond giảm dần, gift time, rồi stable queue number. Các sort explicit không áp dụng gift priority.
- Notification không persist, gom theo `sessionId + userId + giftId`, tối đa 4 toast và clear khi đổi session.
- API gồm gifts, attention acknowledge/undo, assign question, strict gift settings và question pin/unpin. Socket event session-scoped; settings là global event có `sessionId: null`.
- Schema vẫn là 7; notification/highlight là UI state nên không cần schema 8.
- Verification hiện tại: code/unit/API/two-client verified; browser visual và LIVE thật phải báo riêng, không suy diễn thành pass.

## 1. Dự án là gì?

TikTok LIVE Comment Hub là web app chạy local trên Mac để theo dõi comment theo thời gian thực từ một tài khoản TikTok đang LIVE.

Tài khoản mặc định hiện tại: `@kathyuyen.ta`.

Mục tiêu hiện tại của app:

- Kết nối TikTok LIVE không cần đăng nhập hoặc cookie.
- Nhận comment trực tiếp và đẩy lên trình duyệt bằng Socket.IO.
- Lưu comment vào file JSON để không mất sau khi reload.
- Phát hiện sơ bộ comment có dạng câu hỏi.
- Gom các câu hỏi có nội dung tương tự.
- Tìm kiếm, lọc câu hỏi và xuất CSV.

Mục tiêu sản phẩm tiếp theo:

- Biến danh sách comment thành **hàng đợi trả bài** cho streamer.
- Nhận biết một TikTok ID gửi nhiều câu hỏi khác nhau.
- Nhận biết một TikTok ID lặp lại cùng một câu hỏi nhiều lần.
- Cho phép tick checkbox **Đã trả bài** và lưu trạng thái vĩnh viễn.
- Theo dõi dữ liệu theo từng phiên LIVE.

## 2. Trạng thái phát triển hiện tại

Ngày cập nhật tài liệu: **2026-08-31**.

Giai đoạn hiện tại: **MVP hàng đợi, viewer analytics và multi-target session đã triển khai**.

### Session isolation schema v5 (local, 2026-08-31)

- Session được khóa theo TikTok `roomId`; reconnect cùng room dùng lại session, room/target mới đóng session cũ.
- Collector dùng `processInitialData: false` và chỉ nhận event sau khi connection hiện tại trả room ID hợp lệ.
- Comment có `sessionId`, `roomId`, `connectionGeneration`, `receivedAt`, `eventTimestamp`, `questionScore` và `questionReasons`.
- API hỗ trợ xem session cụ thể; Socket event khác selected session bị frontend bỏ qua.
- Có UI/API kết thúc, bắt đầu, reset trả bài và xóa session có typed confirmation + backup.
- Storage schema hiện tại là v5; record thật trong `data/` vẫn bị Git ignore.
- Question detection dùng scoring threshold `0.60`, nhận tarot/trải bài không có dấu hỏi và loại greeting/emoji/date-only.

Đã hoàn thành:

- Server Express và Socket.IO chạy local.
- Tự kết nối `@kathyuyen.ta` khi khởi động.
- Tự thử kết nối lại sau 30 giây nếu tài khoản offline hoặc mất kết nối.
- Nhận comment TikTok LIVE theo thời gian thực.
- Chống lưu trùng dựa trên TikTok message ID.
- Lưu comment vào `data/comments.json`.
- Hiển thị trạng thái kết nối, tổng comment, số câu hỏi và số người tham gia.
- Tìm kiếm theo nickname hoặc nội dung.
- Bộ lọc chỉ hiện câu hỏi.
- Gom nhóm câu hỏi gần giống bằng Jaccard similarity.
- Xuất comment thành CSV.
- Nút bắt đầu/dừng thu hoạt động đúng với trạng thái `idle`, `offline`, `connecting`, `live`.
- Chuẩn hóa riêng `userId`, `username`, `nickname` cho schema legacy và protobuf v3.
- Storage schema v2 tại `data/store.json`, migration có backup và ghi atomic.
- Question thread theo từng `userId`, giữ toàn bộ comment occurrence gốc.
- Phân biệt câu hỏi riêng biệt, câu lặp và ứng viên có thể trùng.
- Thống kê số câu hỏi/lượt lặp/chưa trả theo người hỏi.
- Checkbox “Đã trả bài” lưu vĩnh viễn và đồng bộ nhiều tab bằng Socket.IO.
- API questions/users và thao tác đánh dấu hàng loạt.
- Giao diện ba tab: Chưa trả bài, Theo người hỏi, Đã trả bài.
- Unit test bằng fixture ẩn danh, không cần LIVE thật.
- Sửa white-screen bằng state merge idempotent, rollback và frontend error boundary.
- Workflow lịch sử đã trả bài, thời gian chờ và completion metrics.
- Viewer analytics từ `ROOM_USER.total` (protobuf v3) / `viewerCount` (legacy) và MEMBER observed counts.
- Đổi TikTok target từ modal, recent targets và target persistence.
- Session isolation cho comment, question thread, viewer analytics và CSV.
- Connection generation guard ngăn event/timer từ target cũ.

Chưa hoàn thành:

- Chưa chuyển sang SQLite; session hiện được lưu trong JSON schema v4.
- Chưa chuyển sang SQLite; storage JSON vẫn ghi toàn bộ store sau mỗi thay đổi.
- Chưa có UI xác nhận thủ công cho `possibleDuplicate`.
- Chưa có pagination hoặc virtual list cho dữ liệu rất lớn.
- Chưa có authentication; app được thiết kế để chạy local.

## 3. Lỗi quan trọng đã sửa

`tiktok-live-connector@2.4.4` hiện trả về schema protobuf v3, khác các field cũ trong ví dụ của thư viện.

Mapping cần giữ tương thích:

| Ý nghĩa | Field cũ | Field protobuf v3 hiện tại |
|---|---|---|
| Nội dung comment | `data.comment` | `data.content` |
| Message ID | `data.msgId` | `data.common.msgId` |
| Username | `data.user.uniqueId` | `data.user.displayId` |
| TikTok user ID | không ổn định | `data.user.id` |
| Avatar | `profilePicture.url[0]` | `avatarThumb.urlList[0]` |
| Question payload | `questionDetails` | `data.data` |

Code hiện dùng fallback cho cả schema cũ và mới. Không được bỏ fallback nếu chưa xác minh trực tiếp với một LIVE đang hoạt động.

## 4. Công nghệ

- Node.js `>=20`
- Express `5.x`
- Socket.IO `4.x`
- `tiktok-live-connector@2.4.4`
- ES Modules (`"type": "module"`)
- HTML/CSS/JavaScript thuần
- JSON file storage

Không có framework frontend, TypeScript, ORM hoặc database ở thời điểm hiện tại.

## 5. Cấu trúc dự án

```text
.
├── server.js               # Express, Socket.IO, TikTok connector, API, lưu dữ liệu
├── src/                    # Logic nghiệp vụ và storage độc lập
│   ├── normalize.js
│   ├── question-detector.js
│   ├── similarity.js
│   ├── question-service.js
│   ├── storage.js
│   ├── tiktok-normalizer.js
│   ├── analytics.js
│   ├── target.js
│   ├── session-service.js
│   └── connection-guard.js
├── public/
│   ├── index.html          # Cấu trúc giao diện
│   ├── app.js              # State frontend, render, filter, Socket.IO client
│   └── style.css           # Toàn bộ style giao diện
├── data/
│   ├── comments.json       # Dữ liệu legacy, chỉ dùng để migrate
│   ├── comments.json.v1.backup.json
│   └── store.json          # Storage schema v4 hiện tại
├── test/                   # Node test runner + fixture giả/ẩn danh
├── package.json
├── package-lock.json
├── README.md               # Hướng dẫn chạy nhanh
└── PROJECT_CONTEXT.md      # Tài liệu handoff này
```

Không đưa nội dung thật trong `data/comments.json` vào prompt, issue, log công khai hoặc tài liệu vì comment có thể chứa tên và ngày sinh.

## 5.1 Deployment chính thức

- Repository: https://github.com/HuppoTa/tiktoklivetracking
- GitHub Pages: https://huppota.github.io/tiktoklivetracking/
- `.github/workflows/ci.yml` chạy syntax check và unit test bằng fixture hư cấu, với collector bị tắt.
- `.github/workflows/pages.yml` publish duy nhất thư mục `docs/` bằng GitHub Actions chính thức.
- GitHub Pages là landing, tài liệu và demo tĩnh; không chạy Express, Socket.IO hay TikTok collector.
- Backend thật vẫn chạy local. Phase public backend sau này cần process Node lâu dài, WebSocket, `API_BASE_URL` và `SOCKET_URL`.

Quy trình release: rà secret và dữ liệu cá nhân, chạy `npm ci`, syntax check, `npm test`, commit lên `main`, sau đó xác minh CI và Pages workflow. Không commit `data/`, log runtime hoặc export chứa comment.

## 6. Cách chạy

```bash
npm install
npm start
```

Mở:

```text
http://localhost:3000
```

Đổi tài khoản hoặc port:

```bash
TIKTOK_USERNAME=ten_tai_khoan PORT=3001 npm start
```

Kiểm tra process đang chiếm port 3000:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

## 7. Luồng dữ liệu hiện tại

```text
TikTok LIVE
   ↓ tiktok-live-connector
server.js / onChat()
   ├─ chuẩn hóa schema connector
   ├─ bỏ message ID đã thấy
   ├─ nhận diện câu hỏi
   ├─ tạo/cập nhật question thread theo userId
   ├─ thêm occurrence vào comments[]
   ├─ emit comment/question/user events
   └─ ghi atomic data/store.json
          ↓
GET /api/state ─────→ Browser tải state ban đầu
Socket.IO ──────────→ Browser nhận comment/status mới
```

## 8. Data model hiện tại

Mỗi comment hiện được lưu dạng:

```json
{
  "id": "tiktok-message-id",
  "timestamp": "ISO-8601",
  "userId": "immutable-tiktok-user-id",
  "username": "displayId",
  "nickname": "TikTok nickname",
  "avatar": "https://...",
  "text": "Nội dung comment",
  "normalizedText": "noi dung da chuan hoa",
  "question": true
}
```

Record legacy không có TikTok numeric ID được migrate với `userId` dạng `legacy:<username>`; comment mới ưu tiên `data.user.id`.

## 9. API và realtime event hiện tại

### HTTP

- `GET /api/state`: trả `{ status, comments }`.
- `GET /api/questions`: lọc `answered`, `sort`, `search`.
- `PATCH /api/questions/:id/answered`: đánh dấu/hoàn tác một thread.
- `GET /api/users`: thống kê người hỏi.
- `GET /api/users/:userId/questions`: thread của một người.
- `PATCH /api/users/:userId/answered`: cập nhật mọi thread của một người.
- `POST /api/connect`: bắt đầu kết nối TikTok.
- `POST /api/disconnect`: dừng kết nối.
- `POST /api/target`: validate, lưu và chuyển TikTok target an toàn.
- `GET /api/analytics`: question completion và observed viewer analytics.
- `GET /api/export.csv`: tải toàn bộ comment dạng CSV.

### Socket.IO

- `status`: trạng thái kết nối mới nhất.
- `comment`: một comment mới đã được chuẩn hóa.
- `question:created`: thread mới.
- `question:updated`: thread lặp hoặc thay đổi trạng thái.
- `user:updated`: thống kê người hỏi thay đổi.
- `viewer:updated`: viewer summary của active session.
- `target:changing`, `target:changed`, `target:error`: đồng bộ target giữa các tab.

Status có thể gồm:

```json
{
  "state": "idle | connecting | live | offline",
  "username": "kathyuyen.ta",
  "message": "Thông báo tiếng Việt",
  "roomId": "TikTok room ID",
  "lastCommentAt": "ISO-8601"
}
```

## 10. Logic phát hiện câu hỏi và trùng hiện tại

`isQuestion(text)` chỉ dùng heuristic:

- Kết thúc bằng `?` hoặc `？`.
- Hoặc chứa một số từ khóa như `không`, `sao`, `gì`, `nào`, `giá`, `ship`, `còn`.

`findGroup(text)`:

- Chuẩn hóa chữ thường, bỏ dấu và một số từ đệm.
- Chuyển nội dung thành tập hợp từ.
- Tính Jaccard similarity.
- Nếu score `>= 0.42`, dùng lại group gần nhất; ngược lại tạo group mới.

Hạn chế:

- Có thể bỏ sót câu hỏi không có dấu hỏi hoặc từ khóa.
- Có thể gom nhầm hai người/ngày sinh/chủ đề khác nhau.
- Group hiện chạy trên toàn bộ comment, chưa tách theo user hoặc phiên LIVE.
- `groupId` chưa phải một entity có trạng thái riêng.

## 11. Thiết kế enhance đã thống nhất

### Nhu cầu nghiệp vụ

Cần phân biệt hai trường hợp:

1. **Một user gửi nhiều câu hỏi khác nhau**: hiển thị số câu hỏi riêng biệt của user và cho mở danh sách.
2. **Một user lặp lại cùng một câu hỏi**: tạo một question thread, tăng `repeatCount`, nhưng vẫn giữ mọi comment gốc.

Mỗi question thread cần checkbox:

```text
☐ Chưa trả bài
☑ Đã trả bài
```

Khi tick phải lưu vĩnh viễn và đồng bộ realtime cho mọi tab.

### Data model mục tiêu

```json
{
  "id": "question-thread-id",
  "sessionId": "live-session-id",
  "userId": "immutable-tiktok-user-id",
  "username": "displayId",
  "canonicalText": "Câu hỏi đại diện",
  "normalizedText": "noi dung da chuan hoa",
  "commentIds": ["message-1", "message-2"],
  "repeatCount": 2,
  "answered": false,
  "answeredAt": null,
  "createdAt": "ISO-8601",
  "lastAskedAt": "ISO-8601"
}
```

Không nên ghi `answered` trực tiếp lên từng occurrence làm nguồn sự thật chính; trạng thái nên thuộc question thread.

### Quy tắc đề xuất

- So sánh câu hỏi lặp trước tiên trong cùng `sessionId` và cùng `userId`.
- Trùng chắc chắn: similarity từ khoảng `0.85` trở lên.
- Nghi trùng: khoảng `0.60–0.84`, chỉ đánh dấu để người dùng xem xét.
- Không gom tự động nếu tên, ngày sinh hoặc chủ đề chính khác nhau.
- Comment mới lặp lại một thread đã trả bài: mặc định tăng `repeatCount` nhưng giữ `answered = true`.
- Luôn giữ occurrence gốc để audit và xuất dữ liệu.

Ngưỡng chỉ là điểm khởi đầu; cần kiểm thử trên dữ liệu đã ẩn danh trước khi chốt.

## 12. Roadmap triển khai

### Phase 1 — Củng cố định danh và data model

- Lưu riêng `userId`, `username`, `nickname`.
- Thêm schema version cho dữ liệu.
- Viết migration cho `comments.json` hiện có.
- Tách hàm normalize, detect question và similarity để có thể test.
- Thêm unit test cho schema connector cũ và protobuf v3.

**Definition of done:** comment mới có định danh ổn định; dữ liệu cũ vẫn đọc được.

### Phase 2 — Question threads và phát hiện lặp

- Tạo entity question thread.
- Gom occurrence theo `sessionId + userId + similarity`.
- Tính `repeatCount`, `firstAskedAt`, `lastAskedAt`.
- Tính số câu hỏi khác nhau và số lần lặp theo user.
- Không mất comment gốc.

**Definition of done:** UI/API phân biệt được “3 câu khác nhau” và “1 câu lặp 5 lần”.

### Phase 3 — Workflow “Đã trả bài”

- Thêm `answered`, `answeredAt`, có thể thêm `answeredBy` sau.
- API cập nhật một thread và cập nhật tất cả thread của một user.
- Socket.IO event cho trạng thái trả bài.
- Checkbox, hoàn tác, bộ lọc chưa trả/đã trả.
- Đưa câu đã trả xuống cuối hoặc sang tab riêng.

API dự kiến:

```text
GET   /api/questions
PATCH /api/questions/:id/answered
GET   /api/users/:userId/questions
PATCH /api/users/:userId/answered
```

**Definition of done:** reload/restart không làm mất checkbox; nhiều tab đồng bộ tức thời.

### Phase 4 — Thiết kế UI hàng đợi

- Tab `Chưa trả bài`, `Theo người hỏi`, `Đã trả bài`.
- Badge `Lặp N lần`.
- Badge `Người này có N câu hỏi`.
- Sort theo mới nhất, lặp nhiều nhất hoặc chờ lâu nhất.
- Tìm theo username, nickname, nội dung.
- Responsive cho màn hình nhỏ.

**Definition of done:** streamer xử lý được toàn bộ hàng đợi mà không cần xem dòng comment thô.

### Phase 5 — Phiên LIVE và SQLite

- Tạo `live_sessions` dựa trên room ID.
- Chuyển từ JSON sang SQLite.
- Các bảng dự kiến: `live_sessions`, `users`, `comments`, `question_threads`, `question_occurrences`.
- Migration một lần từ JSON sang SQLite.
- Xuất CSV theo phiên.
- Trang lịch sử phiên.

**Definition of done:** không trộn dữ liệu giữa các phiên; ghi dữ liệu an toàn và truy vấn nhanh.

### Phase 6 — Độ tin cậy và vận hành

- Integration test với fixture event TikTok, không phụ thuộc LIVE thật.
- Health indicator: thời điểm event cuối, reconnect count, lỗi gần nhất.
- Giới hạn bộ nhớ và pagination/virtual list.
- Graceful shutdown và flush pending writes.
- Log có cấu trúc nhưng không log nội dung nhạy cảm mặc định.
- Backup và retention policy.

## 13. MVP enhance nên làm trước

Phạm vi phiên bản kế tiếp nên giới hạn ở:

1. Lưu `userId` ổn định.
2. Tạo question thread theo user.
3. Đếm số câu khác nhau và số lần lặp.
4. Checkbox `Đã trả bài` có lưu bền vững.
5. Bộ lọc `Chưa trả` / `Đã trả`.

Chưa cần AI/embedding trong MVP. Heuristic rõ ràng, có test và cho phép điều chỉnh ngưỡng sẽ dễ kiểm soát hơn.

## 14. Rủi ro và nguyên tắc khi phát triển

- TikTok connector là API không chính thức; schema hoặc cơ chế kết nối có thể thay đổi.
- Luôn giữ fixture cho cả field legacy và protobuf v3.
- Không coi trạng thái `live` là bằng chứng duy nhất rằng comment đang chảy; kiểm tra `lastCommentAt`.
- Không xóa comment gốc khi gom trùng.
- Không dựa vào nickname/username làm định danh duy nhất.
- Thay đổi schema phải có migration, không âm thầm bỏ dữ liệu cũ.
- Dữ liệu có thể chứa thông tin cá nhân; tránh đưa vào source control hoặc log công khai.
- Khi chuyển SQLite, cần xác định rõ chính sách backup và xóa dữ liệu.
- Nếu chỉnh logic reconnect, tránh nhiều connection cùng tồn tại và tránh timer từ connection cũ tác động connection mới.

## 15. Kiểm thử tối thiểu cho mỗi thay đổi

Trước khi bàn giao một feature, cần kiểm tra:

- `node --check server.js`
- `node --check public/app.js`
- App khởi động được trên một port trống.
- `GET /api/state` trả JSON hợp lệ.
- Comment fixture schema cũ và v3 đều được chuẩn hóa đúng.
- Message ID lặp không tạo hai record.
- Reload trình duyệt không mất state đã lưu.
- Hai tab nhận cùng thay đổi qua Socket.IO.
- Không làm hỏng file dữ liệu cũ.

Không nên bắt buộc phải có LIVE thật cho toàn bộ test. Hãy tạo fixture đã ẩn danh từ shape của event connector.

## 16. Hướng dẫn cho ChatGPT/Codex khi nhận dự án

Khi được yêu cầu enhance dự án này:

1. Đọc `PROJECT_CONTEXT.md`, `server.js`, `public/app.js`, `public/index.html` và `package.json`.
2. Xác nhận task thuộc phase nào trong roadmap.
3. Kiểm tra dữ liệu hiện có nhưng không trích xuất comment cá nhân vào câu trả lời.
4. Nếu thay đổi schema, thiết kế migration trước khi code.
5. Giữ tương thích schema TikTok legacy và protobuf v3.
6. Ưu tiên một nguồn sự thật cho question thread và trạng thái `answered`.
7. Thêm test cho logic nghiệp vụ trước hoặc cùng lúc với implementation.
8. Xác minh bằng fixture; chỉ kết nối LIVE thật khi cần integration verification.
9. Báo rõ phần đã hoàn thành, test đã chạy và phần còn lại của roadmap.

## 17. Prompt handoff gợi ý

Có thể bắt đầu phiên ChatGPT mới bằng prompt:

```text
Hãy đọc PROJECT_CONTEXT.md và source hiện tại trước. Đây là TikTok LIVE Comment Hub đang ở giai đoạn MVP thu thập comment. Tôi muốn triển khai Phase 1/2/3 trong roadmap. Trước khi code, hãy kiểm tra data model hiện tại, chỉ ra migration cần thiết và lập kế hoạch theo từng commit nhỏ. Không đưa dữ liệu comment cá nhân vào câu trả lời và phải giữ tương thích schema TikTok legacy + protobuf v3.
```
