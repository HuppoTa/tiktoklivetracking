# Local Security Threat Model

Assets include comment text, TikTok identity, avatars, question/answer status, CSV and backups. Threat actors are another LAN user, malicious webpage causing requests, compromised local account, exposed backup, and spreadsheet formula payload.

Default boundary is `HOST=127.0.0.1`, `ALLOW_REMOTE_ACCESS=false`. Remote bind refuses startup without `AUTH_USERNAME` and an Argon2id `AUTH_PASSWORD_HASH`. Login creates a random, expiring server-side session; API and Socket.IO require its bearer token. A new login replaces the account's previous session. Passwords, hashes and session tokens must never be logged or committed. Basic response hardening and a 32 KB JSON limit are enabled.

Residual risks: there is one administrator role, login throttling is process-local, and the short-lived opaque token is held in `sessionStorage` because the Vercel and Render domains cannot reliably share a first-party HttpOnly cookie. HTTPS/WSS and the origin allowlist are required. XSS review remains important because JavaScript can read the current tab's session token.
