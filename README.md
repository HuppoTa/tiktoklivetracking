# TikTok LIVE Comment Hub

## Hàng đợi và Gift Tracking (schema v7)

- `queueNumber` bất biến theo phiên; đổi ưu tiên chỉ cập nhật `priorityRank`.
- Có thể nâng comment trực tiếp hoặc nhập câu hỏi thủ công mà không sửa classifier/raw comment.
- API mới: promote comment, manual question, priority và archive/undo.
- UI hiển thị badge `#N`, nguồn câu hỏi và nút điều chỉnh ưu tiên.
- Socket đồng bộ thay đổi queue giữa các tab và luôn kèm metadata session.
- Gift final được lưu theo `sessionId + eventId`; streak interim không ghi durable totals.
- Gift được gắn bằng TikTok `userId` vào câu chưa trả cũ nhất, hoặc vào tab `Cần chú ý` nếu người tặng chưa hỏi.
- Hàng đợi ưu tiên manual pin, diamond giảm dần, thời điểm gift rồi stable `queueNumber` (setting có thể cho gift đứng trước pin).
- Notification góc phải chỉ nhận event realtime sau khi trang sẵn sàng, tự đóng, gom theo `sessionId + userId + giftId` và không replay lịch sử.
- UI có cài đặt thời gian toast/highlight, pin/unpin, acknowledge và chuyển gift giữa các câu cùng user/session.

TikTok LIVE Comment Hub là công cụ chạy local trên Mac để thu comment TikTok LIVE, gom câu hỏi trùng và hỗ trợ streamer quản lý hàng chờ trả bài.

**Demo/tài liệu:** https://huppota.github.io/tiktoklivetracking/
**Mã nguồn:** https://github.com/HuppoTa/tiktoklivetracking

> GitHub Pages chỉ là trang giới thiệu và demo bằng dữ liệu hư cấu. Bản đó không thể tự thu TikTok LIVE; collector thật cần backend Node.js đang chạy.

## Tính năng

- Theo dõi TikTok ID có thể thay đổi và thu comment LIVE realtime.
- Gom question thread theo TikTok user ID, đếm câu hỏi lặp và vẫn giữ occurrence gốc.
- Checkbox đã trả bài, hoàn tác và đồng bộ nhiều tab bằng Socket.IO.
- Viewer analytics ghi nhận từ collector.
- Lưu dữ liệu local theo phiên, đổi tài khoản ngay trên giao diện và xuất CSV.
- Xem lịch sử phiên LIVE, kết thúc/bắt đầu phiên, reset trả bài và xóa riêng một phiên sau khi tạo backup.
- Theo dõi gift, ưu tiên câu hỏi và đồng bộ attention/settings giữa nhiều tab.

## Yêu cầu hệ thống

- Node.js 22 LTS (dependency hiện tại yêu cầu Node.js 22 trở lên).
- macOS, Windows hoặc Linux và kết nối Internet.
- Tài khoản cần theo dõi phải đang LIVE để nhận comment.

## Cài đặt

```bash
git clone https://github.com/HuppoTa/tiktoklivetracking.git
cd tiktoklivetracking
npm install
npm start
```

Mở http://localhost:3000. Ứng dụng đọc livestream công khai và chức năng hiện tại không cần cookie, mật khẩu hay tài khoản TikTok.

Để đổi target, nhấn **Đổi tài khoản** trên header và nhập `@username` hoặc URL LIVE. Cũng có thể đặt trước bằng biến môi trường:

```bash
TIKTOK_USERNAME=username_khac npm start
```

Sao chép `.env.example` nếu cần tham khảo biến cấu hình; ứng dụng không tự nạp file `.env` nếu chưa dùng công cụ nạp biến môi trường.

## Kiểm thử

```bash
npm ci
node --check server.js
node --check public/app.js
node --check public/dashboard-state.js
npm test
npm run audit:metadata -- /path/to/copied-store.json
```

Test dùng fixture hư cấu và không cần kết nối TikTok. CI đặt `DISABLE_TIKTOK=1` để không khởi tạo collector.

Đặt `QUESTION_DEBUG=true` khi chạy local để xem score và lý do classifier nhận diện câu hỏi.

## Giới hạn

- TikTok connector là thư viện không chính thức; TikTok có thể thay đổi giao thức.
- GitHub Pages chỉ host tài liệu/demo tĩnh, không chạy Express, Socket.IO hoặc collector.
- Collector thật phải chạy bằng Node.js trên máy hoặc server riêng.
- Viewer analytics là số quan sát được từ event connector và có thể thấp hơn thống kê chính thức.
- Gift UI hiện ở trạng thái `IMPLEMENTED_NOT_VISUALLY_VERIFIED`; cần click-test bằng browser runtime.
- Gift trên tài khoản thật ở trạng thái `LIVE_NOT_VERIFIED` nếu tài khoản không LIVE.
- Chưa có authentication cho người dùng cuối: chỉ chạy loopback/local; public backend vẫn `NO-GO`.

## Bảo mật dữ liệu

- `data/` bị loại khỏi Git và không được commit.
- Comment có thể chứa thông tin cá nhân; không chia sẻ `store.json`, log runtime hoặc file export.
- Người vận hành chịu trách nhiệm về quyền riêng tư và thời gian lưu dữ liệu.

## Public backend deployment

GitHub Pages không chạy collector. Để thu LIVE 24/7, phase sau cần deploy Node backend lên nền tảng hỗ trợ process lâu dài và WebSocket; frontend public khi đó cần cấu hình `API_BASE_URL` và `SOCKET_URL`. Dự án hiện chưa chọn hoặc triển khai dịch vụ trả phí.
