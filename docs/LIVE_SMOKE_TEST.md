# LIVE Smoke Test Protocol

Current status: **LIVE_NOT_VERIFIED**.

1. Use Node 22 and create a verified backup; run metadata audit.
2. Start one collector on loopback and record only generation, session ID, room-presence and timestamps.
3. Confirm active connection count is one and `/api/ready` is healthy.
4. Confirm new events carry current session/room/generation and no event before collector cutoff is stored.
5. Safely interrupt/reconnect: same room must keep session; stale generation counters may rise but cannot mutate data.
6. On a new room, prior session must end and a new session start.
7. Never print comment text, identity, date of birth or perform reset/delete during smoke test.

