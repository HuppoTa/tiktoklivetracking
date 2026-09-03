import { randomUUID } from "node:crypto";
import { createViewerState } from "./analytics.js";
import { DEFAULT_TARGET, recentTargets } from "./target.js";

export function createSession(targetUsername, now = new Date(), id = `session-${randomUUID()}`, generation = 0) {
  return { id, targetUsername, roomId: null, status: "connecting", startedAt: now.toISOString(), connectedAt: null,
    collectorConnectedAt: null, endedAt: null, endReason: null, connectionGeneration: generation,
    commentCount: 0, questionCount: 0, answeredCount: 0, nextQueueNumber: 1, viewerAnalytics: createViewerState() };
}

export class SessionService {
  constructor(store, now = () => new Date()) {
    this.store = store; this.now = now;
    this.store.settings ||= { targetUsername: DEFAULT_TARGET, recentTargets: [DEFAULT_TARGET] };
    this.store.sessions ||= []; this.store.activeSessionId ||= null;
  }
  get active() { return this.store.sessions.find(session => session.id === this.store.activeSessionId && session.status !== "ended" && session.status !== "cleared") || null; }
  get(id) { return this.store.sessions.find(session => session.id === id) || null; }
  ensurePending(targetUsername, generation = 0) {
    if (this.active?.targetUsername === targetUsername) { this.active.connectionGeneration = generation || this.active.connectionGeneration || 0; return this.active; }
    if (this.active) this.closeActive("target_changed");
    const session = createSession(targetUsername, this.now(), undefined, generation);
    this.store.sessions.push(session); this.store.activeSessionId = session.id; return session;
  }
  ensureActive(targetUsername) { return this.ensurePending(targetUsername); }
  switchTarget(targetUsername, generation = 0) {
    const previous = this.active;
    if (previous?.targetUsername === targetUsername) return { changed: false, previous, session: previous };
    if (previous) this.closeActive("target_changed");
    const session = createSession(targetUsername, this.now(), undefined, generation);
    this.store.sessions.push(session); this.store.activeSessionId = session.id;
    this.store.settings.targetUsername = targetUsername;
    this.store.settings.recentTargets = recentTargets(this.store.settings.recentTargets, targetUsername);
    return { changed: true, previous, session };
  }
  attachRoom(targetUsername, roomId, generation, connectedAt = this.now()) {
    const normalizedRoom = String(roomId || "");
    if (!normalizedRoom) return null;
    const current = this.active;
    if (current?.targetUsername === targetUsername && current.roomId === normalizedRoom) {
      Object.assign(current, { status: "live", connectionGeneration: generation, collectorConnectedAt: connectedAt.toISOString() });
      current.connectedAt ||= connectedAt.toISOString(); return { created: false, previous: null, session: current };
    }
    if (current?.roomId && current.roomId !== normalizedRoom) this.closeActive("room_changed");
    let session = this.active;
    if (!session || session.targetUsername !== targetUsername || session.roomId) {
      session = createSession(targetUsername, connectedAt, undefined, generation);
      this.store.sessions.push(session); this.store.activeSessionId = session.id;
    }
    Object.assign(session, { roomId: normalizedRoom, status: "live", connectedAt: connectedAt.toISOString(), collectorConnectedAt: connectedAt.toISOString(), connectionGeneration: generation });
    return { created: session !== current, previous: current && current !== session ? current : null, session };
  }
  markLive(roomId, generation = 0) { return this.attachRoom(this.active?.targetUsername || this.store.settings.targetUsername, roomId, generation)?.session || null; }
  markOffline() { if (this.active) this.active.status = this.active.roomId ? "connecting" : "connecting"; }
  closeActive(reason = "manual_end") { return this.end(this.active?.id, reason); }
  end(id, reason = "manual_end") {
    const session = this.get(id); if (!session || session.status === "ended" || session.status === "cleared") return session;
    session.endedAt = this.now().toISOString(); session.endReason = reason; session.status = "ended";
    if (this.store.activeSessionId === id) this.store.activeSessionId = null; return session;
  }
  start(targetUsername, generation = 0) {
    if (this.active) this.closeActive("manual_new_session");
    const session = createSession(targetUsername, this.now(), undefined, generation);
    this.store.sessions.push(session); this.store.activeSessionId = session.id; return session;
  }
  resetAnswers(id) {
    if (!this.get(id)) return null;
    const threads = this.store.questionThreads.filter(thread => thread.sessionId === id && thread.deleted !== true);
    for (const thread of threads) { thread.answered = false; thread.answeredAt = null; }
    this.refreshSummary(id); return { session: this.get(id), updated: threads.length };
  }
  deleteSession(id) {
    const session = this.get(id); if (!session) return null;
    if (session.status === "live" || this.store.activeSessionId === id) throw new Error("ACTIVE_SESSION");
    const summary = this.summary(id);
    this.store.comments = this.store.comments.filter(comment => comment.sessionId !== id);
    this.store.questionThreads = this.store.questionThreads.filter(thread => thread.sessionId !== id);
    this.store.sessions = this.store.sessions.filter(item => item.id !== id);
    return summary;
  }
  refreshSummary(id) {
    const session = this.get(id); if (!session) return null;
    const comments = this.store.comments.filter(comment => comment.sessionId === id);
    const threads = this.store.questionThreads.filter(thread => thread.sessionId === id && thread.deleted !== true);
    session.commentCount = comments.length; session.questionCount = threads.length; session.answeredCount = threads.filter(thread => thread.answered === true).length;
    return session;
  }
  summary(id) {
    const session = this.refreshSummary(id); if (!session) return null;
    return { ...session, unansweredCount: Math.max(0, session.questionCount - session.answeredCount), peakViewers: session.viewerAnalytics?.peakViewers ?? null };
  }
  list() { return this.store.sessions.map(session => this.summary(session.id)).sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || ""))); }
}
