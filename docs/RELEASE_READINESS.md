# Release Readiness

Kết luận sau remediation hiện tại: **NO-GO cho online deployment**. Local release vẫn conditional vì Node 22 và toàn bộ transaction call-site chưa đóng.

| Gate | Status | Evidence/required action |
|---|---|---|
| Không có P0 | Pass hiện tại | Không thấy corruption/orphan; threat online chưa được mở |
| P1 core path đóng | Fail | Storage failure, auth/bind, LIVE verification, Node mismatch |
| Session isolation verified | Partial | Unit/fixture pass; LIVE chưa pass |
| Backup/restore verified | Partial | Backup count pass; chưa restore drill |
| Classifier baseline | Partial | 360 synthetic cases, holdout F1 0.909; chưa có LIVE-labelled corpus |
| Manual fallback | Partial | Unit/API fixture pass; visual chưa pass |
| Answer persistence | Verified offline | Unit pass; browser/two-client thiếu |
| Multi-tab realtime | Partial | Hai client nhận manual commit; ma trận event đầy đủ còn thiếu |
| Crash-safe storage | Partial | Queue recovery/restore drill pass; fsync và toàn bộ transaction call-site còn thiếu |
| Node supported | Fail local | Node 20.20.2; yêu cầu ≥22 |
| Secrets/runtime data excluded | Pass current tree | `.env`, `data/` ignored |
| Authentication decision | Fail | Không auth/authorization/CSRF |
| Persistent storage decision | Fail online | JSON local file, không multi-instance lock |
| HTTPS/WSS | Fail | Chưa có reverse proxy/TLS design |
| Health/monitoring | Partial | `/api/health`, `/api/ready`, telemetry redacted; chưa monitoring ngoài process |
| Privacy/retention | Fail | Chưa policy cho comment, identity, avatar, export, backup |
| LIVE verification | Fail | `LIVE_NOT_VERIFIED` |
| Visual verification | Fail | Browser runtime không khả dụng |
| Load/soak test | Fail | Chưa có |

## Test strategy bắt buộc

- CI: unit normalization/classifier/dedup/session/analytics; migration idempotency; API validation and rollback; two Socket.IO clients; browser E2E desktop/mobile; lint/syntax; Node 22.
- Manual khi LIVE: room ID, one connection, initial-data cutoff, reconnect same room, stream end, viewer freshness; chỉ log metadata.
- Trước release: 4–8 giờ soak, crash giữa atomic save, restore drill, 50k dataset load, CSV security, dependency/security scan.
# Gift Tracking remediation — 2026-09-03

Trạng thái: `IMPLEMENTED_NOT_VISUALLY_VERIFIED`. Unit/API/two-client checks đã được bổ sung; chưa được phép ghi `Done` hoặc public release-ready cho tới khi browser click-test và LIVE smoke test hoàn tất. Schema giữ v7; không migration dữ liệu thật. Public backend vẫn `NO-GO` do chưa có product authentication/deployment safety.

Đã code: analytics consistency, atomic classifier/promote/manual gift link, canonical gift priority, manual pin, strict settings, attention assign/acknowledge, session-safe sockets, non-sticky aggregated toast, highlight và gift metadata audit. Còn cần xác minh ngoài code: desktop/mobile visual, timer animation thực tế, LIVE normal/streak/multi-gift và connector drift.
