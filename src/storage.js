import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeText } from "./normalize.js";
import { isQuestion } from "./question-detector.js";
import { QuestionService } from "./question-service.js";
import { createViewerState } from "./analytics.js";
import { DEFAULT_TARGET, normalizeTargetInput, recentTargets } from "./target.js";

export const SCHEMA_VERSION = 4;

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

export function migrateLegacyComment(comment, defaults = {}) {
  const username = String(comment.username || comment.user || "unknown");
  const userId = String(comment.userId || `legacy:${username}`);
  const text = String(comment.text || "");
  return {
    ...comment,
    sessionId: String(comment.sessionId || defaults.sessionId || "session-migrated"),
    targetUsername: String(comment.targetUsername || defaults.targetUsername || DEFAULT_TARGET),
    id: String(comment.id),
    timestamp: comment.timestamp || new Date(0).toISOString(),
    userId,
    username,
    nickname: String(comment.nickname || username),
    avatar: String(comment.avatar || ""),
    text,
    normalizedText: comment.normalizedText || normalizeText(text),
    question: Boolean(comment.question) || isQuestion(text)
  };
}

export function buildStore(comments = [], metadata = {}) {
  const targetUsername = normalizeTargetInput(metadata.settings?.targetUsername) || DEFAULT_TARGET;
  const sessions = Array.isArray(metadata.sessions) ? metadata.sessions.map(session => ({ ...session, viewerAnalytics: createViewerState(session.viewerAnalytics) })) : [];
  if (!sessions.length && comments.length) sessions.push({ id: "session-migrated", targetUsername, roomId: metadata.viewerAnalytics?.roomId || null, startedAt: comments[0]?.timestamp || new Date(0).toISOString(), connectedAt: null, endedAt: null, endReason: null, status: "offline", viewerAnalytics: createViewerState(metadata.viewerAnalytics) });
  const activeSessionId = metadata.activeSessionId || sessions.find(session => !session.endedAt)?.id || null;
  const store = {
    schemaVersion: SCHEMA_VERSION, comments: [], questionThreads: [], sessions, activeSessionId,
    settings: { targetUsername, recentTargets: recentTargets(metadata.settings?.recentTargets, targetUsername) }
  };
  const service = new QuestionService(store);
  for (const raw of comments) service.addComment(migrateLegacyComment(raw, { sessionId: activeSessionId || "session-migrated", targetUsername }));
  return store;
}

export class JsonStorage {
  constructor({ storeFile, legacyFile }) {
    this.storeFile = storeFile;
    this.legacyFile = legacyFile;
    this.store = buildStore();
    this.queue = Promise.resolve();
  }

  async load() {
    await mkdir(dirname(this.storeFile), { recursive: true });
    if (await exists(this.storeFile)) {
      const parsed = JSON.parse(await readFile(this.storeFile, "utf8"));
      this.store = buildStore(parsed.comments || [], parsed);
      const oldThreads = new Map((parsed.questionThreads || []).map(thread => [thread.id, thread]));
      for (const thread of this.store.questionThreads) {
        const exact = [...oldThreads.values()].find(old => old.userId === thread.userId && old.normalizedText === thread.normalizedText && (!old.sessionId || old.sessionId === thread.sessionId));
        if (exact) Object.assign(thread, { id: exact.id, answered: Boolean(exact.answered), answeredAt: exact.answeredAt || null });
      }
      this.store.schemaVersion = SCHEMA_VERSION;
      await this.save();
      return this.store;
    }

    if (await exists(this.legacyFile)) {
      const backup = `${this.legacyFile}.v1.backup.json`;
      if (!(await exists(backup))) await copyFile(this.legacyFile, backup);
      const legacy = JSON.parse(await readFile(this.legacyFile, "utf8"));
      this.store = buildStore(Array.isArray(legacy) ? legacy : legacy.comments || []);
      await this.save();
      return this.store;
    }

    await this.save();
    return this.store;
  }

  save() {
    this.queue = this.queue.then(async () => {
      const temporaryFile = join(dirname(this.storeFile), `.${this.storeFile.split("/").at(-1)}.tmp`);
      await writeFile(temporaryFile, JSON.stringify(this.store, null, 2));
      await rename(temporaryFile, this.storeFile);
    });
    return this.queue;
  }
}
