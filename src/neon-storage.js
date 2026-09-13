import { neon } from "@neondatabase/serverless";
import { buildStore, JsonStorage, SCHEMA_VERSION } from "./storage.js";

const STATE_ID = 1;

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS app_state (
    id smallint PRIMARY KEY CHECK (id = 1),
    schema_version integer NOT NULL,
    state jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`;

const CREATE_BACKUPS_TABLE = `
  CREATE TABLE IF NOT EXISTS session_backups (
    id bigserial PRIMARY KEY,
    session_id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )
`;

export class NeonStorage {
  constructor({ databaseUrl, sql }) {
    if (!databaseUrl && !sql) throw new Error("DATABASE_URL_REQUIRED");
    this.sql = sql || neon(databaseUrl);
    this.store = buildStore();
    this.queue = Promise.resolve();
    this.pendingTransactions = 0;
    this.savePromise = null;
    this.saveRequested = false;
    this.health = {
      lastSaveAt: null,
      lastSaveErrorAt: null,
      consecutiveSaveFailures: 0,
      storageHealthy: true,
      loadHealthy: true,
      invariantErrors: [],
    };
    this.validator = new JsonStorage({
      storeFile: "/tmp/neon-storage-unused.json",
      legacyFile: "/tmp/neon-storage-unused-legacy.json",
    });
  }

  async initialize() {
    await this.execute(CREATE_TABLE);
    await this.execute(CREATE_BACKUPS_TABLE);
    const rows = await this.sql`
      SELECT state
      FROM app_state
      WHERE id = ${STATE_ID}
      LIMIT 1
    `;
    if (rows[0]?.state) {
      const parsed = typeof rows[0].state === "string" ? JSON.parse(rows[0].state) : rows[0].state;
      this.store = buildStore(parsed.comments || [], parsed);
      this.health.loadHealthy = true;
      this.health.storageHealthy = true;
      return this.store;
    }
    await this.save();
    return this.store;
  }

  execute(query) {
    return this.sql.query ? this.sql.query(query) : this.sql(query);
  }

  load() {
    return this.initialize();
  }

  validate(candidate = this.store) {
    this.validator.store = candidate;
    const result = this.validator.validate(candidate);
    this.health.invariantErrors = result.errors;
    return result;
  }

  async persist(candidate) {
    const check = this.validate(candidate);
    if (!check.ok) throw new Error(`STORE_INVARIANT_FAILED:${check.errors.join(",")}`);
    try {
      await this.sql`
        INSERT INTO app_state (id, schema_version, state, updated_at)
        VALUES (${STATE_ID}, ${SCHEMA_VERSION}, ${JSON.stringify(candidate)}::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET
          schema_version = EXCLUDED.schema_version,
          state = EXCLUDED.state,
          updated_at = EXCLUDED.updated_at
      `;
      this.health.lastSaveAt = new Date().toISOString();
      this.health.consecutiveSaveFailures = 0;
      this.health.storageHealthy = true;
    } catch (error) {
      this.health.lastSaveErrorAt = new Date().toISOString();
      this.health.consecutiveSaveFailures += 1;
      this.health.storageHealthy = false;
      throw error;
    }
  }

  enqueue(operation) {
    const current = this.queue.then(operation, operation);
    this.queue = current.catch(() => undefined);
    return current;
  }

  save() {
    this.saveRequested = true;
    if (this.savePromise) return this.savePromise;
    this.savePromise = (async () => {
      while (this.saveRequested) {
        this.saveRequested = false;
        const snapshot = structuredClone(this.store);
        await this.enqueue(() => this.persist(snapshot));
      }
    })().finally(() => {
      this.savePromise = null;
      if (this.saveRequested) void this.save();
    });
    return this.savePromise;
  }

  mutate(mutator) {
    return this.enqueue(async () => {
      this.pendingTransactions += 1;
      try {
        const draft = structuredClone(this.store);
        const result = await mutator(draft);
        draft.stateRevision = Math.max(0, Number(draft.stateRevision) || 0) + 1;
        await this.persist(draft);
        for (const key of Object.keys(this.store)) delete this.store[key];
        Object.assign(this.store, draft);
        return result;
      } finally {
        this.pendingTransactions -= 1;
      }
    });
  }

  readiness() {
    const validation = this.validate();
    return {
      // An in-flight write is normal while a LIVE is active. Marking the
      // service unready here makes the platform recycle a healthy process
      // whenever comments or operator actions are being persisted.
      ready: this.health.loadHealthy && this.health.storageHealthy && validation.ok,
      ...this.health,
      pendingTransactions: this.pendingTransactions,
    };
  }

  async backupSession(sessionId) {
    const session = this.store.sessions.find(item => item.id === sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      session,
      comments: this.store.comments.filter(item => item.sessionId === sessionId),
      questionThreads: this.store.questionThreads.filter(item => item.sessionId === sessionId),
      gifts: this.store.gifts.filter(item => item.sessionId === sessionId),
      giftAttention: this.store.giftAttention.filter(item => item.sessionId === sessionId),
    };
    await this.sql`
      INSERT INTO session_backups (session_id, payload)
      VALUES (${sessionId}, ${JSON.stringify(payload)}::jsonb)
    `;
    return {
      sessionId,
      commentCount: payload.comments.length,
      questionCount: payload.questionThreads.length,
    };
  }
}

export const NEON_SCHEMA = `
CREATE TABLE IF NOT EXISTS app_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  schema_version integer NOT NULL,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_backups (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
