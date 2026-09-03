# Local Security Threat Model

Assets include comment text, TikTok identity, avatars, question/answer status, CSV and backups. Threat actors are another LAN user, malicious webpage causing requests, compromised local account, exposed backup, and spreadsheet formula payload.

Default boundary is `HOST=127.0.0.1`, `ALLOW_REMOTE_ACCESS=false`. Remote bind or explicit remote mode refuses startup without `APP_AUTH_TOKEN`; API and Socket.IO then require a bearer/handshake token. Token must never be logged or committed. Basic response hardening and 32 KB JSON limit are enabled. This is defense-in-depth for local use, not production-grade identity/authorization.

Residual risks: frontend has no token-entry flow, no per-role authorization, TLS, rate limiter, origin allowlist or audit identity. Consequently online exposure remains NO-GO. Bearer token avoids cookie-CSRF, but token storage/distribution and XSS review are required before remote use.

