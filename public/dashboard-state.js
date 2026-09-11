export function initialDashboardState() {
  return {
    comments: [], questions: [], users: [], gifts: [], giftAttention: [], giftSettings: {},
    target: { username: "kathyuyen.ta", displayUsername: "@kathyuyen.ta" },
    settings: { recentTargets: ["kathyuyen.ta"], questionDebug: false }, activeSession: null, selectedSession: null, sessions: [],
    status: { state: "idle", message: "Chưa kết nối" },
    analytics: {
      questions: { unanswered: 0, answered: 0, total: 0, completionRate: 0, averageWaitSeconds: 0 },
      viewers: { current: null, peak: null, memberJoinEvents: 0, uniqueJoinedUsers: 0, lastUpdatedAt: null, source: "tiktok-live-connector-observed" },
      gifts: { giftUsers:0, giftEvents:0, giftQuantity:0, knownDiamonds:0, unknownValueGiftEvents:0, giftUsersWaitingForQuestion:0, giftQuestionsUnanswered:0, giftQuestionsAnswered:0, giftAttentionUnacknowledged:0 }
    },
    tab: "unanswered"
  };
}

function array(value) { return Array.isArray(value) ? value : []; }

export function normalizeDashboardPayload(payload = {}, current = initialDashboardState()) {
  return {
    ...current,
    target: payload.target && typeof payload.target === "object" ? { ...current.target, ...payload.target } : current.target,
    settings: payload.settings && typeof payload.settings === "object" ? { ...current.settings, ...payload.settings } : current.settings,
    activeSession: payload.activeSession && typeof payload.activeSession === "object" ? payload.activeSession : null,
    selectedSession: payload.selectedSession && typeof payload.selectedSession === "object" ? payload.selectedSession : (payload.activeSession && typeof payload.activeSession === "object" ? payload.activeSession : current.selectedSession),
    sessions: array(payload.sessions),
    status: payload.status && typeof payload.status === "object" ? { ...current.status, ...payload.status } : current.status,
    comments: array(payload.comments),
    questions: array(payload.questions),
    users: array(payload.users),
    gifts: array(payload.gifts), giftAttention: array(payload.giftAttention), giftSettings: payload.giftSettings || current.giftSettings,
    analytics: payload.analytics && typeof payload.analytics === "object" ? {
      questions: { ...current.analytics.questions, ...(payload.analytics.questions || {}) },
      viewers: { ...current.analytics.viewers, ...(payload.analytics.viewers || {}) },
      gifts: { ...(current.analytics.gifts || {}), ...(payload.analytics.gifts || {}) }
    } : current.analytics
  };
}

export function mergeQuestionUpdate(state, payload) {
  if (!payload || typeof payload.id !== "string" || !payload.id) return false;
  if (!Array.isArray(state.questions)) state.questions = [];
  const index = state.questions.findIndex(item => item?.id === payload.id);
  if (index >= 0) {
    const previous = state.questions[index] || {};
    state.questions[index] = {
      ...previous,
      ...payload,
      occurrences: Array.isArray(payload.occurrences) ? payload.occurrences : array(previous.occurrences),
      commentIds: Array.isArray(payload.commentIds) ? payload.commentIds : array(previous.commentIds)
    };
  } else {
    if (typeof payload.userId !== "string" || typeof payload.canonicalText !== "string") return false;
    state.questions.push({ occurrences: [], commentIds: [], ...payload });
  }
  return true;
}

export function acceptsSessionEvent(state, payload) {
  return Boolean(payload?.sessionId && state.selectedSession?.id && payload.sessionId === state.selectedSession.id);
}

export function clearSelectedSessionState(state, session = null) {
  state.selectedSession = session; state.comments = []; state.questions = []; state.users = [];
  state.analytics = initialDashboardState().analytics; return state;
}

export function mergeUserUpdate(state, payload) {
  if (!payload || typeof payload.userId !== "string" || !payload.userId) return false;
  if (!Array.isArray(state.users)) state.users = [];
  const index = state.users.findIndex(item => item?.userId === payload.userId);
  if (index >= 0) state.users[index] = { ...state.users[index], ...payload };
  else state.users.push(payload);
  return true;
}

export function mergeViewerUpdate(state, payload) {
  if (!payload || typeof payload !== "object") return false;
  const viewers = state.analytics?.viewers || {};
  state.analytics = {
    ...(state.analytics || {}),
    viewers: {
      ...viewers,
      current: Number.isFinite(payload.currentViewers) ? payload.currentViewers : viewers.current ?? null,
      peak: Number.isFinite(payload.peakViewers) ? payload.peakViewers : viewers.peak ?? null,
      memberJoinEvents: Number.isInteger(payload.memberJoinEvents) ? payload.memberJoinEvents : viewers.memberJoinEvents || 0,
      uniqueJoinedUsers: Number.isInteger(payload.uniqueJoinedUsers) ? payload.uniqueJoinedUsers : viewers.uniqueJoinedUsers || 0,
      totalLikes: Number.isSafeInteger(payload.totalLikes) && payload.totalLikes >= 0 ? payload.totalLikes : viewers.totalLikes ?? null,
      lastLikeUpdateAt: payload.lastLikeUpdateAt || viewers.lastLikeUpdateAt || null,
      lastUpdatedAt: payload.lastViewerUpdateAt || viewers.lastUpdatedAt || null,
      source: "tiktok-live-connector-observed"
    }
  };
  return true;
}

export function snapshotQuestion(state, id) {
  const thread = array(state.questions).find(item => item?.id === id);
  return thread ? structuredClone(thread) : null;
}

export function setQuestionAnsweredLocally(state, id, answered, answeredAt = new Date().toISOString()) {
  return mergeQuestionUpdate(state, { id, answered, answeredAt: answered ? answeredAt : null });
}

export function setQuestionItemStatusLocally(state, threadId, itemId, status, updatedAt = new Date().toISOString()) {
  if (!["ANSWERED", "SKIPPED", "WAITING"].includes(status)) return false;
  const thread = array(state.questions).find(candidate => candidate?.id === threadId);
  if (!thread || !Array.isArray(thread.questionItems)) return false;
  const item = thread.questionItems.find(candidate => candidate?.id === itemId);
  if (!item) return false;

  item.status = status;
  item.updatedAt = updatedAt;
  item.answeredAt = status === "ANSWERED" ? updatedAt : null;
  item.skippedAt = status === "SKIPPED" ? updatedAt : null;

  const pending = thread.questionItems
    .filter(candidate => ["WAITING", "ACTIVE", "NEEDS_REVIEW"].includes(candidate.status))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const active = pending[0] || null;
  for (const candidate of thread.questionItems) {
    if (candidate.status === "ACTIVE" && candidate !== active) candidate.status = "WAITING";
  }
  if (active?.status === "WAITING") active.status = "ACTIVE";

  thread.activeQuestionId = active?.id || null;
  thread.activeQuestion = active ? { ...active } : null;
  thread.answered = !active;
  thread.answeredAt = thread.answered ? (thread.answeredAt || updatedAt) : null;
  if (active) {
    thread.canonicalText = active.text || active.rawText || thread.canonicalText;
    thread.normalizedText = active.normalizedText || thread.normalizedText;
  }
  return true;
}

export function restoreQuestion(state, snapshot) {
  return snapshot ? mergeQuestionUpdate(state, snapshot) : false;
}

export function selectQuestions(state, { answered, search = "", sort = "queue", minutes = 0 } = {}) {
  const query = String(search).trim().toLowerCase();
  const cutoff = minutes > 0 ? Date.now() - minutes * 60_000 : null;
  const rows = array(state.questions).filter(thread => thread && thread.deleted !== true && (!state.selectedSession?.id || thread.sessionId === state.selectedSession.id) &&
    (typeof answered !== "boolean" || Boolean(thread.answered) === answered) &&
    (!query || `${thread.canonicalText || ""} ${thread.nickname || ""} ${thread.username || ""}`.toLowerCase().includes(query)) &&
    (!cutoff || new Date(thread.lastAskedAt).getTime() >= cutoff));
  if (sort === "queue") rows.sort((a,b) => {
    const manualFirst=state.giftSettings?.manualPriorityOverridesGift!==false;
    const pin=Number(Boolean(b.manualPinned))-Number(Boolean(a.manualPinned));if(manualFirst&&pin)return pin;
    if(state.giftSettings?.enabled!==false&&state.giftSettings?.giftPriorityEnabled!==false){const gift=Number(Boolean(b.giftPriority))-Number(Boolean(a.giftPriority));if(gift)return gift;if(a.giftPriority&&b.giftPriority){const diamonds=Number(b.giftSummary?.totalDiamonds||0)-Number(a.giftSummary?.totalDiamonds||0);if(diamonds)return diamonds;const time=String(a.giftPriorityAt||"").localeCompare(String(b.giftPriorityAt||""));if(time)return time}}
    if(!manualFirst&&pin)return pin;return(a.priorityRank??a.queueNumber??Infinity)-(b.priorityRank??b.queueNumber??Infinity)||(a.queueNumber??Infinity)-(b.queueNumber??Infinity);
  });
  else if (sort === "repeats") rows.sort((a, b) => (b.repeatCount || 0) - (a.repeatCount || 0) || String(b.lastAskedAt).localeCompare(String(a.lastAskedAt)));
  else if (sort === "oldest") rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  else if (sort === "asked") rows.sort((a, b) => String(b.lastAskedAt).localeCompare(String(a.lastAskedAt)));
  else if (sort === "user") rows.sort((a, b) => String(a.nickname || a.username).localeCompare(String(b.nickname || b.username), "vi"));
  else if (sort === "answered") rows.sort((a, b) => String(b.answeredAt).localeCompare(String(a.answeredAt)));
  else rows.sort((a, b) => String(b.lastAskedAt).localeCompare(String(a.lastAskedAt)));
  return rows;
}

export function emptyStateFor(tab) {
  if (tab === "gifts") return { title: "Không có gift cần chú ý", detail: "Gift chưa có câu hỏi sẽ xuất hiện tại đây." };
  if (tab === "answered") return { title: "Chưa có câu đã trả", detail: "Các câu hoàn thành sẽ được lưu tại đây." };
  if (tab === "users") return { title: "Chưa ghi nhận người hỏi", detail: "Người đặt câu hỏi sẽ xuất hiện tại đây." };
  return { title: "Đã xử lý hết câu hỏi trong hàng chờ.", detail: "Câu hỏi mới sẽ tự động xuất hiện tại đây." };
}
