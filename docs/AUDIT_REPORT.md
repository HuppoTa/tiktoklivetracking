# Full Product and Technical Audit

Ngày audit: 2026-09-02. Phạm vi là working tree local. Không có comment, identity hay ngày sinh runtime được trích vào tài liệu.

## 1. Executive Summary

Sản phẩm có core architecture hợp lý cho công cụ local một operator: event được normalize, chặn generation/session, lưu raw occurrence, tạo thread, queue/answered theo session và đồng bộ Socket.IO. Baseline 66/66 test pass; metadata v6 hiện không có orphan, duplicate ID/queue hoặc mismatch totals.

Tuy nhiên kết luận online là **NO-GO**. Các thay đổi quan trọng hiện chưa commit/push; LIVE và browser chưa được xác minh; runtime local sai major Node; JSON persistence có failure-mode nghiêm trọng; API không có auth và server mặc định nghe mọi interface. Manual/user metrics có bug xác định được. Test chủ yếu unit, thiếu API/realtime/browser/crash/load suites.

Audit 72 capability: 27 `VERIFIED`, 24 `PARTIAL`, 2 `BROKEN`, 12 `IMPLEMENTED_NOT_VERIFIED`, 7 `PLANNED_NOT_IMPLEMENTED`. Findings: P0=0, P1=6, P2=10, P3=7.

## 2. Current Product Scope

Node/Express/Socket.IO collector local nhận CHAT, QUESTION_NEW, ROOM_USER, MEMBER; quản lý target/session; normalize legacy/protobuf; classify/dedup; queue manual/priority; answered/user/viewer analytics; session history/reset/delete/export; vanilla JS dashboard. GitHub Pages chỉ là demo tĩnh riêng trong `docs/`.

Git evidence: HEAD và `origin/main` cùng `d9e97ce`; 19 production/test/doc files sửa và một test mới chưa tracked tại thời điểm audit. Do đó v6 session/manual workflow là **local-only**, chưa phải feature đã phát hành trên remote.

## 3. Architecture Preservation Map

| Layer | Owner | Input → output/state | Failure mode | Coverage/extension point |
|---|---|---|---|---|
| Connector | `server.js` | TikTok target → webcast events | offline/API drift | Fixture only; wrap telemetry, không replace connector |
| Normalization | `src/tiktok-normalizer.js` | legacy/v3 event → comment | field drift/timestamp | Unit; thêm adapter fixtures |
| Guard | `connection-guard.js`, `server.js:eventIsCurrent` | generation/room/session → accept/drop | late/dual event | Unit; giữ invariant |
| Persistence | `storage.js` | store object → atomic rename JSON | corrupt/queue poison/write amplification | Migration tests; cải thiện transaction |
| Classification | `question-detector.js`, `normalize.js` | text/event flag → score/reasons | FN/FP taxonomy | Small unit corpus; extend data-first |
| Dedup/thread | `question-service.js`, `similarity.js` | comment → thread/occurrence | wrong merge | Unit; giữ scope session+user |
| Queue | `question-service.js`, session counter | thread → queueNumber/priorityRank | race/multi-process | Unit; add concurrency test |
| Answered | service/server/UI | checkbox → answered/answeredAt | save failure/state divergence | Unit/state; add E2E |
| Analytics | `analytics.js` | threads/viewer events → summary | semantic/count drift | Unit |
| API/realtime | `server.js` | HTTP/socket → payload | auth, validation, ordering | Mostly no integration |
| Frontend state/UI | `dashboard-state.js`, `app.js`, `index.html` | state/events → DOM | stale/missed event/large render | State unit; browser missing |

Logic trùng: session scoping/counting ở `server.js`, `SessionService`, `QuestionService` và frontend; question metrics tính lại cả server lẫn browser; sort queue có ở service lẫn state module. Không nên thay raw comment identity, generation guard, thread/occurrence split hoặc answered source-of-truth.

## 4. Feature Inventory

| Feature | Status | Evidence | Test/runtime | Limitation | Risk |
|---|---|---|---|---|---|
| Target username/@/URL | VERIFIED | `target.js`, `target-input.js` | Unit | No LIVE connect proof | Low |
| Connect/reconnect/offline | PARTIAL | `connectTikTok`, guard | Guard unit | LIVE_NOT_VERIFIED | High |
| Initial history filtering | IMPLEMENTED_NOT_VERIFIED | `processInitialData:false`, timestamp tolerance | No connector integration | Library behavior unproven | High |
| Single current generation | VERIFIED offline | `ConnectionGuard`, `eventIsCurrent` | Unit | No real race/soak | High |
| Room/session lifecycle | PARTIAL | `SessionService` | Unit | Startup can add empty pending session | High |
| Historical session UI | IMPLEMENTED_NOT_VERIFIED | selector/state filtering | State unit | No visual test | Medium |
| Session delete/backup | PARTIAL | route + `backupSession` | Unit | No API failure/restore drill | High |
| CHAT/QUESTION_NEW normalize | VERIFIED fixture | normalizer | Unit | LIVE schema drift possible | Medium |
| Raw comment persistence | PARTIAL | add then save | Unit | failed save leaves memory divergent | High |
| Direct panel | IMPLEMENTED_NOT_VERIFIED | last 60 render | DOM audit | no pagination/search/visual | Medium |
| Classifier signs/topics/date | PARTIAL | deterministic score/reasons | Unit + baseline | narrow vocabulary/context | High |
| Greeting/emoji/date-only | VERIFIED baseline | negative rules | Unit | spam/tag variants incomplete | Medium |
| Taxonomy/context aggregation | PLANNED_NOT_IMPLEMENTED | absent | None | no review taxonomy/corpus | Medium |
| Exact/fuzzy/conflict dedup | VERIFIED offline | similarity/service | Unit | audit trail thin | High |
| Possible duplicate review UI | PLANNED_NOT_IMPLEMENTED | metadata only | None | operator cannot resolve | Medium |
| Occurrence retention | VERIFIED offline | commentIds/enrich | Unit/metadata | no orphan repair tool | High |
| Promote comment | VERIFIED fixture | API/service | Unit + isolated API | visual/two-client missing | Medium |
| Manual entry/unknown user | PARTIAL | service/API/modal | Unit + isolated API | identity validation and user list bug | Medium |
| Stable queue/FIFO | VERIFIED offline | v6 metadata/service | Unit + metadata | multi-process lock absent | High |
| Priority controls | PARTIAL | API/UI | Unit + isolated API | reset not exposed; visual missing | Medium |
| Archive/undo | PARTIAL | API/service | Unit | no UI | Low |
| Answer/undo/all/reset | PARTIAL | service/API/UI | Unit/state | no two-tab/API fault test | High |
| User aggregation | BROKEN | `getUsers` counts classifier comments | Unit misses manual-only | manual/promoted-only hidden/wrong | Medium |
| Viewer analytics | PARTIAL | analytics + events | Unit | LIVE semantic accuracy unknown | Medium |
| API read endpoints | VERIFIED runtime copy | routes | all HTTP 200 | no auth | High online |
| API mutation validation | PARTIAL | inline checks | selected isolated checks | inconsistent errors/rollback | High |
| Socket session filtering | PARTIAL | meta + `acceptsSessionEvent` | State unit | missed-event/two-client absent | High |
| Empty/error/rollback UI | PARTIAL | guards/banner/snapshot | State unit | visual/focus absent | Medium |
| Responsive/accessibility | IMPLEMENTED_NOT_VERIFIED | CSS/labels | code audit | no browser/keyboard test | Medium |
| Atomic JSON/migration v6 | PARTIAL | tmp rename/backups | Unit + metadata | no fsync/corrupt recovery/process lock | High |
| CI Node 22 | IMPLEMENTED_NOT_VERIFIED | `ci.yml` | config read | local not Node 22; uncommitted work not CI-run | Medium |
| Pages demo | IMPLEMENTED_NOT_VERIFIED | pages workflow/docs | code read | demo != backend | Low |
| Auth/privacy controls | BROKEN for online | absent | code audit | full read/mutation exposure | Critical online |
| Health/monitoring/retention | PLANNED_NOT_IMPLEMENTED | absent | None | operations blind | High |

## 5–8. Verified, Partial, Broken, Planned

Verified offline: normalization variants, target validation, generation timer cancellation, session/dedup invariants, answered persistence unit, queue numbering, migration idempotence, viewer calculations, metadata integrity. Partial: all connector/LIVE behavior, manual identity, API mutation durability, realtime multi-tab, UX, storage crash safety. Broken: user aggregation for non-classifier queue sources; online security boundary. Planned: duplicate review, representative classifier evaluation, pagination, health/monitoring, auth/retention and transactional storage decision.

## 9. Data Integrity Audit

Read-only result: schema 6; 21 sessions; 4,459 comments; 496 threads; 1,783 occurrence references; 429 answered; 67 active unanswered/non-archived; store 6,894,840 bytes. Orphan session/comment/thread/reference=0; duplicate comment/thread/queue IDs=0; missing session/user IDs=0; invalid dates=0; epoch-1970=0; session summary mismatch=0; bad nextQueueNumber=0. No raw fields were emitted. This is a point-in-time structural audit, not proof of semantic correctness.

## 10–14. Domain Audits

- Session: guard design matches preservation rules; same-room/new-room tests pass. LIVE transition and initial-data cutoff remain unverified. Startup calls `ensurePending`, so repeated restarts after ended state can create empty sessions.
- Classifier: synthetic 30-case baseline TP=12, FP=0, TN=15, FN=3; precision 1.000, recall .800, F1 .889. Corpus is intentionally small/non-representative. No taxonomy version/evaluation artifact or context aggregation.
- Dedup: scoped to session+user with date/name/topic conflict tests. Possible duplicates have metadata but no resolution UI/audit action.
- Manual queue: promote/manual/queue/priority work in unit and isolated API. `getUsers()` derives `totalQuestions` from `comment.question`; manual comments are false and promoted misses remain false, then users with zero are filtered. Existing manual `userId` is not proven to belong to session.
- Answered: boolean is source of truth and rollback helper exists. Several server mutations change memory before save without rollback; two-client behavior is not tested.
- Viewer: current/peak/member/sample persistence unit-tested; correctly labelled observed. No chart; up to 1,000 samples/session plus 5,000 member message IDs.

## 15. API Audit

Implemented routes match requested inventory plus `PATCH /api/questions/:id/archive`. Read-only routes returned 200 on an isolated copy. Session lookup returns 404 rather than all-data fallback. Major gaps: no authentication/CSRF/rate limit; error shapes vary; validation is inline; several awaits have no rollback; manual `userId` authorization is weak; no health route; whole arrays returned without pagination. CSV is session-scoped but formula injection and access control are absent.

## 16. Socket.IO Audit

Server emits status, comment, question created/updated/promoted/manual/priority, user/viewer, session lifecycle and target events. Domain payloads generally add session metadata; frontend rejects different-session comment/question/user/viewer events. `queue:updated` is emitted but frontend does not subscribe; it relies on detailed events. No sequence/version, room-based socket subscription, ack, replay or two-client integration tests; missed events recover only through selected session reload paths.

## 17. Frontend/UX Audit

Escaping is consistently applied to text before `innerHTML`; fallback avatar, error banner, empty states and render try/catch reduce white-screen risk. Limitations: full session payload in memory, O(n²)-like lookups/render paths, only 60 direct comments shown, no queue pagination, archive/reset-priority UI absent, manual modal users incomplete, focus restoration/loading semantics weak, and no visual/mobile/keyboard/console verification. Status: `IMPLEMENTED_NOT_VERIFIED` visually.

## 18. Storage/Migration Audit

Migration backups and tmp-file rename exist, and v6 structural audit is clean. Risks: JSON parse failure prevents boot with no automatic recovery; no fsync; no cross-process lock; full 6.9 MB file rewrite per saved comment; `save()` chains on a promise that remains rejected after one write failure; most mutations occur before durable save; backup retention is unbounded. SQLite is a candidate only after measurement/ADR, not an immediate rewrite.

## 19. Security/Privacy Audit

Runtime holds comments, stable user IDs, display data, avatar URLs and exports/backups. `data/` and `.env*` are ignored (except example), but no auth, authorization, CSRF, CORS policy, rate limiting, privacy notice or retention policy exists. Express listen defaults to all interfaces; local LAN peers may reach APIs depending on firewall. CSV formula cells are not neutralized. Do not expose this server online or over an untrusted LAN.

## 20. Performance/Scalability Audit

Current store is ~6.9 MB. Each comment can scan comments/threads and serialize the entire store. Frontend receives entire selected session and repeatedly filters arrays. No load/soak budgets, pagination, index or backpressure. Suitable only for modest single-process local sessions until measured.

## 21. Operations/Deployment Audit

Package requires Node ≥22; audit host is Node 20.20.2/npm 10.8.2 and emits EBADENGINE for project/dependencies, although tests pass. No process manager, health endpoint, structured logs, restart policy, monitoring or restore drill. GitHub CI declares Node 22. Pages publishes static `docs/` only and cannot host collector/WebSocket/backend/persistent JSON. Online requires authenticated long-running Node hosting, WSS/HTTPS and transactional persistent storage.

## 22. Test Coverage Gaps

66 tests pass, mainly unit/state/fixtures. Missing: route-level comprehensive validation, failure injection, concurrent queue allocation, Socket.IO two-client ordering/recovery, browser E2E, LIVE smoke, long soak/load, corrupt JSON/crash/restart, backup restore, security/CSV tests and Node matrix. Fixtures are synthetic; no test mutates the real store.

## 23. Findings P0–P3

| ID | Sev | Evidence/root cause | Impact/data | Reproduction | Fix | Effort | Dependency | Confidence | Regression test |
|---|---|---|---|---|---|---|---|---|---|
| F-01 | P1 | `storage.save` promise stays rejected | Later writes cannot persist | inject write failure then retry | recover queue + rollback | M | none | HIGH | fault retry |
| F-02 | P1 | Mutations precede save; rollback inconsistent | memory/disk divergence | fail save on answer/manual | transaction wrapper | M | F-01 | HIGH | endpoint rollback |
| F-03 | P1 | No auth; listen all interfaces | PII export/destructive calls | access from LAN | loopback/auth/CSRF | M | threat model | HIGH | unauthorized suite |
| F-04 | P1 | LIVE path never verified in audit | core capture may drift | real smoke protocol | redacted telemetry/smoke | M | Node 22 | HIGH | connector fixtures + manual |
| F-05 | P1 | Node 20 vs required 22 | unsupported runtime | `npm install` warning | standardize Node 22 | XS | none | HIGH | CI matrix |
| F-06 | P1 | No restore/corrupt/crash safety | recovery uncertainty | corrupt/truncate copy | recovery + drill | M | F-01 | HIGH | crash/restore |
| F-07 | P2 | `getUsers` ignores manual/promoted questions | queue user missing/wrong counts | manual-only fixture | derive from threads/occurrences | S | none | HIGH | source variants |
| F-08 | P2 | Manual existing userId not session-validated | synthetic cross-session identity | submit arbitrary ID | canonical lookup | S | F-07 | HIGH | invalid identity API |
| F-09 | P2 | Possible duplicate no decision UI | operator cannot correct | create score .60–.84 | review/merge/separate | M | audit model | HIGH | browser/API |
| F-10 | P2 | No two-client socket E2E/sequence | stale tabs/missed order | concurrent clients | versions/refresh tests | M | test harness | MEDIUM | two-client |
| F-11 | P2 | JSON full rewrite at 6.9 MB | latency/data-loss window | soak high comments | measure/index/storage ADR | L | harness | HIGH | soak/crash |
| F-12 | P2 | CSV formula neutralization absent | spreadsheet injection | fixture starting `=` | prefix/escape | S | none | HIGH | CSV security |
| F-13 | P2 | Startup can create empty pending sessions | history clutter | restart after ended | reuse pending policy | S | LIVE lifecycle | MEDIUM | restart sequence |
| F-14 | P2 | Archive API has no UI | incomplete workflow | inspect DOM | add guarded control | S | UX | HIGH | browser |
| F-15 | P2 | No pagination/virtualization | slow/large memory | large fixture | pagination/index | L | load test | HIGH | 50k E2E |
| F-16 | P2 | Visual/a11y unverified | operator errors possible | browser audit unavailable | E2E WCAG pass | M | browser CI | HIGH | Playwright |
| F-17 | P3 | Sort/metrics/session logic duplicated | drift risk | compare modules | shared contracts | M | tests | HIGH | contract tests |
| F-18 | P3 | Error shapes inconsistent | brittle UI/debugging | invalid routes | common error middleware | S | none | HIGH | API schema |
| F-19 | P3 | `queue:updated` unused client-side | redundant event | inspect listeners | remove or use refresh | XS | socket design | HIGH | event contract |
| F-20 | P3 | Backup cleanup absent | disk growth/privacy | list backups over time | retention policy | S | privacy | HIGH | cleanup test |
| F-21 | P3 | Viewer arrays bounded per session only | lifetime growth | many sessions | retention/archive | M | policy | MEDIUM | storage growth |
| F-22 | P3 | No health/structured logs | poor operations | inspect routes/logs | health + redaction | S | R1 | HIGH | health test |
| F-23 | P3 | Pages demo can be mistaken for product | expectation risk | compare docs/public | explicit banner/version | XS | none | HIGH | content test |

## 24. Known Limitations

Single process/local trust boundary; no auth; no transaction DB; no browser/LIVE proof; heuristic classifier; no duplicate review; incomplete manual user metrics; full-session payload/render; observed viewer numbers only; static Pages demo cannot collect LIVE.

## 25. Go/No-Go

**NO-GO online.** Preconditions: close all P1, run Node 22, real LIVE smoke, two-client/browser E2E, storage fault/restore/load tests, auth/privacy/retention decision, persistent transactional storage, TLS/WSS, health/monitoring. Local use is conditional on loopback/firewall, backups and operator awareness.

## 26. Recommended Next Steps

Start Phase 0: F-01/F-02/F-05/F-06. Then Phase 1 LIVE telemetry/smoke. Repair F-07/F-08 before expanding manual workflow. Do not rewrite frameworks or adopt AI classifier yet. See `ENHANCEMENT_ROADMAP.md` and `PRIORITIZED_BACKLOG.md`.

## Remediation update — 2026-09-02

Offline fixes verified: recoverable write/rename queue, draft transaction primitive, restore/audit tools and drill, health/readiness, redacted connector telemetry, loopback default/remote token guard, manual-only aggregation, session-canonical manual identity, request idempotency, two-client manual Socket.IO event, CSV formula neutralization, archive/undo control, 360-case development/holdout corpus and synthetic 1k/10k/50k benchmark.

Remaining P1: F-02 is incomplete until every production mutation uses the transaction boundary; F-04 remains `LIVE_NOT_VERIFIED`; F-05 remains blocked because this host has Node 20 rather than Node 22. Online conclusion remains **NO-GO**.
# Gift Tracking remediation note — 2026-09-03

Root causes đã xử lý: `/api/analytics` thiếu gift inputs; promote/manual mutate trước save và không auto-link; backend/frontend priority khác nhau; settings chấp nhận field/value không hợp lệ; client gift handler dereference selected session null; thiếu transient notification state. Kiến trúc connector/session guard, raw comments, classifier, stable queue number và JSON atomic persistence được giữ nguyên.

Notification không lưu storage, không replay từ `/api/state`, gom theo `sessionId + userId + giftId`, dedupe `eventId`, FIFO overflow tối đa bốn item và clear khi đổi session. LIVE/visual verification vẫn là open evidence item.
