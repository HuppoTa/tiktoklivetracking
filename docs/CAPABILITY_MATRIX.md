# Capability Matrix

Ngày audit: 2026-09-02. `Verified` nghĩa là có unit/runtime fixture evidence; không đồng nghĩa đã kiểm tra LIVE hoặc trình duyệt.

| Capability | Implemented | Verified | Works offline | Needs LIVE | Data risk | UX status | Tests | Notes |
|---|---:|---:|---:|---:|---:|---|---|---|
| TikTok connect/reconnect | Yes | Partial | No | Yes | High | Implemented | Guard fixtures | Chưa smoke-test LIVE |
| Target `@`/URL normalization | Yes | Yes | Yes | No | Low | Implemented | Unit | Server/browser cùng rule |
| Initial-data suppression | Yes | Code only | No | Yes | High | N/A | None | `processInitialData:false` |
| Generation/old-event guard | Yes | Yes | Yes | Yes | High | N/A | Unit | LIVE chưa xác minh |
| Legacy/protobuf normalization | Yes | Yes | Yes | No | Medium | N/A | Fixture | Schema fallback có test |
| Session per room/target | Yes | Yes | Yes | Yes | High | Implemented | Unit | LIVE room transition chưa test |
| Historical session view | Yes | Partial | Yes | No | Medium | Not visual verified | State test | Socket filtering có test |
| End/start/reset/delete session | Yes | Partial | Yes | No | High | Not visual verified | Service test | API E2E chưa đủ |
| Backup before delete | Yes | Yes | Yes | No | High | N/A | Unit | Chưa restore drill |
| Raw comment persistence | Yes | Partial | Yes | Yes | High | Implemented | Unit | JSON save failure can poison queue |
| CSV per session | Yes | Runtime | Yes | No | High | Implemented | HTTP smoke | Không chống spreadsheet formula |
| Question classifier scoring | Yes | Partial | Yes | No | High | Debug metadata | Unit + 30 corpus | F1 baseline 0.889 |
| `QUESTION_NEW` forced question | Yes | Yes | Yes | Yes | Medium | N/A | Unit | Event thật chưa test |
| Dedup session + user | Yes | Yes | Yes | No | High | Implemented | Unit | Possible-duplicate review UI thiếu |
| Conflict date/name/topic | Yes | Yes | Yes | No | Medium | N/A | Unit | Heuristic hạn chế |
| Occurrence retention | Yes | Yes | Yes | No | High | History details | Unit | Không pagination |
| Manual promote | Yes | Yes | Yes | No | Medium | Not visual verified | Unit/API fixture | Idempotent service |
| Manual question | Yes | Yes | Yes | No | Medium | Not visual verified | Unit/API fixture | Existing user validation yếu |
| Stable queue number | Yes | Yes | Yes | No | High | Not visual verified | Unit/metadata | Single-process only |
| Priority move/top/reset | Yes | Yes | Yes | No | Medium | Not visual verified | Unit/API fixture | UI không có reset |
| Archive/undo | API only | Partial | Yes | No | Low | Missing UI | Unit | Không có control frontend |
| Answer checkbox/undo | Yes | Partial | Yes | No | High | Not visual verified | State/unit | Browser/two-client thiếu |
| User aggregation | Yes | Broken edge | Yes | No | Medium | Implemented | Unit | Manual/promoted-only user bị lọc |
| Viewer current/peak/member | Yes | Partial | Yes | Yes | Medium | Not visual verified | Unit | Observed, không official |
| Socket session filtering | Yes | Partial | Yes | Yes | High | Implemented | State test | Two-client E2E thiếu |
| Responsive dashboard | Yes | Code only | Yes | No | Low | Not visual verified | None | Không browser runtime |
| Storage v6 migration | Yes | Yes | Yes | No | High | N/A | Unit + metadata | Không corrupt recovery |
| Atomic rename | Yes | Partial | Yes | No | High | N/A | Indirect | Không fsync/lock/multi-process |
| GitHub CI | Yes | Config only | Yes | No | Low | N/A | Node 22 config | Local Node 20 mismatch |
| GitHub Pages demo | Yes | Code only | Yes | No | Low | Separate demo | Workflow syntax | Không có backend |
| Authentication/authorization | No | No | N/A | No | Critical online | Missing | None | Bắt buộc trước online |
| Recoverable save queue | Yes | Yes offline | Yes | No | High | N/A | Fault injection | Write/rename retry verified |
| Restore/audit tooling | Yes | Yes offline | Yes | No | High | CLI | Restore drill | Dry-run default |
| Health/readiness | Yes | Yes runtime copy | Yes | No | Medium | JSON | API E2E | Redacted telemetry |
| Local bind/remote guard | Yes | Yes runtime copy | Yes | No | High | Config | Startup smoke | Remote UI token flow còn thiếu |
# Gift Tracking capability addendum

| Capability | Code/API test | Visual | LIVE |
|---|---:|---:|---:|
| Gift normalization, final-only persistence, dedupe | Yes | N/A | Pending |
| Gift-before-question link cho classifier/promote/manual | Yes | Pending | Pending |
| Priority resolver và manual pin | Yes | Pending | Pending |
| Attention workflow và transfer cùng user/session | Yes | Pending | Pending |
| Settings validation và two-tab sync | Yes | Pending | N/A |
| Aggregated auto-dismiss toast và highlight | Reducer/static verified | Pending | Pending |
