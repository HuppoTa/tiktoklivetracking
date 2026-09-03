# Privacy and Retention Policy (Draft)

- Treat comment text, numeric TikTok ID, nickname, avatar and any volunteered birth date as personal data.
- Store locally only for operating the selected LIVE session. Never commit `data/`, CSV, backups, `.env` or logs.
- CSV is an explicit operator export; keep it access-controlled and delete when no longer needed.
- Session deletion requires typed confirmation and a verified safety backup. Restore is explicit and creates a pre-restore copy.
- No automatic deletion is enabled by default. Recommended configurable policy: active/current sessions retained; ended sessions reviewed after 30 days; backups expire only after a successful restore window agreed by the operator.
- Logs and health telemetry must contain metadata/counters only, never raw comment or token.
- Do not expose on LAN/public internet without reviewed authentication, HTTPS/WSS, retention notice and operator consent workflow.

