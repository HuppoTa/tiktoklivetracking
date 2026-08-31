export function initialDashboardState() {
  return {
    comments: [], questions: [], users: [],
    target: { username: "kathyuyen.ta", displayUsername: "@kathyuyen.ta" },
    settings: { recentTargets: ["kathyuyen.ta"] }, activeSession: null,
    status: { state: "idle", message: "Chưa kết nối" },
    analytics: {
      questions: { unanswered: 0, answered: 0, total: 0, completionRate: 0, averageWaitSeconds: 0 },
      viewers: { current: null, peak: null, memberJoinEvents: 0, uniqueJoinedUsers: 0, lastUpdatedAt: null, source: "tiktok-live-connector-observed" }
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
    activeSession: payload.activeSession && typeof payload.activeSession === "object" ? payload.activeSession : current.activeSession,
    status: payload.status && typeof payload.status === "object" ? { ...current.status, ...payload.status } : current.status,
    comments: array(payload.comments),
    questions: array(payload.questions),
    users: array(payload.users),
    analytics: payload.analytics && typeof payload.analytics === "object" ? {
      questions: { ...current.analytics.questions, ...(payload.analytics.questions || {}) },
      viewers: { ...current.analytics.viewers, ...(payload.analytics.viewers || {}) }
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

export function restoreQuestion(state, snapshot) {
  return snapshot ? mergeQuestionUpdate(state, snapshot) : false;
}

export function selectQuestions(state, { answered, search = "", sort = "latest", minutes = 0 } = {}) {
  const query = String(search).trim().toLowerCase();
  const cutoff = minutes > 0 ? Date.now() - minutes * 60_000 : null;
  const rows = array(state.questions).filter(thread => thread &&
    (typeof answered !== "boolean" || Boolean(thread.answered) === answered) &&
    (!query || `${thread.canonicalText || ""} ${thread.nickname || ""} ${thread.username || ""}`.toLowerCase().includes(query)) &&
    (!cutoff || new Date(thread.lastAskedAt).getTime() >= cutoff));
  if (sort === "repeats") rows.sort((a, b) => (b.repeatCount || 0) - (a.repeatCount || 0) || String(b.lastAskedAt).localeCompare(String(a.lastAskedAt)));
  else if (sort === "oldest") rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  else if (sort === "asked") rows.sort((a, b) => String(b.lastAskedAt).localeCompare(String(a.lastAskedAt)));
  else if (sort === "user") rows.sort((a, b) => String(a.nickname || a.username).localeCompare(String(b.nickname || b.username), "vi"));
  else if (sort === "answered") rows.sort((a, b) => String(b.answeredAt).localeCompare(String(a.answeredAt)));
  else rows.sort((a, b) => String(b.lastAskedAt).localeCompare(String(a.lastAskedAt)));
  return rows;
}

export function emptyStateFor(tab) {
  if (tab === "answered") return { title: "Chưa có câu đã trả", detail: "Các câu hoàn thành sẽ được lưu tại đây." };
  if (tab === "users") return { title: "Chưa ghi nhận người hỏi", detail: "Người đặt câu hỏi sẽ xuất hiện tại đây." };
  return { title: "Đã xử lý hết câu hỏi trong hàng chờ.", detail: "Câu hỏi mới sẽ tự động xuất hiện tại đây." };
}
