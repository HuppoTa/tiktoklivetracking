import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";

const tokenHash = token => createHash("sha256").update(String(token)).digest("hex");
const agentHash = value => createHash("sha256").update(String(value || "unknown")).digest("hex");

export class MemorySessionRepository {
  constructor() { this.session = null; }
  async initialize() {}
  async replace(session) { this.session = { ...session }; }
  async find(hash) { return this.session?.tokenHash === hash ? { ...this.session } : null; }
  async revoke(hash) { if (!hash || this.session?.tokenHash === hash) this.session = null; }
}

export class NeonSessionRepository {
  constructor(sql) { this.sql = sql; }
  async initialize() {
    await (this.sql.query ? this.sql.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        username text PRIMARY KEY,
        token_hash text UNIQUE NOT NULL,
        user_agent_hash text NOT NULL,
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL
      )
    `) : this.sql(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        username text PRIMARY KEY,
        token_hash text UNIQUE NOT NULL,
        user_agent_hash text NOT NULL,
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL
      )
    `));
  }
  async replace(session) {
    await this.sql`
      INSERT INTO auth_sessions (username, token_hash, user_agent_hash, created_at, expires_at)
      VALUES (${session.username}, ${session.tokenHash}, ${session.userAgentHash}, ${session.createdAt}, ${session.expiresAt})
      ON CONFLICT (username) DO UPDATE SET
        token_hash = EXCLUDED.token_hash,
        user_agent_hash = EXCLUDED.user_agent_hash,
        created_at = EXCLUDED.created_at,
        expires_at = EXCLUDED.expires_at
    `;
  }
  async find(hash) {
    const rows = await this.sql`
      SELECT username, token_hash, user_agent_hash, created_at, expires_at
      FROM auth_sessions WHERE token_hash = ${hash} LIMIT 1
    `;
    const row = rows[0];
    return row ? {
      username: row.username,
      tokenHash: row.token_hash,
      userAgentHash: row.user_agent_hash,
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
    } : null;
  }
  async revoke(hash) {
    if (hash) await this.sql`DELETE FROM auth_sessions WHERE token_hash = ${hash}`;
  }
}

export class AuthService {
  constructor({ username, passwordHash, repository = new MemorySessionRepository(), ttlMs = 8 * 60 * 60 * 1000, now = Date.now }) {
    this.username = String(username || "").trim();
    this.passwordHash = String(passwordHash || "").trim();
    this.repository = repository;
    this.ttlMs = ttlMs;
    this.now = now;
    this.enabled = Boolean(this.username && this.passwordHash);
  }
  async initialize() { if (this.enabled) await this.repository.initialize(); }
  async login({ username, password, userAgent }) {
    if (!this.enabled || String(username || "").trim() !== this.username) {
      if (this.passwordHash) await argon2.verify(this.passwordHash, String(password || "")).catch(() => false);
      return null;
    }
    const valid = await argon2.verify(this.passwordHash, String(password || "")).catch(() => false);
    if (!valid) return null;
    const token = randomBytes(32).toString("base64url");
    const createdAt = new Date(this.now()).toISOString();
    const expiresAt = new Date(this.now() + this.ttlMs).toISOString();
    await this.repository.replace({ username: this.username, tokenHash: tokenHash(token), userAgentHash: agentHash(userAgent), createdAt, expiresAt });
    return { token, username: this.username, expiresAt };
  }
  async authenticate(token, userAgent) {
    if (!this.enabled || !token) return null;
    const hash = tokenHash(token);
    const session = await this.repository.find(hash);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() <= this.now() || session.userAgentHash !== agentHash(userAgent)) {
      await this.repository.revoke(hash);
      return null;
    }
    return { username: session.username, expiresAt: session.expiresAt, tokenHash: hash };
  }
  async logout(token) { if (token) await this.repository.revoke(tokenHash(token)); }
}

export class LoginRateLimiter {
  constructor({ maxAttempts = 5, windowMs = 15 * 60 * 1000, now = Date.now } = {}) { this.maxAttempts=maxAttempts;this.windowMs=windowMs;this.now=now;this.entries=new Map(); }
  key(ip, username) { return `${String(ip || "unknown")}:${String(username || "").trim().toLowerCase()}`; }
  check(ip, username) { const key=this.key(ip,username),entry=this.entries.get(key);if(!entry||entry.resetAt<=this.now()){this.entries.delete(key);return {allowed:true,retryAfterMs:0}}return {allowed:entry.count<this.maxAttempts,retryAfterMs:Math.max(0,entry.resetAt-this.now())}; }
  fail(ip, username) { const key=this.key(ip,username),current=this.entries.get(key);const entry=!current||current.resetAt<=this.now()?{count:0,resetAt:this.now()+this.windowMs}:current;entry.count++;this.entries.set(key,entry); }
  clear(ip, username) { this.entries.delete(this.key(ip,username)); }
}

export async function hashPassword(password) {
  return argon2.hash(String(password), { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}
