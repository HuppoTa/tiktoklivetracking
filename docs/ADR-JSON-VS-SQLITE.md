# ADR: JSON vs SQLite

Status: **PREPARE_SQLITE**, no migration authorized.

Current evidence: schema v6, single Node process, 4,459 comments at audit baseline, store around 6.9 MB, atomic rename and backups. JSON keeps deployment simple and current data compatible, but rewrites the entire store, lacks process locking and makes transactional rollback/crash recovery difficult.

Decision: keep JSON for the current local release while closing recoverability and measuring soak behavior. Prepare a separate SQLite phase if 50k benchmark/long-session latency exceeds budgets, online/multi-process operation is required, or transaction durability remains unacceptable. Any SQLite migration needs user approval, idempotent backup/restore and dual-format verification.
