export class LocalLiveGuard {
  constructor({ resolveCandidateRoom, getProductionStatus, getProductionRoom, connect, disconnect, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, ttlMs = 900_000, maxReconnectAttempts = 3 }) {
    this.resolveCandidateRoom = resolveCandidateRoom;
    this.getProductionStatus = getProductionStatus || (getProductionRoom ? async () => {
      const roomId = await getProductionRoom();
      return roomId ? { active: true, roomId } : null;
    } : async () => null);
    this.connect = connect;
    this.disconnect = disconnect;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.ttlMs = ttlMs;
    this.maxReconnectAttempts = maxReconnectAttempts;
    this.active = false;
    this.busy = false;
    this.expired = false;
    this.deadline = null;
    this.timer = null;
    this.roomId = null;
    this.target = null;
    this.reconnectAttempts = 0;
  }

  get remainingMs() { return this.deadline === null ? 0 : Math.max(0, this.deadline - this.now()); }

  async verify(target) {
    let production;
    try { production = parseProductionCollectorStatus(await this.getProductionStatus()); } catch { return { ok: false, code: "PRODUCTION_STATUS_UNAVAILABLE" }; }
    if (!production) return { ok: false, code: "PRODUCTION_STATUS_UNAVAILABLE" };
    let candidate;
    try { candidate = String(await this.resolveCandidateRoom(target) || "").trim(); } catch { return { ok: false, code: "LOCAL_ROOM_UNAVAILABLE" }; }
    if (!candidate) return { ok: false, code: "LOCAL_ROOM_UNAVAILABLE" };
    if (production.active && candidate === production.roomId) return { ok: false, code: "ROOM_CONFLICT" };
    return { ok: true, roomId: candidate };
  }

  async start(target) {
    if (this.busy || this.active) return { ok: false, code: "ALREADY_ACTIVE" };
    this.busy = true;
    try {
      const checked = await this.verify(target);
      if (!checked.ok) return checked;
      const result = await this.connect(target, checked.roomId);
      if (!result?.ok || String(result.roomId || checked.roomId) !== checked.roomId) {
        await this.disconnect();
        return { ok: false, code: "LOCAL_CONNECT_FAILED" };
      }
      this.active = true;
      this.expired = false;
      this.target = target;
      this.roomId = checked.roomId;
      this.reconnectAttempts = 0;
      this.deadline = this.now() + this.ttlMs;
      this.timer = this.setTimer(() => void this.stop({ expired: true }), this.ttlMs);
      this.timer?.unref?.();
      return { ok: true, roomId: this.roomId, expiresAt: new Date(this.deadline).toISOString() };
    } catch {
      await this.disconnect();
      return { ok: false, code: "LOCAL_CONNECT_FAILED" };
    } finally { this.busy = false; }
  }

  async reconnect() {
    if (this.expired || !this.active || this.remainingMs <= 0) return { ok: false, code: "LOCAL_LIVE_EXPIRED" };
    if (this.busy) return { ok: false, code: "ALREADY_ACTIVE" };
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return { ok: false, code: "RECONNECT_LIMIT" };
    this.busy = true;
    try {
      const checked = await this.verify(this.target);
      if (!checked.ok) { await this.stop({ expired: checked.code === "ROOM_CONFLICT" }); return checked; }
      this.reconnectAttempts++;
      const result = await this.connect(this.target, checked.roomId);
      if (!result?.ok || String(result.roomId || checked.roomId) !== checked.roomId) return { ok: false, code: "LOCAL_CONNECT_FAILED" };
      this.roomId = checked.roomId;
      return { ok: true, roomId: this.roomId, expiresAt: new Date(this.deadline).toISOString() };
    } catch { return { ok: false, code: "LOCAL_CONNECT_FAILED" }; }
    finally { this.busy = false; }
  }

  async stop({ expired = false } = {}) {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.active = false;
    this.deadline = null;
    this.roomId = null;
    this.expired = expired;
    await this.disconnect();
    return { ok: true };
  }
}

const ACTIVE_STATES = new Set(["LIVE_HEALTHY", "LIVE_IDLE", "CHAT_SUSPECTED_STALLED", "RECONNECTING", "DEGRADED"]);
const OFFLINE_STATES = new Set(["OFFLINE", "ERROR", "STOPPED"]);

export function parseProductionCollectorStatus(value) {
  if (typeof value === "string") {
    const roomId = value.trim();
    return roomId ? { active: true, roomId } : null;
  }
  if (!value || typeof value !== "object") return null;
  if (Object.hasOwn(value, "reachable") || Object.hasOwn(value, "collectorActive")) {
    if (value.reachable !== true || typeof value.collectorActive !== "boolean") return null;
    const roomId = String(value.roomId || "").trim() || null;
    return value.collectorActive ? (roomId ? { active: true, roomId } : null) : { active: false, roomId: null };
  }
  const roomId = String(value.roomId || "").trim() || null;
  const connectionState = String(value.connectionState || "").trim().toUpperCase();
  const explicitlyActive = value.active === true || value.live === true || ACTIVE_STATES.has(connectionState);
  if (explicitlyActive) return roomId ? { active: true, roomId } : null;
  const explicitlyOffline = value.active === false || (value.live === false && Number(value.activeConnectionCount) === 0 && OFFLINE_STATES.has(connectionState));
  return explicitlyOffline ? { active: false, roomId: null } : null;
}

export async function fetchProductionCollectorStatus(url, { fetchImpl = fetch, timeoutMs = 2_000 } = {}) {
  if (!url) return null;
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    return parseProductionCollectorStatus(payload?.collector || payload);
  } catch { return null; }
}
