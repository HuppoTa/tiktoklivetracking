# Enhancement Roadmap

Roadmap này trace trực tiếp tới findings trong `AUDIT_REPORT.md`; nguyên tắc là enhance kiến trúc hiện tại.

| ID | Enhancement | Problem solved | Priority | Effort | Dependencies | Risk | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| R0-1 | Fault-injection storage baseline | F-01/F-02 | P1 | M | Node 22 | Medium | Save retry/rollback/corrupt-load tests pass |
| R0-2 | Metadata auditor + restore drill | F-03 | P1 | S | R0-1 | Low | Zero orphan/duplicate; restore verified |
| R0-3 | Freeze v6 regression corpus | Uncommitted baseline | P1 | S | None | Low | CI reproduces 66 tests + API suite |
| R1-1 | Connection/session telemetry | F-04/F-05 | P1 | M | R0 | Medium | One generation/connection observable without PII |
| R1-2 | LIVE smoke protocol | F-04 | P1 | S | R1-1 | Medium | Same-room reconnect and new-room transition evidenced |
| R1-3 | Health/readiness endpoint | F-06 | P2 | S | R1-1 | Collector/storage/room status exposed safely |
| R2-1 | 300+ synthetic classifier corpus | F-07 | P2 | M | R0 | Low | Per-topic precision/recall/F1 report |
| R2-2 | Expand teencode/taxonomy conservatively | F-07 | P2 | M | R2-1 | Medium | Recall improves without FP budget regression |
| R2-3 | Review queue/context experiment | F-08 | P2 | L | R2-1 | Medium | Explicit merge evidence, no raw loss |
| R3-1 | Repair manual identity/user metrics | F-09 | P1 | S | R0 | Low | Manual/promoted-only users visible and counted |
| R3-2 | Queue concurrency and rollback | F-10 | P1 | M | R0-1 | Medium | Parallel requests unique; failed save unchanged |
| R3-3 | Archive/duplicate UX + two-tab E2E | F-11 | P2 | M | R3-1 | Medium | UI, keyboard, socket recovery pass |
| R4-1 | Session lifecycle API integration | F-12 | P1 | M | R0-1 | High | End/start/reset/delete isolated E2E pass |
| R4-2 | History/export privacy | F-13 | P1 | M | Auth decision | Medium | Session authorization and safe CSV pass |
| R4-3 | Retention/backup cleanup | F-14 | P2 | M | R4-2 | Medium | Policy and automated safe cleanup/restore |
| R5-1 | Browser accessibility/mobile pass | F-15 | P2 | M | R3 | Low | No console error; keyboard/mobile/two-tab pass |
| R5-2 | Pagination/virtual list | F-16 | P2 | L | Load harness | Medium | 50k data stays within budgets |
| R6-1 | JSON vs SQLite ADR | F-17 | P2 | M | Soak results | Low | Transaction/locking/backup decision documented |
| R6-2 | Transactional storage migration | F-17 | P2 | L | R6-1 | High | Idempotent migration + rollback + restore |
| R7-1 | Auth/privacy threat model | F-18/F-19 | P1 | M | Product scope | High | Roles, retention, consent, audit log approved |
| R7-2 | HTTPS/WSS persistent deployment | F-20 | P1 | L | R7-1,R6 | High | Auth, TLS, persistent volume, monitoring pass |
| R7-3 | CI/CD release gates | F-21 | P2 | M | All prior | Medium | Automated readiness checklist blocks unsafe release |

## Phase order

0. Data Safety and Regression Baseline: R0.
1. LIVE Reliability: R1.
2. Question Capture Quality: R2.
3. Queue Operations: R3.
4. Session and History: R4.
5. UX and Performance: R5.
6. Storage Upgrade: R6 only if measured scale justifies it.
7. Online Deployment Readiness: R7.
# Gift Tracking milestone

Implementation milestone hoàn tất ở mức code/API test trên schema v7. Gate tiếp theo là visual verification và LIVE connector smoke test; không nâng schema chỉ cho toast/highlight transient. Public hosting vẫn ngoài phạm vi và `NO-GO` cho đến khi authentication và deployment safety được giải quyết.
