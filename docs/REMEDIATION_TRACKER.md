# Remediation Tracker

Updated 2026-09-02. `FIXED_OFFLINE` is not LIVE/visual verification.

| Finding | Severity | Root cause | Fix | Files | Tests | Status | Evidence |
|---|---|---|---|---|---|---|---|
| F-01 save queue poison | P1 | rejected promise reused | resilient queue + health counters | `storage.js` | write/rename injection | FIXED_OFFLINE | fail then retry passes |
| F-02 mutation rollback | P1 | direct canonical mutation | draft transaction primitive added | `storage.js` | transaction rename failure | IN_PROGRESS | primitive verified; all server callers not migrated |
| F-03 exposure/auth | P1 | default wildcard bind/no auth | loopback default; remote token guard; headers | `server.js`, `.env.example` | runtime smoke pending full auth suite | FIXED_OFFLINE | remote without token refuses start |
| F-04 LIVE evidence | P1 | account-dependent | redacted telemetry + protocol | `server.js`, `LIVE_SMOKE_TEST.md` | guard unit | BLOCKED | LIVE_NOT_VERIFIED |
| F-05 Node mismatch | P1 | host Node 20 | `.nvmrc`, runtime check, CI 22 | config/docs | source checks on Node 20 | BLOCKED | Node 22 unavailable locally |
| F-06 restore/crash | P1 | no tools/drill | verify/restore/audit tools | `scripts/` | isolated restore drill | FIXED_OFFLINE | restored 4,459/496 copy cleanly |
| F-07 user aggregation | P2 | counted only `comment.question` | union comments+threads; source stats | `question-service.js` | manual-only regression | FIXED_OFFLINE | test pass |
| F-08 manual identity | P2 | trusted client userId | canonical session lookup + retry key | `server.js`, service | API E2E/unit | FIXED_OFFLINE | cross-session/unknown rejected |
| F-09 duplicate review | P2 | no operator decision UI | existing link confirmation retained | frontend/service | manual duplicate unit | IN_PROGRESS | full accessible 3-way modal missing |
| F-10 two-client socket | P2 | no integration harness | isolated two-client test | `api-socket-e2e.test.js` | two clients/manual event | FIXED_OFFLINE | both clients same ID/session |
| F-11 JSON scaling | P2 | whole-store rewrite | benchmark + ADR | benchmark/ADR | 1k/10k/50k | ACCEPTED_LIMITATION | prepare SQLite, no migration |
| F-12 CSV formula | P2 | raw cell prefix | apostrophe neutralization | `server.js` | API CSV test | FIXED_OFFLINE | BOM/formula pass |
| F-13 empty startup session | P2 | ensurePending on boot | not changed pending LIVE semantics | session/server | existing lifecycle | OPEN | needs product rule |
| F-14 archive UI | P2 | API-only | source-scoped archive + toast undo | `app.js` | service test | IMPLEMENTED_NOT_VERIFIED | browser unavailable |
| F-15 pagination | P2 | full payload/render | measured only | benchmark | 50k backend harness | OPEN | browser payload/render missing |
| F-16 visual/a11y | P2 | no browser runtime | E2E spec retained | docs | none | BLOCKED | browser runtime unavailable |
| F-17 duplicated logic | P3 | server/service/UI derivations | no refactor yet | — | — | OPEN | avoid during safety stage |
| F-18 error shapes | P3 | inline handlers | auth errors structured only | server | API subset | IN_PROGRESS | common middleware missing |
| F-19 unused queue event | P3 | client detailed-event strategy | documented, unchanged | — | two-client subset | ACCEPTED_LIMITATION | harmless redundancy |
| F-20 backup cleanup | P3 | no retention policy | draft policy, no auto-delete | privacy doc | none | ACCEPTED_LIMITATION | explicit opt-in required |
| F-21 viewer lifetime growth | P3 | per-session bounds | policy/ADR only | docs | analytics unit | OPEN | multi-session soak missing |
| F-22 health/logging | P3 | no endpoints | health/ready + telemetry | `server.js` | API E2E | FIXED_OFFLINE | readiness 200 on copy |
| F-23 Pages confusion | P3 | static/backend split | existing README warning | README/docs | none | FIXED_OFFLINE | documentation evidence |

