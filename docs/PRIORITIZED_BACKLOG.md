# Prioritized Backlog

## Now

| ID | Item | Definition of Done |
|---|---|---|
| F-01 | Làm storage save recoverable | Save failure không làm poison queue; mutation rollback hoặc durable retry; fault-injection test pass |
| F-02 | Chốt Node 22 runtime | Local/CI đều Node 22; dependency install không EBADENGINE; smoke test pass |
| F-03 | LIVE reliability smoke | Một LIVE thật xác minh room/session/generation, reconnect và không initial history; không log nội dung |
| F-04 | API mutation transaction safety | Mọi mutation có snapshot/rollback khi save lỗi; test cho từng core endpoint |
| F-05 | Ngăn truy cập ngoài ý muốn | Mặc định bind loopback; quyết định auth trước mọi LAN/online exposure |

## Next

| ID | Item | Definition of Done |
|---|---|---|
| F-06 | Sửa user aggregation manual/promoted | User chỉ có manual/promoted vẫn xuất hiện và số liệu đúng; tests pass |
| F-07 | Corpus classifier đại diện | ≥300 fixture giả có nhãn, báo precision/recall theo topic/teencode; threshold documented |
| F-08 | Possible-duplicate review | UI cho xem và quyết định merge/separate, có audit trail và socket sync |
| F-09 | Browser E2E hai tab | Answer/promote/manual/priority/session events đồng bộ, refresh recovery và mobile pass |
| F-10 | Hoàn thiện archive UX | Archive/undo chỉ cho nguồn hợp lệ, confirmation và accessibility pass |
| F-11 | CSV privacy hardening | Chống formula injection, quyền truy cập và export test pass |

## Later

| ID | Item | Definition of Done |
|---|---|---|
| F-12 | Pagination/virtualization | Soak ≥50k comments không white-screen, latency/render budget được đo |
| F-13 | SQLite evaluation | ADR so sánh JSON/SQLite, prototype transaction + migration/restore |
| F-14 | Viewer chart/retention | Sample policy, chart và giới hạn storage được kiểm thử |
| F-15 | Structured telemetry | Health, metrics, redacted logs, alert và crash recovery drill |

## Do not do yet

- Không rewrite frontend framework, microservices, Kubernetes hoặc multi-tenant SaaS.
- Không thay heuristic hoàn toàn bằng AI/embedding khi chưa có corpus chuẩn.
- Không mua hosting trước khi F-01 đến F-05 đóng và release checklist đạt.
# Gift Tracking follow-up verification

1. P0: Browser desktop/mobile click-test cho toast, settings, transfer, pin và highlight.
2. P0: LIVE smoke test normal gift, streak, hai gift type, gift-before/after-question khi account online.
3. P1: Load/performance test với gift volume lớn và quan sát memory/timer lâu dài.

