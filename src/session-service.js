import { randomUUID } from "node:crypto";
import { createViewerState } from "./analytics.js";
import { DEFAULT_TARGET, recentTargets } from "./target.js";

export function createSession(targetUsername, now = new Date(), id = `session-${randomUUID()}`) {
  return {
    id, targetUsername, roomId: null, startedAt: now.toISOString(), connectedAt: null,
    endedAt: null, endReason: null, status: "connecting", viewerAnalytics: createViewerState()
  };
}

export class SessionService {
  constructor(store, now = () => new Date()) {
    this.store = store;
    this.now = now;
    this.store.settings ||= { targetUsername: DEFAULT_TARGET, recentTargets: [DEFAULT_TARGET] };
    this.store.sessions ||= [];
    this.store.activeSessionId ||= null;
  }

  get active() { return this.store.sessions.find(session => session.id === this.store.activeSessionId && !session.endedAt) || null; }

  ensureActive(targetUsername) {
    if (this.active?.targetUsername === targetUsername) return this.active;
    if (this.active) this.closeActive("server_restart");
    const session = createSession(targetUsername, this.now());
    this.store.sessions.push(session);
    this.store.activeSessionId = session.id;
    return session;
  }

  switchTarget(targetUsername) {
    const previous = this.active;
    if (previous?.targetUsername === targetUsername) return { changed: false, previous, session: previous };
    if (previous) this.closeActive("target_changed");
    const session = createSession(targetUsername, this.now());
    this.store.sessions.push(session);
    this.store.activeSessionId = session.id;
    this.store.settings.targetUsername = targetUsername;
    this.store.settings.recentTargets = recentTargets(this.store.settings.recentTargets, targetUsername);
    return { changed: true, previous, session };
  }

  markLive(roomId) {
    const session = this.active;
    if (!session) return null;
    session.roomId = String(roomId);
    session.connectedAt ||= this.now().toISOString();
    session.status = "live";
    return session;
  }

  markOffline() { if (this.active) this.active.status = "offline"; }

  closeActive(reason) {
    const session = this.active;
    if (!session) return null;
    session.endedAt = this.now().toISOString();
    session.endReason = reason;
    session.status = "ended";
    return session;
  }
}
