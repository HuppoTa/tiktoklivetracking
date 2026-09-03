import { access, copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join } from "node:path";
import { normalizeText } from "./normalize.js";
import { classifyQuestion } from "./question-detector.js";
import { QuestionService } from "./question-service.js";
import { createViewerState } from "./analytics.js";
import { DEFAULT_TARGET, normalizeTargetInput, recentTargets } from "./target.js";
import { DEFAULT_GIFT_SETTINGS } from "./gift-service.js";

export const SCHEMA_VERSION = 7;
export const LEGACY_SESSION_ID = "legacy-session-v2";
const defaultFs = { access, copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile };
async function exists(path) { try { await access(path, constants.F_OK); return true; } catch { return false; } }

async function recoverFromBackup(filePath, fs = defaultFs) {
  const dir = dirname(filePath);
  const baseName = basename(filePath);
  const stem = baseName.replace(/\.json$/i, "");
  const entries = await fs.readdir(dir).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.endsWith(".backup.json")) continue;
    const entryPath = join(dir, entry);
    const sameFamily = entry === `${baseName}.v1.backup.json`
      || entry.startsWith(`${baseName}.schema-v`)
      || entry.startsWith(`${stem}.schema-v`)
      || entry.startsWith(`${stem}.`)
      || entry.startsWith(`${stem}-`)
      || entry.startsWith(`${stem}__`)
      || entry.startsWith(`${stem}.pre-`);
    if (!sameFamily) continue;
    try {
      const raw = await fs.readFile(entryPath, "utf8");
      const parsed = JSON.parse(raw);
      const metadata = await fs.stat(entryPath).catch(() => null);
      candidates.push({ path: entryPath, parsed, mtimeMs: metadata?.mtimeMs ?? 0 });
    } catch {
      // Ignore unreadable or invalid backups until a valid one is discovered.
    }
  }
  candidates.sort((a, b) => {
    const versionDelta = Number(b.parsed?.schemaVersion ?? 0) - Number(a.parsed?.schemaVersion ?? 0);
    if (versionDelta !== 0) return versionDelta;
    return Number(b.mtimeMs) - Number(a.mtimeMs);
  });
  return candidates[0] ?? null;
}
const iso = value => { if (value === null || value === undefined || value === "") return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null; };
const sessionIso = value => { const normalized = iso(value); return normalized === "1970-01-01T00:00:00.000Z" ? null : normalized; };

export function migrateLegacyComment(comment, defaults = {}) {
  const username = String(comment.username || comment.user || "unknown");
  const text = String(comment.text || "");
  const classification = classifyQuestion(text);
  const receivedAt = iso(comment.receivedAt || comment.timestamp) || new Date(0).toISOString();
  return { ...comment, sessionId: String(comment.sessionId || defaults.sessionId || LEGACY_SESSION_ID),
    targetUsername: String(comment.targetUsername || defaults.targetUsername || DEFAULT_TARGET), roomId: comment.roomId ? String(comment.roomId) : null,
    connectionGeneration: Number(comment.connectionGeneration || 0), id: String(comment.id), timestamp: receivedAt,
    receivedAt, eventTimestamp: iso(comment.eventTimestamp), userId: String(comment.userId || `legacy:${username}`), username,
    nickname: String(comment.nickname || username), avatar: String(comment.avatar || ""), text,
    normalizedText: comment.normalizedText || normalizeText(text), question: comment.question === true || classification.question,
    questionScore: Number.isFinite(comment.questionScore) ? comment.questionScore : classification.score,
    questionReasons: Array.isArray(comment.questionReasons) ? comment.questionReasons : classification.reasons,
    classification: comment.classification || classification.classification, confidenceScore: Number.isFinite(comment.confidenceScore) ? comment.confidenceScore : classification.confidenceScore,
    tarotIntentScore: Number.isFinite(comment.tarotIntentScore) ? comment.tarotIntentScore : classification.tarotIntentScore,
    detectedTopic: comment.detectedTopic || classification.detectedTopic, detectedSubtopics: Array.isArray(comment.detectedSubtopics) ? comment.detectedSubtopics : classification.detectedSubtopics,
    detectedEntities: comment.detectedEntities || classification.detectedEntities, matchedSignals: Array.isArray(comment.matchedSignals) ? comment.matchedSignals : classification.matchedSignals,
    needsReview: comment.needsReview === true || classification.needsReview, rejectionReason: comment.rejectionReason ?? classification.rejectionReason,
    safetyCategory: comment.safetyCategory || classification.safetyCategory, classifierVersion: comment.classifierVersion || classification.classifierVersion };
}

function normalizeSession(session) {
  return { id: String(session.id), targetUsername: normalizeTargetInput(session.targetUsername) || DEFAULT_TARGET,
    roomId: session.roomId ? String(session.roomId) : null, status: ["connecting","live","ended","cleared"].includes(session.status) ? session.status : (session.endedAt ? "ended" : "connecting"),
    startedAt: sessionIso(session.startedAt), connectedAt: sessionIso(session.connectedAt), collectorConnectedAt: sessionIso(session.collectorConnectedAt || session.connectedAt),
    endedAt: sessionIso(session.endedAt), endReason: session.endReason || null, connectionGeneration: Number(session.connectionGeneration || 0),
    commentCount: Number(session.commentCount || 0), questionCount: Number(session.questionCount || 0), answeredCount: Number(session.answeredCount || 0),
    nextQueueNumber: Math.max(1, Number(session.nextQueueNumber) || 1),
    viewerAnalytics: createViewerState(session.viewerAnalytics) };
}

export function buildStore(comments = [], metadata = {}) {
  const targetUsername = normalizeTargetInput(metadata.settings?.targetUsername) || DEFAULT_TARGET;
  const rawComments = Array.isArray(comments) ? comments : [];
  const sessions = Array.isArray(metadata.sessions) ? metadata.sessions.filter(item => item?.id).map(normalizeSession) : [];
  const needsLegacy = rawComments.some(comment => !comment.sessionId);
  if (needsLegacy && !sessions.some(session => session.id === LEGACY_SESSION_ID)) sessions.push(normalizeSession({ id: LEGACY_SESSION_ID, targetUsername, roomId: null, status: "ended", startedAt: null, endedAt: null, endReason: "legacy_migration" }));
  const validActive = sessions.find(session => session.id === metadata.activeSessionId && !["ended","cleared"].includes(session.status));
  const store = { schemaVersion: SCHEMA_VERSION, comments: [], questionThreads: [], sessions, activeSessionId: validActive?.id || null,
    settings: { targetUsername, recentTargets: recentTargets(metadata.settings?.recentTargets, targetUsername) }, gifts:Array.isArray(metadata.gifts)?metadata.gifts:[],giftAttention:Array.isArray(metadata.giftAttention)?metadata.giftAttention:[],giftSettings:{...DEFAULT_GIFT_SETTINGS,...metadata.giftSettings} };
  if(store.giftSettings.applyTo!=="final-only")store.giftSettings.applyTo="final-only";
  const service = new QuestionService(store);
  const oldThreads = Array.isArray(metadata.questionThreads) ? metadata.questionThreads : [];
  store.comments = rawComments.map(raw => migrateLegacyComment(raw, { sessionId: raw.sessionId || LEGACY_SESSION_ID, targetUsername }));
  if (oldThreads.length) store.questionThreads = oldThreads.map(thread => ({ ...thread, sessionId: String(thread.sessionId || LEGACY_SESSION_ID), commentIds: Array.isArray(thread.commentIds) ? [...thread.commentIds] : [] }));
  else { store.comments = []; for (const raw of rawComments) service.addComment(migrateLegacyComment(raw, { sessionId: raw.sessionId || LEGACY_SESSION_ID, targetUsername })); }
  for (const thread of store.questionThreads) {
    const exact = oldThreads.find(old => old.userId === thread.userId && old.normalizedText === thread.normalizedText && String(old.sessionId || LEGACY_SESSION_ID) === thread.sessionId);
    if (exact) Object.assign(thread, { ...exact, id: exact.id || thread.id, sessionId: thread.sessionId,
      answered: exact.answered === true, answeredAt: exact.answered === true ? iso(exact.answeredAt) : null,
      commentIds: Array.isArray(exact.commentIds) ? exact.commentIds : thread.commentIds, repeatCount: Number(exact.repeatCount || thread.repeatCount || 1),
      deleted: exact.deleted === true, possibleDuplicate: exact.possibleDuplicate || thread.possibleDuplicate });
  }
  for (const session of sessions) {
    const scopedComments = store.comments.filter(comment => comment.sessionId === session.id);
    const scopedThreads = store.questionThreads.filter(thread => thread.sessionId === session.id && thread.deleted !== true);
    const ordered = [...scopedThreads].sort((a,b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) ||
      String(scopedComments.find(item => a.commentIds?.includes(item.id))?.timestamp || "").localeCompare(String(scopedComments.find(item => b.commentIds?.includes(item.id))?.timestamp || "")) || String(a.id).localeCompare(String(b.id)));
    const used = new Set(ordered.map(item => Number(item.queueNumber)).filter(Number.isInteger)); let next = Math.max(0, ...used) + 1;
    for (const thread of ordered) {
      if (!Number.isInteger(Number(thread.queueNumber)) || Number(thread.queueNumber) < 1) { while (used.has(next)) next += 1; thread.queueNumber = next; used.add(next++); }
      thread.priorityRank = Number.isFinite(Number(thread.priorityRank)) ? Number(thread.priorityRank) : thread.queueNumber;
      thread.source ||= "classifier"; thread.manualOverride = thread.manualOverride === true; thread.reason ??= null;
      thread.addedToQueueAt ||= thread.createdAt || null; thread.createdBy ||= thread.source === "classifier" ? "system" : "operator"; thread.archived = thread.archived === true;
    }
    session.nextQueueNumber = Math.max(Number(session.nextQueueNumber) || 1, Math.max(0, ...used) + 1);
    session.commentCount = scopedComments.length; session.questionCount = scopedThreads.length; session.answeredCount = scopedThreads.filter(thread => thread.answered).length;
  }
  return store;
}

export class JsonStorage {
  constructor({ storeFile, legacyFile, fs = defaultFs }) { this.storeFile = storeFile; this.legacyFile = legacyFile; this.fs = fs; this.store = buildStore(); this.queue = Promise.resolve(); this.pendingTransactions = 0;
    this.health = { lastSaveAt: null, lastSaveErrorAt: null, consecutiveSaveFailures: 0, storageHealthy: true, loadHealthy: true, invariantErrors: [] }; }
  async load() {
    await mkdir(dirname(this.storeFile), { recursive: true });
    if (await exists(this.storeFile)) {
      let parsed;
      try {
        parsed = JSON.parse(await this.fs.readFile(this.storeFile, "utf8"));
      } catch (error) {
        const recovered = await recoverFromBackup(this.storeFile, this.fs);
        if (!recovered) {
          this.health.loadHealthy = false;
          this.health.storageHealthy = false;
          this.health.lastSaveErrorAt = new Date().toISOString();
          throw new Error("STORE_CORRUPT_OR_UNREADABLE", { cause: error });
        }
        const corruptionCopy = `${this.storeFile}.corrupt-${Date.now()}.json`;
        await this.fs.copyFile(this.storeFile, corruptionCopy).catch(() => {});
        const replacement = JSON.stringify(recovered.parsed, null, 2);
        await this.fs.writeFile(this.storeFile, replacement);
        parsed = recovered.parsed;
        this.health.loadHealthy = true;
        this.health.storageHealthy = true;
      }
      if ((parsed.schemaVersion || 0) < SCHEMA_VERSION) {
        const backup = `${this.storeFile}.schema-v${parsed.schemaVersion || 0}.backup.json`;
        if (!(await exists(backup))) await this.fs.copyFile(this.storeFile, backup);
      }
      this.store = buildStore(parsed.comments || [], parsed); await this.save(); return this.store;
    }
    if (await exists(this.legacyFile)) {
      const backup = `${this.legacyFile}.v1.backup.json`; if (!(await exists(backup))) await this.fs.copyFile(this.legacyFile, backup);
      const legacy = JSON.parse(await this.fs.readFile(this.legacyFile, "utf8")); this.store = buildStore(Array.isArray(legacy) ? legacy : legacy.comments || []); await this.save(); return this.store;
    }
    await this.save(); return this.store;
  }
  validate(candidate = this.store) {
    const errors = [], sessions = candidate.sessions || [], comments = candidate.comments || [], threads = candidate.questionThreads || [];
    const unique = (rows, label, key = item => item.id) => { const seen = new Set(); for (const row of rows) { const value = key(row); if (!value || seen.has(value)) errors.push(`${label}_DUPLICATE_OR_MISSING`); seen.add(value); } };
    unique(comments, "COMMENT", item => `${item.sessionId}:${item.id}`); unique(threads, "THREAD"); unique(threads, "QUEUE", item => `${item.sessionId}:${item.queueNumber}`);
    const sessionIds = new Set(sessions.map(item => item.id)), commentIds = new Set(comments.map(item => `${item.sessionId}:${item.id}`));
    for (const thread of threads) { if (!sessionIds.has(thread.sessionId)) errors.push("THREAD_SESSION_MISSING"); if (thread.answered !== true && thread.answeredAt != null) errors.push("ANSWERED_AT_INCONSISTENT"); for (const id of thread.commentIds || []) if (!commentIds.has(`${thread.sessionId}:${id}`)) errors.push("OCCURRENCE_MISSING"); }
    for (const session of sessions) { const max = Math.max(0, ...threads.filter(item => item.sessionId === session.id).map(item => Number(item.queueNumber) || 0)); if (Number(session.nextQueueNumber) <= max) errors.push("NEXT_QUEUE_INVALID"); }
    const giftIds=new Set();for(const gift of candidate.gifts||[]){const key=`${gift.sessionId}:${gift.id}`;if(giftIds.has(key))errors.push("GIFT_DUPLICATE");giftIds.add(key);if(!sessionIds.has(gift.sessionId))errors.push("GIFT_SESSION_MISSING");if(!gift.id||!gift.userId||!gift.giftId)errors.push("GIFT_REQUIRED_FIELD_MISSING");if(!Number.isSafeInteger(Number(gift.repeatCount))||Number(gift.repeatCount)<1||!([null].includes(gift.totalDiamonds)||Number.isFinite(Number(gift.totalDiamonds))))errors.push("GIFT_VALUE_INVALID");}
    for(const a of candidate.giftAttention||[]){if(!sessionIds.has(a.sessionId))errors.push("GIFT_ATTENTION_SESSION_MISSING");if(a.linkedQuestionId){const q=threads.find(q=>q.id===a.linkedQuestionId);if(!q||q.sessionId!==a.sessionId||q.userId!==a.userId)errors.push("GIFT_LINK_INVALID")}}
    const serialized = JSON.stringify(candidate); if (serialized.includes(":null") === false && !serialized) errors.push("SERIALIZE_FAILED");
    this.health.invariantErrors = [...new Set(errors)]; return { ok: errors.length === 0, errors: this.health.invariantErrors };
  }
  async persist(candidate) {
    const check = this.validate(candidate); if (!check.ok) throw new Error(`STORE_INVARIANT_FAILED:${check.errors.join(",")}`);
    const temporaryFile = join(dirname(this.storeFile), `.${basename(this.storeFile)}.${process.pid}.${Date.now()}.tmp`);
    try { await this.fs.writeFile(temporaryFile, JSON.stringify(candidate, null, 2)); await this.fs.rename(temporaryFile, this.storeFile);
      this.health.lastSaveAt = new Date().toISOString(); this.health.consecutiveSaveFailures = 0; this.health.storageHealthy = true;
    } catch (error) { this.health.lastSaveErrorAt = new Date().toISOString(); this.health.consecutiveSaveFailures += 1; this.health.storageHealthy = false; try { await this.fs.unlink(temporaryFile); } catch {} throw error; }
  }
  enqueue(operation) { const current = this.queue.then(operation, operation); this.queue = current.catch(() => undefined); return current; }
  save() { const snapshot = structuredClone(this.store); return this.enqueue(() => this.persist(snapshot)); }
  mutate(mutator) { return this.enqueue(async () => { this.pendingTransactions += 1; try { const draft = structuredClone(this.store); const result = await mutator(draft); await this.persist(draft); for (const key of Object.keys(this.store)) delete this.store[key]; Object.assign(this.store, draft); return result; } finally { this.pendingTransactions -= 1; } }); }
  readiness() { const validation = this.validate(); return { ready: this.health.loadHealthy && this.health.storageHealthy && validation.ok && this.pendingTransactions === 0, ...this.health, pendingTransactions: this.pendingTransactions }; }
  async backupSession(sessionId) {
    const session = this.store.sessions.find(item => item.id === sessionId); if (!session) throw new Error("SESSION_NOT_FOUND");
    const payload = { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), session,
      comments: this.store.comments.filter(item => item.sessionId === sessionId), questionThreads: this.store.questionThreads.filter(item => item.sessionId === sessionId),
      gifts:this.store.gifts.filter(item=>item.sessionId===sessionId),giftAttention:this.store.giftAttention.filter(item=>item.sessionId===sessionId) };
    const safeId = sessionId.replace(/[^a-z0-9._-]/gi, "_"); const path = join(dirname(this.storeFile), `session-${safeId}-${Date.now()}.backup.json`);
    await this.fs.writeFile(path, JSON.stringify(payload, null, 2));
    const verified = JSON.parse(await this.fs.readFile(path, "utf8"));
    if (verified.session?.id !== sessionId || verified.comments.length !== payload.comments.length || verified.questionThreads.length !== payload.questionThreads.length) throw new Error("BACKUP_VERIFY_FAILED");
    return { path, commentCount: payload.comments.length, questionCount: payload.questionThreads.length };
  }
}