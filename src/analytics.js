export const VIEWER_SAMPLE_INTERVAL_MS = 15_000;
export const MAX_VIEWER_SAMPLES = 1_000;

export function createViewerState(value = {}) {
  const joinedIds = Array.isArray(value.joinedUserIds) ? value.joinedUserIds.map(String) : [];
  const memberMessageIds = Array.isArray(value.memberMessageIds) ? value.memberMessageIds.map(String) : [];
  return {
    roomId: value.roomId ? String(value.roomId) : null,
    currentViewers: Number.isFinite(value.currentViewers) ? value.currentViewers : null,
    peakViewers: Number.isFinite(value.peakViewers) ? value.peakViewers : null,
    viewerSamples: Array.isArray(value.viewerSamples) ? value.viewerSamples.filter(sample => Number.isFinite(sample?.viewerCount)) : [],
    memberJoinEvents: Number.isInteger(value.memberJoinEvents) && value.memberJoinEvents >= 0 ? value.memberJoinEvents : 0,
    joinedUserIds: [...new Set(joinedIds)],
    memberMessageIds: [...new Set(memberMessageIds)].slice(-5_000),
    totalLikes: value.totalLikesSource === "like_event" && Number.isSafeInteger(value.totalLikes) && value.totalLikes >= 0 ? value.totalLikes : null,
    totalLikesSource: value.totalLikesSource === "like_event" ? value.totalLikesSource : null,
    lastLikeUpdateAt: typeof value.lastLikeUpdateAt === "string" ? value.lastLikeUpdateAt : null,
    lastViewerUpdateAt: typeof value.lastViewerUpdateAt === "string" ? value.lastViewerUpdateAt : null
  };
}

export function extractViewerCount(data) {
  const candidates = [data?.viewerCount, data?.total];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const count = Number(candidate);
    if (Number.isInteger(count) && count >= 0) return count;
  }
  return null;
}

// TikTok emits the stream-wide total on LIKE events. Do not derive a total by
// adding per-event counts: the connector documents that LIKE events may be omitted.
export function extractTotalLikeCount(data) {
  // Connector v2 protobuf emits `total`; older/simplified payloads use the
  // documented totalLikeCount names. `count` remains intentionally excluded:
  // it is only the increment for this particular LIKE event.
  return firstSafeCount([data?.totalLikeCount, data?.total_like_count, data?.total]);
}

function firstSafeCount(candidates) {
  for (const candidate of candidates) {
    const count = Number(candidate);
    if (Number.isSafeInteger(count) && count >= 0) return count;
  }
  return null;
}

export class ViewerAnalytics {
  constructor(state = {}) {
    this.state = createViewerState(state);
  }

  startSession(roomId) {
    const normalizedRoomId = roomId ? String(roomId) : null;
    if (!normalizedRoomId) return false;
    if (this.state.roomId && this.state.roomId !== normalizedRoomId) {
      this.state = createViewerState({ roomId: normalizedRoomId });
      return true;
    }
    this.state.roomId = normalizedRoomId;
    return false;
  }

  observeRoomUser(data, now = new Date()) {
    const viewerCount = extractViewerCount(data);
    if (viewerCount === null) return { updated: false, sampled: false };
    const previous = this.state.currentViewers;
    const timestamp = now.toISOString();
    this.state.currentViewers = viewerCount;
    this.state.peakViewers = this.state.peakViewers === null ? viewerCount : Math.max(this.state.peakViewers, viewerCount);
    this.state.lastViewerUpdateAt = timestamp;
    const lastSample = this.state.viewerSamples.at(-1);
    const elapsed = lastSample ? now.getTime() - new Date(lastSample.timestamp).getTime() : Infinity;
    const sampled = !lastSample || viewerCount !== lastSample.viewerCount || elapsed >= VIEWER_SAMPLE_INTERVAL_MS;
    if (sampled) {
      this.state.viewerSamples.push({ timestamp, viewerCount });
      if (this.state.viewerSamples.length > MAX_VIEWER_SAMPLES) {
        this.state.viewerSamples = this.state.viewerSamples.slice(-MAX_VIEWER_SAMPLES);
      }
    }
    return { updated: true, changed: previous !== viewerCount, sampled };
  }

  observeMember(data) {
    const messageId = data?.msgId || data?.common?.msgId;
    if (messageId && this.state.memberMessageIds.includes(String(messageId))) return { updated: false, duplicate: true };
    const user = data?.user || {};
    const rawUserId = user.id || user.userId || data?.userId || user.uniqueId;
    if (!rawUserId) return { updated: false, duplicate: false };
    const userId = String(user.id || user.userId || data?.userId || `legacy:${rawUserId}`);
    this.state.memberJoinEvents += 1;
    if (!this.state.joinedUserIds.includes(userId)) this.state.joinedUserIds.push(userId);
    if (messageId) {
      this.state.memberMessageIds.push(String(messageId));
      if (this.state.memberMessageIds.length > 5_000) this.state.memberMessageIds = this.state.memberMessageIds.slice(-5_000);
    }
    return { updated: true, duplicate: false };
  }

  observeLike(data, now = new Date()) {
    const totalLikes = extractTotalLikeCount(data);
    if (totalLikes === null) return { updated: false, changed: false, delta: null };
    const previous = this.state.totalLikes;
    // A delayed or replayed event must not make the stream total go backwards.
    if (previous !== null && totalLikes < previous) return { updated: false, changed: false, delta: null, stale: true };
    this.state.totalLikes = totalLikes;
    this.state.totalLikesSource = "like_event";
    this.state.lastLikeUpdateAt = now.toISOString();
    return { updated: true, changed: previous !== totalLikes, delta: previous === null ? null : totalLikes - previous };
  }

  payload() {
    return {
      currentViewers: this.state.currentViewers,
      peakViewers: this.state.peakViewers,
      memberJoinEvents: this.state.memberJoinEvents,
      uniqueJoinedUsers: this.state.joinedUserIds.length,
      totalLikes: this.state.totalLikes,
      totalLikesSource: this.state.totalLikesSource,
      lastLikeUpdateAt: this.state.lastLikeUpdateAt,
      lastViewerUpdateAt: this.state.lastViewerUpdateAt
    };
  }
}

export function calculateQuestionAnalytics(threads = []) {
  const safeThreads = Array.isArray(threads) ? threads : [];
  const answeredThreads = safeThreads.filter(thread => thread?.answered);
  const total = safeThreads.length;
  const waits = answeredThreads
    .map(thread => new Date(thread.answeredAt).getTime() - new Date(thread.createdAt).getTime())
    .filter(value => Number.isFinite(value) && value >= 0);
  return {
    unanswered: total - answeredThreads.length,
    answered: answeredThreads.length,
    total,
    completionRate: total ? Number(((answeredThreads.length / total) * 100).toFixed(2)) : 0,
    averageWaitSeconds: waits.length ? Math.round(waits.reduce((sum, value) => sum + value, 0) / waits.length / 1000) : 0
  };
}

export function buildAnalytics(threads, viewerState, gifts = [], attention = []) {
  const viewers = createViewerState(viewerState);
  return {
    questions: { ...calculateQuestionAnalytics(threads), classifierCount: threads.filter(item => (item.source || "classifier") === "classifier").length,
      promotedCount: threads.filter(item => item.source === "promoted_comment").length, manualCount: threads.filter(item => item.source === "manual_entry").length },
    viewers: {
      current: viewers.currentViewers,
      peak: viewers.peakViewers,
      memberJoinEvents: viewers.memberJoinEvents,
      uniqueJoinedUsers: viewers.joinedUserIds.length,
      totalLikes: viewers.totalLikes,
      totalLikesSource: viewers.totalLikesSource,
      lastLikeUpdateAt: viewers.lastLikeUpdateAt,
      lastUpdatedAt: viewers.lastViewerUpdateAt,
      source: "tiktok-live-connector-observed"
    },gifts:{giftUsers:new Set(gifts.map(g=>g.userId)).size,giftEvents:gifts.length,giftQuantity:gifts.reduce((s,g)=>s+Number(g.repeatCount||0),0),knownDiamonds:gifts.filter(g=>g.valueKnown).reduce((s,g)=>s+Number(g.totalDiamonds||0),0),unknownValueGiftEvents:gifts.filter(g=>!g.valueKnown).length,giftUsersWaitingForQuestion:attention.filter(a=>a.attentionStatus==="waiting_question").length,giftQuestionsUnanswered:threads.filter(q=>q.giftPriority&&!q.answered).length,giftQuestionsAnswered:threads.filter(q=>q.giftSummary&&q.answered).length,giftAttentionUnacknowledged:attention.filter(a=>!a.acknowledged&&a.attentionStatus!=="linked").length}
  };
}
