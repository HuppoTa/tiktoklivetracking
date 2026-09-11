export class ConnectionGuard {
  constructor() { this.generation = 0; this.reconnectTimer = null; }
  next() { this.clearReconnect(); return ++this.generation; }
  isCurrent(generation) { return generation === this.generation; }
  invalidate() { this.clearReconnect(); return ++this.generation; }
  schedule(generation, callback, delay) {
    if (!this.isCurrent(generation)) return false;
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isCurrent(generation)) callback();
    }, delay);
    return true;
  }
  scheduleOnce(generation, callback, delay) {
    if (!this.isCurrent(generation) || this.reconnectTimer) return false;
    return this.schedule(generation, callback, delay);
  }
  clearReconnect() { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
}

export async function retireConnection(guard, connection) {
  guard.invalidate();
  if (!connection) return;
  try { connection.removeAllListeners(); } catch {}
  try { await Promise.resolve(connection.disconnect()); } catch {}
}
