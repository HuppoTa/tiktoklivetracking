import {
  acceptsSessionEvent, clearSelectedSessionState, emptyStateFor, initialDashboardState, mergeQuestionUpdate, mergeUserUpdate,
  mergeViewerUpdate, normalizeDashboardPayload, restoreQuestion, selectQuestions,
  setQuestionAnsweredLocally, snapshotQuestion
} from "./dashboard-state.js";
import { normalizeTargetInput } from "./target-input.js";
import { addGiftNotification, clearGiftNotifications, createGiftNotificationStore, dismissGiftNotification } from "./gift-notifications.js";

const API_BASE = String(globalThis.__APP_CONFIG__?.apiBaseUrl || "").replace(/\/$/, "");
const SOCKET_URL = String(globalThis.__APP_CONFIG__?.socketUrl || API_BASE || "").replace(/\/$/, "");
const TOKEN_KEY = "live-comment-hub-auth-token";
let authToken = sessionStorage.getItem(TOKEN_KEY) || "";
const socket = io(SOCKET_URL || undefined, { autoConnect: false, auth: callback => callback({ token: authToken }) });
let state = initialDashboardState();
const pendingThreads = new Set();
const pendingUsers = new Set();
const giftNotifications=createGiftNotificationStore({maxVisible:4}),giftNotificationTimers=new Map(),giftHighlights=new Map();
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function formatTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "Chưa có";
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)} giây`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} phút`;
  return `${Math.floor(seconds / 3600)}g ${Math.round((seconds % 3600) / 60)}p`;
}

function waitSeconds(thread) {
  const end = new Date(thread?.answeredAt).getTime();
  const start = new Date(thread?.createdAt).getTime();
  return Number.isFinite(end - start) && end >= start ? Math.round((end - start) / 1000) : null;
}

function initials(item = {}) {
  return String(item.nickname || item.username || "?").split(/\s+/).filter(Boolean).map(part => part[0]).slice(-2).join("").toUpperCase();
}

function avatar(item = {}) {
  return item.avatar ? `<img class="avatar" src="${esc(item.avatar)}" alt="" loading="lazy">` : `<span class="avatar fallback">${esc(initials(item))}</span>`;
}

function allQuestions() { return Array.isArray(state.questions) ? state.questions.filter(Boolean) : []; }
function allUsers() { return Array.isArray(state.users) ? state.users.filter(Boolean) : []; }
function userThreadCount(userId) { return allQuestions().filter(thread => thread.userId === userId).length; }

function questionCard(thread) {
  if (!thread || typeof thread.id !== "string") return "";
  const occurrences = Array.isArray(thread.occurrences) ? thread.occurrences.filter(Boolean) : [];
  const pending = pendingThreads.has(thread.id);
  const completedDetails = thread.answered ? `<div class="completedDetails"><span>Hỏi lần đầu <b>${formatTime(thread.createdAt)}</b></span><span>Hỏi gần nhất <b>${formatTime(thread.lastAskedAt)}</b></span><span>Trả bài <b>${formatTime(thread.answeredAt)}</b></span><span>Thời gian chờ <b>${formatDuration(waitSeconds(thread))}</b></span></div>` : "";
  return `<article class="questionCard ${thread.answered ? "answered" : ""} ${pending ? "isLoading" : ""}" data-thread-id="${esc(thread.id)}">
    <label class="answerCheck" title="${thread.answered ? "Hoàn tác" : "Đánh dấu đã trả bài"}"><input type="checkbox" data-answer-thread="${esc(thread.id)}" ${thread.answered ? "checked" : ""} ${pending ? "disabled" : ""}><span></span></label>
    <div class="questionBody">
      <div class="personRow">${avatar(thread)}<div><b>${esc(thread.nickname || "Không rõ")}</b><small>@${esc(thread.username || "unknown")}</small></div><time>${formatTime(thread.lastAskedAt)}</time></div>
      <p class="questionText">${esc(thread.canonicalText || "Nội dung không khả dụng")}</p>
      <div class="meta">
        <span class="pill queueNumber">#${Number(thread.queueNumber) || "—"}</span>
        <span class="pill">${thread.source === "manual_entry" ? "Nhập tay" : thread.source === "promoted_comment" ? "Nâng từ comment" : "Tự động"}</span>
        ${thread.giftSummary?`<span class="pill repeat">🎁 ${esc(thread.giftSummary.lastGiftName)} ×${thread.giftSummary.lastGiftQuantity}${thread.giftSummary.valueKnown?` · ${thread.giftSummary.totalDiamonds} 💎`:""}</span>`:""}
        ${thread.manualPinned?'<span class="pill repeat">📌 Đã ghim</span>':""}
        ${(thread.repeatCount || 1) > 1 ? `<span class="pill repeat">Lặp ${Number(thread.repeatCount) || 1} lần</span>` : ""}
        <span class="pill">Người này có ${userThreadCount(thread.userId)} câu hỏi</span>
        ${thread.possibleDuplicate ? '<span class="pill possible">Có thể trùng</span>' : ""}
        ${thread.needsReview ? '<span class="pill possible">Cần kiểm tra</span>' : ""}
        ${thread.detectedTopic ? `<span class="pill">${esc(thread.detectedTopic)}</span>` : ""}
        ${Number.isFinite(thread.confidenceScore) ? `<span class="pill">${Math.round(thread.confidenceScore * 100)}%</span>` : ""}
        ${thread.contextMerged ? '<span class="pill repeat">Ghép nhiều comment</span>' : ""}
        ${state.settings?.questionDebug ? `<span class="pill possible">Score ${Number(thread.occurrences?.at(-1)?.questionScore || 0).toFixed(2)} · ${esc((thread.occurrences?.at(-1)?.questionReasons || []).join(", "))}</span>` : ""}
        ${thread.answered ? `<button class="inlineUndo" data-undo-thread="${esc(thread.id)}" ${pending ? "disabled" : ""}>Hoàn tác</button>` : ""}
        ${["manual_entry","promoted_comment"].includes(thread.source) ? `<button class="inlineUndo" data-archive-thread="${esc(thread.id)}">Ẩn khỏi hàng đợi</button>` : ""}
        ${!thread.answered ? `<span class="priorityControls"><button class="priorityBtn" data-pin-thread="${esc(thread.id)}" data-pinned="${thread.manualPinned?'false':'true'}">${thread.manualPinned?'Bỏ ghim':'Ghim'}</button><button class="priorityBtn" data-priority="move_to_top" data-thread="${esc(thread.id)}">Lên đầu</button><button class="priorityBtn" data-priority="move_up" data-thread="${esc(thread.id)}">↑</button><button class="priorityBtn" data-priority="move_down" data-thread="${esc(thread.id)}">↓</button></span>` : ""}
      </div>
      ${completedDetails}
      <details class="history"><summary>Xem ${occurrences.length} lượt gửi gốc</summary>${occurrences.map(item => `<div><time>${formatTime(item.timestamp)}</time><p>${esc(item.text || "")}</p></div>`).join("")}</details>
    </div>
  </article>`;
}

function safeQuestionCard(thread) {
  try { return questionCard(thread); }
  catch (error) { reportError(error, "Không thể hiển thị một câu hỏi"); return ""; }
}

function userCard(user) {
  if (!user || typeof user.userId !== "string") return "";
  const threads = allQuestions().filter(thread => thread.userId === user.userId);
  const allAnswered = threads.length > 0 && threads.every(thread => thread.answered);
  const pending = pendingUsers.has(user.userId);
  return `<details class="userCard" data-user-id="${esc(user.userId)}">
    <summary>${avatar(user)}<div class="userTitle"><b>${esc(user.nickname || "Không rõ")}</b><small>@${esc(user.username || "unknown")}</small><p>${Number(user.uniqueQuestions) || threads.length} câu hỏi · ${Number(user.unansweredQuestions) || 0} câu chưa trả · ${Number(user.totalQuestions) || 0} lần gửi</p></div><span class="expand">⌄</span></summary>
    <div class="userActions"><button class="smallBtn" data-answer-user="${esc(user.userId)}" data-value="${allAnswered ? "false" : "true"}" ${pending ? "disabled" : ""}>${allAnswered ? "Hoàn tác tất cả" : "Đánh dấu tất cả đã trả"}</button></div>
    <div class="userThreads">${threads.map(safeQuestionCard).join("") || '<div class="empty compact"><b>Không có câu hỏi phù hợp</b></div>'}</div>
  </details>`;
}

function updateSortOptions() {
  const select = $("sort");
  const previous = select.value;
  const options = state.tab === "answered" ? [
    ["answered", "Trả gần nhất"], ["asked", "Hỏi gần nhất"], ["repeats", "Lặp nhiều nhất"], ["user", "Theo người hỏi"]
  ] : [["queue", "Thứ tự hàng đợi"], ["latest", "Mới nhất"], ["repeats", "Lặp nhiều nhất"], ["oldest", "Chờ lâu nhất"]];
  select.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  if (options.some(([value]) => value === previous)) select.value = previous;
  select.disabled = state.tab === "users";
  $("timeRange").disabled = state.tab === "users";
}

function renderQueue() {
  let html = "";
  if(state.tab==="gifts"){html=(state.giftAttention||[]).filter(a=>!a.acknowledged).map(a=>{const userQuestions=allQuestions().filter(q=>q.userId===a.userId&&!q.archived&&!q.deleted),eligible=userQuestions.filter(q=>!q.answered);return`<article class="questionCard"><div>🎁</div><div><b>${esc(a.nickname||a.username||"Không rõ")}</b><p>${esc(a.lastGiftName||"Gift")} ×${Number(a.lastGiftQuantity||0)} ${a.valueKnown?`· ${Number(a.totalDiamonds||0)} 💎`:"· chưa rõ giá trị"}</p><small>${a.attentionStatus==="linked"?`✓ Câu hỏi #${allQuestions().find(q=>q.id===a.linkedQuestionId)?.queueNumber||"—"} · Ưu tiên quà`:a.attentionStatus==="gift_after_answer"?"Đã tặng quà · câu trước đã trả":"Chưa có câu hỏi"}</small><div class="priorityControls"><button class="smallBtn" data-focus-comment-user="${esc(a.userId)}">Xem comment</button>${eligible.length?`<select data-gift-question="${esc(a.userId)}">${eligible.map(q=>`<option value="${esc(q.id)}" ${q.id===a.linkedQuestionId?'selected':''}>#${q.queueNumber} ${esc(q.canonicalText).slice(0,45)}</option>`).join("")}</select><button class="smallBtn" data-assign-gift="${esc(a.userId)}">Chuyển vào câu hỏi</button>`:""}${userQuestions.length?`<button class="smallBtn" data-focus-thread="${esc((userQuestions.find(q=>q.id===a.linkedQuestionId)||userQuestions.at(-1)).id)}">Xem câu gần nhất</button>`:""}<button class="smallBtn" data-ack-gift="${esc(a.userId)}">Đã thấy</button></div></div></article>`}).join("");}
  else if (state.tab === "users") {
    const query = $("search").value.trim().toLowerCase();
    html = allUsers().filter(user => `${user.nickname || ""} ${user.username || ""}`.toLowerCase().includes(query)).map(user => {
      try { return userCard(user); } catch (error) { reportError(error, "Không thể hiển thị một người hỏi"); return ""; }
    }).join("");
  } else {
    html = selectQuestions(state, {
      answered: state.tab === "answered", search: $("search").value,
      sort: $("sort").value, minutes: Number($("timeRange").value) || 0
    }).filter(thread => state.tab !== "review" || thread.needsReview === true).map(safeQuestionCard).join("");
  }
  if (!html) {
    const empty = emptyStateFor(state.tab);
    html = `<div class="empty"><b>${esc(empty.title)}</b><span>${esc(empty.detail)}</span></div>`;
  }
  $("queue").innerHTML = html;
}

function questionMetrics() {
  const threads = allQuestions();
  const answered = threads.filter(thread => thread.answered);
  const waits = answered.map(waitSeconds).filter(Number.isFinite);
  return {
    unanswered: threads.length - answered.length, answered: answered.length, total: threads.length,
    completionRate: threads.length ? answered.length / threads.length * 100 : 0,
    averageWaitSeconds: waits.length ? waits.reduce((sum, value) => sum + value, 0) / waits.length : 0
  };
}

function renderStats() {
  const metrics = questionMetrics();
  const viewers = state.analytics?.viewers || {};
  $("currentViewers").textContent = Number.isFinite(viewers.current) ? viewers.current.toLocaleString("vi-VN") : "—";
  $("peakViewers").textContent = Number.isFinite(viewers.peak) ? viewers.peak.toLocaleString("vi-VN") : "—";
  $("unansweredCount").textContent = metrics.unanswered;
  $("answeredCount").textContent = metrics.answered;
  $("completionRate").textContent = `${metrics.completionRate.toFixed(1)}%`;
  $("unansweredBadge").textContent = metrics.unanswered;
  $("memberJoinEvents").textContent = Number(viewers.memberJoinEvents || 0).toLocaleString("vi-VN");
  $("uniqueJoinedUsers").textContent = Number(viewers.uniqueJoinedUsers || 0).toLocaleString("vi-VN");
  $("averageWait").textContent = formatDuration(metrics.averageWaitSeconds);
  $("commentCount").textContent = Array.isArray(state.comments) ? state.comments.length : 0;
  $("giftBadge").textContent=(state.giftAttention||[]).filter(a=>!a.acknowledged).length;
  renderViewerFreshness();
}

function renderViewerFreshness() {
  const lastUpdated = state.analytics?.viewers?.lastUpdatedAt;
  const label = $("viewerFreshness");
  if (!lastUpdated) { label.textContent = "Chưa nhận dữ liệu viewer"; label.className = "stale"; return; }
  const seconds = Math.max(0, Math.round((Date.now() - new Date(lastUpdated).getTime()) / 1000));
  label.textContent = seconds > 60 ? "Dữ liệu viewer đã cũ" : `LIVE · cập nhật viewer ${seconds} giây trước`;
  label.className = seconds > 60 ? "stale" : "fresh";
}

function renderComments() {
  const comments = Array.isArray(state.comments) ? state.comments : [];
  const linked = new Set(allQuestions().flatMap(item => item.commentIds || []));
  $("comments").innerHTML = comments.slice(-60).reverse().map(comment => {const gift=(state.giftAttention||[]).find(a=>a.userId===comment.userId);return `<article class="liveComment" data-comment-user="${esc(comment.userId)}">${avatar(comment)}<div><div><b>${esc(comment.nickname || "Không rõ")}</b><time>${formatTime(comment.timestamp)}</time></div><p>${esc(comment.text || "")}</p>${gift?`<span class="pill repeat">🎁 Đã tặng ${esc(gift.lastGiftName)} ×${gift.lastGiftQuantity}</span>`:""}${linked.has(comment.id) ? '<span class="pill">Đã có trong hàng đợi</span>' : `<button class="commentAction" data-promote-comment="${esc(comment.id)}">Thêm vào câu hỏi</button>`}</div></article>`}).join("") || '<div class="empty"><b>Chưa có comment</b></div>';
}

function renderStatus() {
  const historical = state.selectedSession?.id && state.selectedSession.id !== state.activeSession?.id;
  $("message").textContent = historical ? `Đang xem lịch sử phiên ${formatTime(state.selectedSession.startedAt)}` : (state.status?.message || "Chưa kết nối");
  const badge = $("liveBadge");
  const connectionState = state.status?.state || "idle";
  badge.className = `badge ${connectionState}`;
  badge.innerHTML = `<i></i> ${connectionState === "live" ? "ĐANG LIVE" : connectionState === "connecting" ? "KẾT NỐI" : "OFFLINE"}`;
  $("toggle").textContent = ["live", "connecting"].includes(connectionState) ? "Dừng thu" : "Bắt đầu thu"; $("toggle").disabled = historical;
  $("headerTarget").textContent = state.target?.displayUsername || `@${state.status?.username || "kathyuyen.ta"}`;
  $("changeTarget").disabled = connectionState === "switching";
  $("retry").hidden = connectionState !== "offline";
}

function renderSessions() {
  const rows = Array.isArray(state.sessions) ? state.sessions.filter(Boolean) : [];
  const selected = state.selectedSession;
  $("sessionSelect").innerHTML = rows.length ? rows.map(session => `<option value="${esc(session.id)}" ${session.id === selected?.id ? "selected" : ""}>${session.id === state.activeSession?.id ? "Phiên hiện tại" : formatTime(session.startedAt)} · @${esc(session.targetUsername)} · ${esc(session.status)}</option>`).join("") : '<option value="">Chưa có phiên LIVE</option>';
  $("sessionSelect").disabled = !rows.length;
  $("currentSession").hidden = !state.activeSession?.id || selected?.id === state.activeSession.id;
  $("endSession").disabled = !selected || selected.id !== state.activeSession?.id || selected.status === "ended";
  $("deleteSession").disabled = !selected || selected.id === state.activeSession?.id || selected.status === "live";
  $("resetAnswers").disabled = !selected;
  $("exportCsv").href = selected?.id ? `${API_BASE}/api/export.csv?sessionId=${encodeURIComponent(selected.id)}` : "#";
  const questionComments = (state.comments || []).filter(item => item?.question).length;
  const questionOccurrences = (state.questions || []).reduce((sum, item) => sum + (Array.isArray(item?.commentIds) ? item.commentIds.length : Number(item?.repeatCount || 0)), 0);
  const answeredThreads = (state.questions || []).filter(item => item?.answered === true && item?.deleted !== true).length;
  const summary = selected ? [
    ["TikTok", `@${selected.targetUsername || "unknown"}`], ["Room", selected.roomId ? `…${String(selected.roomId).slice(-8)}` : "Chưa có"],
    ["Trạng thái", selected.status || "—"], ["Tổng comment", state.comments.length], ["Comment là câu hỏi", questionComments],
    ["Question occurrences", questionOccurrences], ["Question threads", state.questions.length], ["Chưa trả", state.questions.length - answeredThreads],
    ["Đã trả", answeredThreads], ["Viewer peak", selected.peakViewers ?? state.analytics?.viewers?.peak ?? "—"]
  ] : [];
  $("sessionSummary").innerHTML = summary.length ? summary.map(([label, value]) => `<span>${esc(label)}<b>${esc(value)}</b></span>`).join("") : '<div class="empty compact"><b>Chưa có phiên LIVE.</b></div>';
}

function render() {
  try { renderStats(); renderQueue(); renderComments(); renderStatus(); renderSessions(); }
  catch (error) { reportError(error, "Dashboard gặp lỗi khi hiển thị. Dữ liệu vẫn được giữ nguyên."); }
}

function focusThread(id){state.tab=allQuestions().find(q=>q.id===id)?.answered?"answered":"unanswered";document.querySelectorAll(".tab").forEach(item=>item.classList.toggle("active",item.dataset.tab===state.tab));updateSortOptions();renderQueue();requestAnimationFrame(()=>{const card=document.querySelector(`[data-thread-id="${CSS.escape(id)}"]`);card?.scrollIntoView({behavior:"smooth",block:"center"});card?.focus?.()})}
function highlightThread(id){if(!id)return;clearTimeout(giftHighlights.get(id));requestAnimationFrame(()=>document.querySelector(`[data-thread-id="${CSS.escape(id)}"]`)?.classList.add("giftHighlight"));giftHighlights.set(id,setTimeout(()=>{document.querySelector(`[data-thread-id="${CSS.escape(id)}"]`)?.classList.remove("giftHighlight");giftHighlights.delete(id)},Math.max(0,Number(state.giftSettings?.highlightSeconds??8))*1000))}
function renderGiftNotifications(){const root=$("giftToasts");root.innerHTML=giftNotifications.items.map(item=>{const p=item.payload,g=p.gift,detail=p.questionId?`Đã ưu tiên câu hỏi #${allQuestions().find(q=>q.id===p.questionId)?.queueNumber||"—"}`:p.attention?.attentionStatus==="gift_after_answer"?"Câu trước đã trả":"Đã thêm vào Cần chú ý";return`<article class="giftToast" data-gift-toast="${esc(item.key)}" data-question="${esc(p.questionId||"")}"><b>🎁 ${esc(g.nickname||g.username||"Người xem")} · ${esc(g.giftName)} ×${item.quantity}</b><p>${item.diamonds===null?"Chưa rõ giá trị":`${item.diamonds} diamonds`} · ${esc(detail)}</p><small>Bấm để xem chi tiết</small><button data-dismiss-gift="${esc(item.key)}" aria-label="Đóng">×</button></article>`}).join("")}
function removeGiftToast(key){clearTimeout(giftNotificationTimers.get(key));giftNotificationTimers.delete(key);dismissGiftNotification(giftNotifications,key);renderGiftNotifications()}
function notifyGift(payload){if(state.giftSettings?.enabled===false||!acceptsSessionEvent(state,payload)||!addGiftNotification(giftNotifications,payload))return;const item=giftNotifications.items.find(x=>x.payload.eventId===payload.eventId||x.key.endsWith(`:${payload.gift.giftId||payload.gift.giftName}`));if(!item)return;clearTimeout(giftNotificationTimers.get(item.key));giftNotificationTimers.set(item.key,setTimeout(()=>removeGiftToast(item.key),Number(state.giftSettings?.notificationSeconds||4)*1000));renderGiftNotifications();if(payload.questionId)highlightThread(payload.questionId)}
$('giftToasts').addEventListener('click',event=>{const close=event.target.closest('[data-dismiss-gift]');if(close){event.stopPropagation();removeGiftToast(close.dataset.dismissGift);return}const card=event.target.closest('[data-gift-toast]');if(!card)return;if(card.dataset.question)focusThread(card.dataset.question);else{state.tab='gifts';document.querySelectorAll('.tab').forEach(item=>item.classList.toggle('active',item.dataset.tab==='gifts'));updateSortOptions();renderQueue()}});

function reportError(error, message = "Đã xảy ra lỗi") {
  console.error(error);
  const banner = $("errorBanner");
  if (!banner) return;
  banner.textContent = message;
  banner.hidden = false;
}

function clearError() { $("errorBanner").hidden = true; }

function toast(message, action) {
  $("toastMessage").textContent = message;
  const button = $("toastAction");
  button.hidden = !action;
  button.onclick = action ? async () => { button.disabled = true; await action(); button.disabled = false; } : null;
  $("toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("toast").classList.remove("show"), action ? 6000 : 2800);
}

function requestAuthToken() {
  const value = window.prompt("Nhập APP_AUTH_TOKEN để mở dashboard. Token chỉ được giữ trong tab hiện tại.", "");
  if (!value?.trim()) return false;
  authToken = value.trim();
  sessionStorage.setItem(TOKEN_KEY, authToken);
  return true;
}

async function requestJson(url, options = {}, allowAuthPrompt = true) {
  const headers = new Headers(options.headers || {});
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  const response = await fetch(`${API_BASE}${url}`, { ...options, headers });
  if (response.status === 401 && allowAuthPrompt && requestAuthToken()) return requestJson(url, options, false);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { throw new Error("Server trả dữ liệu không hợp lệ"); }
  if (!response.ok) { const error = new Error(data?.error?.message || data?.error || `Yêu cầu thất bại (${response.status})`); error.data = data; error.status = response.status; throw error; }
  return data;
}

async function updateThreadAnswered(id, answered, { showFeedback = true } = {}) {
  if (!id || pendingThreads.has(id)) return false;
  const snapshot = snapshotQuestion(state, id);
  if (!snapshot) { toast("Không tìm thấy câu hỏi"); return false; }
  pendingThreads.add(id);
  setQuestionAnsweredLocally(state, id, answered);
  renderStats(); renderQueue();
  try {
    const payload = await requestJson(`/api/questions/${encodeURIComponent(id)}/answered`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answered, sessionId: state.selectedSession?.id })
    });
    if (!payload || payload.id !== id) throw new Error("Server trả question update không đầy đủ");
    mergeQuestionUpdate(state, payload);
    clearError();
    if (showFeedback) {
      if (answered) toast("Đã đánh dấu trả bài", () => updateThreadAnswered(id, false));
      else toast("Đã hoàn tác, câu hỏi đã trở lại hàng chờ");
    }
    return true;
  } catch (error) {
    restoreQuestion(state, snapshot);
    reportError(error, `Không cập nhật được câu hỏi: ${error.message}`);
    toast(`Không thể cập nhật: ${error.message}`);
    return false;
  } finally {
    pendingThreads.delete(id);
    renderStats(); renderQueue();
  }
}

async function updateUserAnswered(userId, answered) {
  if (!userId || pendingUsers.has(userId)) return;
  const action = answered ? "đánh dấu tất cả đã trả" : "hoàn tác tất cả";
  if (!window.confirm(`Xác nhận ${action} cho người này?`)) return;
  pendingUsers.add(userId); renderQueue();
  try {
    const payload = await requestJson(`/api/users/${encodeURIComponent(userId)}/answered`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answered, sessionId: state.selectedSession?.id })
    });
    if (!payload || payload.userId !== userId) throw new Error("Server trả kết quả không hợp lệ");
    toast(answered ? `Đã đánh dấu ${payload.updated} câu đã trả` : `Đã hoàn tác ${payload.updated} câu`);
  } catch (error) {
    reportError(error, `Không cập nhật được người hỏi: ${error.message}`);
    toast(error.message);
  } finally { pendingUsers.delete(userId); renderQueue(); }
}

$("queue").addEventListener("change", event => {
  const id = event.target?.dataset?.answerThread;
  if (id) void updateThreadAnswered(id, Boolean(event.target.checked));
});
$("queue").addEventListener("click", event => {
  const undo = event.target.closest?.("[data-undo-thread]");
  if (undo) { void updateThreadAnswered(undo.dataset.undoThread, false); return; }
  const button = event.target.closest?.("[data-answer-user]");
  if (button) void updateUserAnswered(button.dataset.answerUser, button.dataset.value === "true");
  const priority = event.target.closest?.("[data-priority]");
  if (priority) void requestJson(`/api/questions/${encodeURIComponent(priority.dataset.thread)}/priority`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ sessionId:state.selectedSession?.id, action:priority.dataset.priority }) }).then(payload => { mergeQuestionUpdate(state,payload); renderQueue(); }).catch(error => reportError(error,error.message));
  const archive=event.target.closest?.("[data-archive-thread]"); if(archive){const id=archive.dataset.archiveThread,thread=allQuestions().find(item=>item.id===id);if(thread?.answered&&!window.confirm("Câu này đã trả bài. Vẫn ẩn khỏi hàng đợi?"))return;void requestJson(`/api/questions/${encodeURIComponent(id)}/archive`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:state.selectedSession?.id,archived:true})}).then(()=>{state.questions=state.questions.filter(item=>item.id!==id);render();toast("Đã ẩn câu hỏi",async()=>{const restored=await requestJson(`/api/questions/${encodeURIComponent(id)}/archive`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:state.selectedSession?.id,archived:false})});mergeQuestionUpdate(state,restored);render()})}).catch(error=>reportError(error,error.message));}
  const ack=event.target.closest?.("[data-ack-gift]");if(ack)void requestJson(`/api/gifts/attention/${encodeURIComponent(ack.dataset.ackGift)}/acknowledge`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:state.selectedSession?.id})}).then(()=>{state.giftAttention=state.giftAttention.filter(a=>a.userId!==ack.dataset.ackGift);render()}).catch(e=>reportError(e,e.message));
  const pin=event.target.closest?.("[data-pin-thread]");if(pin)void requestJson(`/api/questions/${encodeURIComponent(pin.dataset.pinThread)}/pin`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:state.selectedSession?.id,pinned:pin.dataset.pinned==="true"})}).then(payload=>{mergeQuestionUpdate(state,payload);renderQueue()}).catch(e=>reportError(e,e.message));
  const focus=event.target.closest?.("[data-focus-thread]");if(focus)focusThread(focus.dataset.focusThread);
  const focusComment=event.target.closest?.("[data-focus-comment-user]");if(focusComment)document.querySelector(`[data-comment-user="${CSS.escape(focusComment.dataset.focusCommentUser)}"]`)?.scrollIntoView({behavior:"smooth",block:"center"});
  const assign=event.target.closest?.("[data-assign-gift]");if(assign){const select=document.querySelector(`[data-gift-question="${CSS.escape(assign.dataset.assignGift)}"]`);if(select?.value)void requestJson(`/api/gifts/${encodeURIComponent(assign.dataset.assignGift)}/assign-question`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:state.selectedSession?.id,questionId:select.value})}).then(async()=>{state=normalizeDashboardPayload(await requestJson(`/api/state?sessionId=${encodeURIComponent(state.selectedSession.id)}`),state);render();focusThread(select.value)}).catch(e=>reportError(e,e.message))}
});

$("comments").addEventListener("click", event => { const button = event.target.closest?.("[data-promote-comment]"); if (!button) return;
  button.disabled = true; void requestJson(`/api/comments/${encodeURIComponent(button.dataset.promoteComment)}/promote-question`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({sessionId:state.selectedSession?.id}) })
    .then(payload => { mergeQuestionUpdate(state,payload); render(); toast(`Đã thêm câu #${payload.queueNumber} vào hàng đợi`); }).catch(error => reportError(error,error.message)).finally(() => { button.disabled=false; }); });

function openManualModal(){ $("manualUser").innerHTML='<option value="">Khách chưa xác định</option>'+allUsers().map(user=>`<option value="${esc(user.userId)}">${esc(user.nickname)} (@${esc(user.username)})</option>`).join(""); $("manualText").value=""; $("manualReason").value=""; $("manualError").hidden=true; $("manualModal").showModal(); }
$("manualQuestion").addEventListener("click",openManualModal); for(const id of ["closeManual","cancelManual"]) $(id).addEventListener("click",()=>$("manualModal").close());
$("manualForm").addEventListener("submit",async event=>{ event.preventDefault(); const body={sessionId:state.selectedSession?.id,userId:$("manualUser").value||null,nickname:$("manualNickname").value,text:$("manualText").value,reason:$("manualReason").value};
  try { let payload; try { payload=await requestJson('/api/questions/manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); } catch(error){ const suggestion=error.data?.duplicateSuggestion; if(!suggestion||!window.confirm(`Có câu tương tự (${Math.round(suggestion.score*100)}%). Gộp vào câu hiện có?`)) throw error; payload=await requestJson('/api/questions/manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,duplicateAction:'link_existing',targetThreadId:suggestion.threadId})}); } mergeQuestionUpdate(state,payload); $("manualModal").close(); render(); toast(`Đã thêm câu #${payload.queueNumber}`); } catch(error){ $("manualError").textContent=error.message; $("manualError").hidden=false; }});

document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item === button));
  state.tab = button.dataset.tab;
  updateSortOptions(); renderQueue();
}));
$("search").addEventListener("input", renderQueue);
$("sort").addEventListener("change", renderQueue);
$("timeRange").addEventListener("change", renderQueue);
$("toggle").addEventListener("click", () => fetch(["live", "connecting"].includes(state.status?.state) ? "/api/disconnect" : "/api/connect", { method: "POST" }).catch(error => reportError(error, "Không đổi được trạng thái collector")));
$("retry").addEventListener("click", () => fetch("/api/connect", { method: "POST" }).catch(error => reportError(error, "Không thể thử lại")));

function renderRecentTargets() {
  const recent = Array.isArray(state.settings?.recentTargets) ? state.settings.recentTargets : [];
  $("recentTargets").innerHTML = recent.map(username => `<button type="button" data-recent-target="${esc(username)}">@${esc(username)}</button>`).join("");
  $("recentBlock").hidden = !recent.length;
}
function validateTargetInput() {
  const valid = normalizeTargetInput($("targetInput").value);
  $("connectTarget").disabled = !valid;
  $("targetError").hidden = true;
  return valid;
}
function openTargetModal() {
  $("targetInput").value = state.target?.displayUsername || "";
  $("targetError").hidden = true; renderRecentTargets(); validateTargetInput();
  $("targetModal").showModal(); setTimeout(() => $("targetInput").focus(), 0);
}
function closeTargetModal() { if (!$("connectTarget").disabled || !$("targetInput").disabled) $("targetModal").close(); }
$("changeTarget").addEventListener("click", openTargetModal);
$("closeTarget").addEventListener("click", closeTargetModal);
$("cancelTarget").addEventListener("click", closeTargetModal);
$("targetInput").addEventListener("input", validateTargetInput);
$("recentTargets").addEventListener("click", event => { const button = event.target.closest("[data-recent-target]"); if (button) { $("targetInput").value = `@${button.dataset.recentTarget}`; validateTargetInput(); } });
$("targetModal").addEventListener("cancel", event => { if ($("targetInput").disabled) event.preventDefault(); });
$("targetForm").addEventListener("submit", async event => {
  event.preventDefault(); const username = validateTargetInput(); if (!username) return;
  const unanswered = allQuestions().filter(thread => !thread.answered).length;
  if (username !== state.target?.username && unanswered && !window.confirm(`Phiên hiện tại còn ${unanswered} câu hỏi chưa trả.\n\nĐổi sang @${username} sẽ đóng phiên hiện tại. Dữ liệu cũ vẫn được lưu trong lịch sử.\n\nBạn có muốn đổi tài khoản?`)) return;
  $("targetInput").disabled = true; $("connectTarget").disabled = true; $("cancelTarget").disabled = true; $("targetError").hidden = true;
  try {
    const data = await requestJson("/api/target", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
    if (data?.target) state.target = data.target;
    $("targetModal").close(); toast(data?.unchanged ? "Đang theo dõi tài khoản này" : `Đã chuyển sang @${username}`);
  } catch (error) {
    $("targetError").textContent = error.message; $("targetError").hidden = false;
  } finally { $("targetInput").disabled = false; $("cancelTarget").disabled = false; validateTargetInput(); }
});

async function loadSession(sessionId) {
  clearGiftNotifications(giftNotifications);for(const timer of giftNotificationTimers.values())clearTimeout(timer);giftNotificationTimers.clear();renderGiftNotifications();
  const previous = structuredClone(state);
  clearSelectedSessionState(state, (state.sessions || []).find(item => item.id === sessionId) || null); render();
  try { state = normalizeDashboardPayload(await requestJson(`/api/state?sessionId=${encodeURIComponent(sessionId)}`), state); clearError(); render(); }
  catch (error) { state = previous; reportError(error, `Không tải được phiên: ${error.message}`); render(); }
}
$("sessionSelect").addEventListener("change", event => { if (event.target.value) void loadSession(event.target.value); });
$("currentSession").addEventListener("click", () => { if (state.activeSession?.id) void loadSession(state.activeSession.id); });
$("endSession").addEventListener("click", async () => {
  const session = state.selectedSession; if (!session || session.id !== state.activeSession?.id) return;
  if (!window.confirm("Kết thúc phiên hiện tại? Comment và trạng thái trả bài vẫn được giữ.")) return;
  try { await requestJson(`/api/sessions/${encodeURIComponent(session.id)}/end`, { method: "POST" }); toast("Đã kết thúc phiên"); }
  catch (error) { reportError(error, error.message); }
});
$("startSession").addEventListener("click", async () => {
  const liveSession = state.activeSession?.status === "live" ? state.activeSession : null;
  if (liveSession && !window.confirm("Phiên đang LIVE sẽ được kết thúc trước khi bắt đầu phiên mới. Bạn muốn tiếp tục?")) return;
  try { if (liveSession) await requestJson(`/api/sessions/${encodeURIComponent(liveSession.id)}/end`, { method: "POST" }); const data = await requestJson("/api/sessions/start", { method: "POST" }); if (data?.session?.id) await loadSession(data.session.id); toast(data?.connection?.ok ? "Đã bắt đầu phiên mới" : "Đã tạo phiên chờ TikTok LIVE"); }
  catch (error) { reportError(error, error.message); }
});

let sessionAction = null;
function openSessionAction(type) {
  const session = state.selectedSession; if (!session) return;
  sessionAction = type; const deleting = type === "delete"; const phrase = deleting ? "XOA PHIEN" : "RESET TRA BAI";
  $("sessionModalTitle").textContent = deleting ? "Xóa dữ liệu phiên" : "Reset trạng thái trả bài";
  $("sessionModalSummary").textContent = deleting ? `Bạn sắp xóa đúng phiên @${session.targetUsername}, ${session.commentCount || 0} comment, ${session.questionCount || 0} câu hỏi và analytics. Backup riêng sẽ được tạo trước.` : `Giữ comment và thread của @${session.targetUsername}, đưa toàn bộ câu hỏi về chưa trả.`;
  $("sessionConfirmLabel").textContent = `Nhập ${phrase} để xác nhận`;
  $("sessionConfirmation").value = ""; $("sessionConfirmation").dataset.phrase = phrase; $("confirmSessionAction").disabled = true; $("sessionModal").showModal();
}
$("deleteSession").addEventListener("click", () => openSessionAction("delete"));
$("resetAnswers").addEventListener("click", () => openSessionAction("reset"));
$("sessionConfirmation").addEventListener("input", event => { $("confirmSessionAction").disabled = event.target.value !== event.target.dataset.phrase; });
for (const id of ["closeSessionModal", "cancelSessionAction"]) $(id).addEventListener("click", () => $("sessionModal").close());
$("sessionForm").addEventListener("submit", async event => {
  event.preventDefault(); const session = state.selectedSession; if (!session) return; const phrase = $("sessionConfirmation").dataset.phrase;
  try {
    if (sessionAction === "delete") await requestJson(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: phrase }) });
    else await requestJson(`/api/sessions/${encodeURIComponent(session.id)}/reset-answers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: phrase }) });
    $("sessionModal").close(); const fallback = state.activeSession?.id && state.activeSession.id !== session.id ? state.activeSession.id : null;
    state = normalizeDashboardPayload(await requestJson(fallback ? `/api/state?sessionId=${encodeURIComponent(fallback)}` : "/api/state"), state); render(); toast(sessionAction === "delete" ? "Đã xóa phiên sau khi tạo backup" : "Đã reset trạng thái trả bài");
  } catch (error) { reportError(error, error.message); }
});

function openGiftSettings(){const s=state.giftSettings||{};$("giftEnabled").checked=s.enabled!==false;$("giftHighlightSeconds").value=Number(s.highlightSeconds??8);$("giftNotificationSeconds").value=Number(s.notificationSeconds??4);$("giftManualFirst").checked=s.manualPriorityOverridesGift!==false;$("giftApplyTo").value=s.applyTo||"final-only";$("giftSettingsError").hidden=true;$("giftSettingsModal").showModal()}
$("giftSettingsButton").addEventListener("click",openGiftSettings);for(const id of ["closeGiftSettings","cancelGiftSettings"])$(id).addEventListener("click",()=>$("giftSettingsModal").close());
$("giftSettingsForm").addEventListener("submit",async event=>{event.preventDefault();const button=$("saveGiftSettings");button.disabled=true;button.textContent="Đang lưu…";const body={enabled:$("giftEnabled").checked,highlightSeconds:Number($("giftHighlightSeconds").value),notificationSeconds:Number($("giftNotificationSeconds").value),manualPriorityOverridesGift:$("giftManualFirst").checked,applyTo:$("giftApplyTo").value};try{state.giftSettings=await requestJson("/api/gift-settings",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});$("giftSettingsModal").close();render();toast("Đã lưu cài đặt quà")}catch(error){$("giftSettingsError").textContent=error.message;$("giftSettingsError").hidden=false}finally{button.disabled=false;button.textContent="Lưu"}});

window.addEventListener("error", event => reportError(event.error || new Error(event.message), "Giao diện gặp lỗi nhưng dữ liệu vẫn an toàn."));
window.addEventListener("unhandledrejection", event => reportError(event.reason, "Một thao tác chưa hoàn tất. Vui lòng thử lại."));

updateSortOptions();
requestJson("/api/state").then(data => { state = normalizeDashboardPayload(data, state); render(); socket.connect(); }).catch(error => reportError(error, "Không tải được dữ liệu dashboard"));
socket.on("connect_error", error => {
  if (String(error?.message || "").includes("UNAUTHORIZED")) {
    authToken = ""; sessionStorage.removeItem(TOKEN_KEY); socket.disconnect();
    reportError(error, "Token không hợp lệ. Tải lại trang để nhập lại.");
  }
});
socket.on("status", value => { if (value && typeof value === "object") state.status = { ...state.status, ...value }; renderStatus(); });
socket.on("comment", comment => { if (!acceptsSessionEvent(state, comment)) return; if (comment?.id && !(state.comments || []).some(item => item?.id === comment.id && item?.sessionId === comment.sessionId)) state.comments.push(comment); renderStats(); renderComments(); });
socket.on("question:created", thread => { if (acceptsSessionEvent(state, thread) && mergeQuestionUpdate(state, thread)) { renderStats(); renderQueue(); } });
socket.on("question:updated", thread => { if (acceptsSessionEvent(state, thread) && mergeQuestionUpdate(state, thread)) { renderStats(); renderQueue(); } });
for (const eventName of ["question:manually-created","question:promoted","question:priority-updated"]) socket.on(eventName, thread => { if (acceptsSessionEvent(state, thread) && mergeQuestionUpdate(state, thread)) render(); });
socket.on("user:updated", user => { if (acceptsSessionEvent(state, user) && mergeUserUpdate(state, user)) { renderStats(); renderQueue(); } });
socket.on("viewer:updated", viewers => { if (acceptsSessionEvent(state, viewers) && mergeViewerUpdate(state, viewers)) renderStats(); });
socket.on("gift:received",payload=>{if(!payload?.transient)notifyGift(payload)});
for(const eventName of ["gift:summary-updated","gift:attention-created","gift:attention-updated","gift:question-linked","gift:priority-updated","gift:acknowledged"])socket.on(eventName,payload=>{if(!acceptsSessionEvent(state,payload))return;const selectedId=state.selectedSession?.id;if(!selectedId)return;requestJson(`/api/state?sessionId=${encodeURIComponent(selectedId)}`).then(data=>{if(state.selectedSession?.id!==selectedId)return;state=normalizeDashboardPayload(data,state);render();if(payload.questionId)highlightThread(payload.questionId)}).catch(e=>reportError(e,"Không đồng bộ được gift"))});
socket.on("gift:settings-updated",payload=>{if(!payload?.settings)return;state.giftSettings={...state.giftSettings,...payload.settings};render()});
for (const eventName of ["session:created", "session:updated", "session:ended", "session:deleted", "session:answers-reset"]) socket.on(eventName, async payload => {
  const viewingActive = state.selectedSession?.id === state.activeSession?.id;
  if (eventName === "session:deleted" && payload?.sessionId === state.selectedSession?.id) { clearSelectedSessionState(state); render(); }
  try { const data = await requestJson(viewingActive || !state.selectedSession?.id ? "/api/state" : `/api/state?sessionId=${encodeURIComponent(state.selectedSession.id)}`); state = normalizeDashboardPayload(data, state); render(); } catch (error) { reportError(error, "Không đồng bộ được thay đổi phiên"); }
});
socket.on("target:changing", payload => { state.status = { ...state.status, state: "switching", username: payload?.username, message: "Đang chuyển tài khoản...", roomId: null }; renderStatus(); });
socket.on("target:changed", async payload => {
  clearGiftNotifications(giftNotifications);for(const timer of giftNotificationTimers.values())clearTimeout(timer);giftNotificationTimers.clear();renderGiftNotifications();
  state.target = { username: payload.username, displayUsername: `@${payload.username}` };
  state.activeSession = { id: payload.sessionId, targetUsername: payload.username, status: "connecting" };
  state.selectedSession = state.activeSession; state.comments = []; state.questions = []; state.users = [];
  state.analytics = initialDashboardState().analytics; render();
  try { state = normalizeDashboardPayload(await requestJson("/api/state"), state); render(); } catch (error) { reportError(error, "Không tải được phiên mới"); }
});
socket.on("target:error", payload => { reportError(new Error(payload?.message), payload?.message || "Không kết nối được tài khoản mới"); if ($("targetModal").open) { $("targetError").textContent = payload?.message || "Không kết nối được"; $("targetError").hidden = false; } });
setInterval(renderViewerFreshness, 10_000);
