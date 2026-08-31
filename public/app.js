import {
  emptyStateFor, initialDashboardState, mergeQuestionUpdate, mergeUserUpdate,
  mergeViewerUpdate, normalizeDashboardPayload, restoreQuestion, selectQuestions,
  setQuestionAnsweredLocally, snapshotQuestion
} from "./dashboard-state.js";
import { normalizeTargetInput } from "./target-input.js";

const socket = io();
let state = initialDashboardState();
const pendingThreads = new Set();
const pendingUsers = new Set();
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
        ${(thread.repeatCount || 1) > 1 ? `<span class="pill repeat">Lặp ${Number(thread.repeatCount) || 1} lần</span>` : ""}
        <span class="pill">Người này có ${userThreadCount(thread.userId)} câu hỏi</span>
        ${thread.possibleDuplicate ? '<span class="pill possible">Có thể trùng</span>' : ""}
        ${thread.answered ? `<button class="inlineUndo" data-undo-thread="${esc(thread.id)}" ${pending ? "disabled" : ""}>Hoàn tác</button>` : ""}
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
  ] : [["latest", "Mới nhất"], ["repeats", "Lặp nhiều nhất"], ["oldest", "Chờ lâu nhất"]];
  select.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  if (options.some(([value]) => value === previous)) select.value = previous;
  select.disabled = state.tab === "users";
  $("timeRange").disabled = state.tab === "users";
}

function renderQueue() {
  let html = "";
  if (state.tab === "users") {
    const query = $("search").value.trim().toLowerCase();
    html = allUsers().filter(user => `${user.nickname || ""} ${user.username || ""}`.toLowerCase().includes(query)).map(user => {
      try { return userCard(user); } catch (error) { reportError(error, "Không thể hiển thị một người hỏi"); return ""; }
    }).join("");
  } else {
    html = selectQuestions(state, {
      answered: state.tab === "answered", search: $("search").value,
      sort: $("sort").value, minutes: Number($("timeRange").value) || 0
    }).map(safeQuestionCard).join("");
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
  $("comments").innerHTML = comments.slice(-60).reverse().map(comment => `<article class="liveComment">${avatar(comment)}<div><div><b>${esc(comment.nickname || "Không rõ")}</b><time>${formatTime(comment.timestamp)}</time></div><p>${esc(comment.text || "")}</p></div></article>`).join("") || '<div class="empty"><b>Chưa có comment</b></div>';
}

function renderStatus() {
  $("message").textContent = state.status?.message || "Chưa kết nối";
  const badge = $("liveBadge");
  const connectionState = state.status?.state || "idle";
  badge.className = `badge ${connectionState}`;
  badge.innerHTML = `<i></i> ${connectionState === "live" ? "ĐANG LIVE" : connectionState === "connecting" ? "KẾT NỐI" : "OFFLINE"}`;
  $("toggle").textContent = ["live", "connecting"].includes(connectionState) ? "Dừng thu" : "Bắt đầu thu";
  $("headerTarget").textContent = state.target?.displayUsername || `@${state.status?.username || "kathyuyen.ta"}`;
  $("changeTarget").disabled = connectionState === "switching";
  $("retry").hidden = connectionState !== "offline";
}

function render() {
  try { renderStats(); renderQueue(); renderComments(); renderStatus(); }
  catch (error) { reportError(error, "Dashboard gặp lỗi khi hiển thị. Dữ liệu vẫn được giữ nguyên."); }
}

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

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { throw new Error("Server trả dữ liệu không hợp lệ"); }
  if (!response.ok) throw new Error(data?.error?.message || data?.error || `Yêu cầu thất bại (${response.status})`);
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
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answered })
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
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answered })
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
});

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

window.addEventListener("error", event => reportError(event.error || new Error(event.message), "Giao diện gặp lỗi nhưng dữ liệu vẫn an toàn."));
window.addEventListener("unhandledrejection", event => reportError(event.reason, "Một thao tác chưa hoàn tất. Vui lòng thử lại."));

updateSortOptions();
requestJson("/api/state").then(data => { state = normalizeDashboardPayload(data, state); render(); }).catch(error => reportError(error, "Không tải được dữ liệu dashboard"));
socket.on("status", value => { if (value && typeof value === "object") state.status = { ...state.status, ...value }; renderStatus(); });
socket.on("comment", comment => { if (comment?.id && !(state.comments || []).some(item => item?.id === comment.id)) state.comments.push(comment); renderStats(); renderComments(); });
socket.on("question:created", thread => { if (mergeQuestionUpdate(state, thread)) { renderStats(); renderQueue(); } });
socket.on("question:updated", thread => { if (mergeQuestionUpdate(state, thread)) { renderStats(); renderQueue(); } });
socket.on("user:updated", user => { if (mergeUserUpdate(state, user)) { renderStats(); renderQueue(); } });
socket.on("viewer:updated", viewers => { if (mergeViewerUpdate(state, viewers)) renderStats(); });
socket.on("target:changing", payload => { state.status = { ...state.status, state: "switching", username: payload?.username, message: "Đang chuyển tài khoản...", roomId: null }; renderStatus(); });
socket.on("target:changed", async payload => {
  state.target = { username: payload.username, displayUsername: `@${payload.username}` };
  state.activeSession = { id: payload.sessionId, targetUsername: payload.username, status: "connecting" };
  state.comments = []; state.questions = []; state.users = [];
  state.analytics = initialDashboardState().analytics; render();
  try { state = normalizeDashboardPayload(await requestJson("/api/state"), state); render(); } catch (error) { reportError(error, "Không tải được phiên mới"); }
});
socket.on("target:error", payload => { reportError(new Error(payload?.message), payload?.message || "Không kết nối được tài khoản mới"); if ($("targetModal").open) { $("targetError").textContent = payload?.message || "Không kết nối được"; $("targetError").hidden = false; } });
setInterval(renderViewerFreshness, 10_000);
