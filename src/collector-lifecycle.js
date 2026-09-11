export class StreamEndConfirmation {
  constructor(requiredNotLiveChecks = 2) {
    this.requiredNotLiveChecks = Math.max(1, Number(requiredNotLiveChecks) || 2);
    this.candidate = null;
  }

  mark({ sessionId, roomId, action = null }) {
    if (!sessionId || !roomId) return null;
    this.candidate = {
      sessionId: String(sessionId),
      roomId: String(roomId),
      action,
      notLiveChecks: 0,
    };
    return this.candidate;
  }

  clear() {
    this.candidate = null;
  }

  observeConnected({ sessionId, roomId }) {
    if (!this.candidate) return "NO_CANDIDATE";
    const sameSession = String(sessionId || "") === this.candidate.sessionId;
    const sameRoom = String(roomId || "") === this.candidate.roomId;
    this.clear();
    return sameSession && sameRoom ? "SAME_ROOM_RECOVERED" : "ROOM_CHANGED";
  }

  observeNotLive(sessionId) {
    if (!this.candidate || String(sessionId || "") !== this.candidate.sessionId) {
      return { pending: false, confirmed: false, count: 0 };
    }
    this.candidate.notLiveChecks += 1;
    return {
      pending: true,
      confirmed: this.candidate.notLiveChecks >= this.requiredNotLiveChecks,
      count: this.candidate.notLiveChecks,
    };
  }
}
