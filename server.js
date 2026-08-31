import express from "express";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from "tiktok-live-connector";
import { buildAnalytics, ViewerAnalytics } from "./src/analytics.js";
import { ConnectionGuard, retireConnection } from "./src/connection-guard.js";
import { QuestionService } from "./src/question-service.js";
import { SessionService } from "./src/session-service.js";
import { JsonStorage } from "./src/storage.js";
import { DEFAULT_TARGET, normalizeTargetInput, resolveTarget } from "./src/target.js";
import { normalizeQuestionEvent, normalizeTikTokEvent } from "./src/tiktok-normalizer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DISABLE_TIKTOK = process.env.DISABLE_TIKTOK === "1";
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "data");
const storage = new JsonStorage({ storeFile: join(DATA_DIR, "store.json"), legacyFile: join(DATA_DIR, "comments.json") });
const store = await storage.load();
const questions = new QuestionService(store);
const sessions = new SessionService(store);
let targetUsername = resolveTarget(process.env.TIKTOK_USERNAME, store.settings?.targetUsername);
if (sessions.active?.targetUsername !== targetUsername) sessions.switchTarget(targetUsername);
else sessions.ensureActive(targetUsername);
store.settings.targetUsername = targetUsername;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
app.use(express.static(join(__dirname, "public")));
app.use(express.json({ limit: "32kb" }));

const guard = new ConnectionGuard();
let connection = null;
let analyticsSaveTimer = null;
let status = { state: "idle", username: targetUsername, message: "Chưa kết nối", roomId: sessions.active?.roomId || null, lastCommentAt: null };

const targetPayload = () => ({ username: targetUsername, displayUsername: `@${targetUsername}` });
const activeSession = () => sessions.active;
const activeSessionId = () => activeSession()?.id;
const activeComments = () => store.comments.filter(comment => comment.sessionId === activeSessionId());
const activeThreads = () => store.questionThreads.filter(thread => thread.sessionId === activeSessionId());
const activeViewer = () => new ViewerAnalytics(activeSession()?.viewerAnalytics);

function setStatus(next, generation) {
  if (generation !== undefined && !guard.isCurrent(generation)) return;
  status = { ...status, ...next, username: targetUsername };
  io.emit("status", status);
}

function viewerPayload() { return activeViewer().payload(); }
function emitUser(userId) {
  const user = questions.getUsers(activeSessionId()).find(item => item.userId === userId);
  if (user) io.emit("user:updated", user);
}

function scheduleSave() {
  if (analyticsSaveTimer) return;
  analyticsSaveTimer = setTimeout(async () => {
    analyticsSaveTimer = null;
    try { await storage.save(); } catch (error) { console.error("Không lưu được analytics:", error.message); }
  }, 3000);
}

async function onChat(data, generation, sessionId, username) {
  if (!guard.isCurrent(generation) || activeSessionId() !== sessionId || targetUsername !== username) return;
  const normalized = normalizeTikTokEvent(data);
  if (!normalized) return;
  const comment = { ...normalized, sessionId, targetUsername: username };
  const result = questions.addComment(comment);
  if (result.duplicateMessage || !guard.isCurrent(generation) || activeSessionId() !== sessionId) return;
  try { await storage.save(); } catch (error) { console.error("Không lưu được comment:", error.message); return; }
  if (!guard.isCurrent(generation) || activeSessionId() !== sessionId) return;
  io.emit("comment", comment);
  if (result.thread) io.emit(result.threadCreated ? "question:created" : "question:updated", questions.enrichThread(result.thread));
  if (comment.question) emitUser(comment.userId);
  setStatus({ lastCommentAt: comment.timestamp }, generation);
}

function onRoomUser(data, generation, sessionId) {
  if (!guard.isCurrent(generation) || activeSessionId() !== sessionId) return;
  const analytics = activeViewer();
  const result = analytics.observeRoomUser(data);
  if (!result.updated) return;
  activeSession().viewerAnalytics = analytics.state;
  io.emit("viewer:updated", analytics.payload());
  if (result.sampled || result.changed) scheduleSave();
}

function onMember(data, generation, sessionId) {
  if (!guard.isCurrent(generation) || activeSessionId() !== sessionId) return;
  const analytics = activeViewer();
  const result = analytics.observeMember(data);
  if (!result.updated) return;
  activeSession().viewerAnalytics = analytics.state;
  io.emit("viewer:updated", analytics.payload());
  scheduleSave();
}

async function stopConnection() {
  const old = connection;
  connection = null;
  await retireConnection(guard, old);
}

function scheduleReconnect(generation, message) {
  if (!guard.isCurrent(generation)) return;
  sessions.markOffline();
  setStatus({ state: "offline", message, roomId: null }, generation);
  guard.schedule(generation, () => void connectTikTok(), 30000);
}

async function connectTikTok() {
  if (DISABLE_TIKTOK) return { ok: false, error: "TikTok connector đang tắt" };
  await stopConnection();
  const generation = guard.next();
  const sessionId = activeSessionId();
  const username = targetUsername;
  setStatus({ state: "connecting", message: `Đang kết nối @${username}...`, roomId: null }, generation);
  const current = new TikTokLiveConnection(username, { enableExtendedGiftInfo: false });
  connection = current;
  current.on(WebcastEvent.CHAT, data => void onChat(data, generation, sessionId, username));
  current.on(WebcastEvent.QUESTION_NEW, data => void onChat(normalizeQuestionEvent(data), generation, sessionId, username));
  current.on(WebcastEvent.ROOM_USER, data => onRoomUser(data, generation, sessionId));
  current.on(WebcastEvent.MEMBER, data => onMember(data, generation, sessionId));
  current.on(WebcastEvent.STREAM_END, () => scheduleReconnect(generation, `@${username} hiện chưa livestream. Hệ thống sẽ tự thử lại sau 30 giây.`));
  current.on(ControlEvent.DISCONNECTED, () => scheduleReconnect(generation, "Mất kết nối — sẽ thử lại sau 30 giây"));
  current.on(ControlEvent.ERROR, ({ info, exception } = {}) => { if (guard.isCurrent(generation)) console.error("TikTok error:", info || exception?.message || "Unknown error"); });
  try {
    const result = await current.connect();
    if (!guard.isCurrent(generation) || activeSessionId() !== sessionId) return { ok: false, stale: true };
    sessions.markLive(result.roomId);
    const analytics = activeViewer();
    analytics.startSession(result.roomId);
    activeSession().viewerAnalytics = analytics.state;
    await storage.save();
    setStatus({ state: "live", message: "Đang thu comment trực tiếp", roomId: result.roomId }, generation);
    io.emit("viewer:updated", analytics.payload());
    return { ok: true, roomId: result.roomId };
  } catch (error) {
    if (!guard.isCurrent(generation)) return { ok: false, stale: true };
    const message = String(error?.message || error);
    const display = message.includes("not live") ? `@${username} hiện chưa livestream. Hệ thống sẽ tự thử lại sau 30 giây.` : `Không kết nối được: ${message}`;
    scheduleReconnect(generation, display);
    return { ok: false, error: display };
  }
}

function activeState() {
  const session = activeSession();
  return {
    target: targetPayload(), settings: { recentTargets: store.settings.recentTargets }, activeSession: session,
    status, comments: activeComments(), questions: questions.getQuestions({ sessionId: session?.id }),
    users: questions.getUsers(session?.id), analytics: buildAnalytics(activeThreads(), session?.viewerAnalytics)
  };
}

function validId(value) { return typeof value === "string" && value.length > 0 && value.length <= 200 && /^[\w:.-]+$/u.test(value); }
function requireAnswered(req, res) {
  if (typeof req.body?.answered !== "boolean") { res.status(400).json({ error: "answered phải là boolean" }); return null; }
  return req.body.answered;
}

app.get("/api/state", (_req, res) => res.json(activeState()));
app.get("/api/analytics", (_req, res) => res.json(buildAnalytics(activeThreads(), activeSession()?.viewerAnalytics)));
app.get("/api/questions", (req, res) => {
  const answered = req.query.answered === "true" ? true : req.query.answered === "false" ? false : undefined;
  if (req.query.answered !== undefined && answered === undefined) return res.status(400).json({ error: "answered phải là true hoặc false" });
  res.json(questions.getQuestions({ answered, sort: String(req.query.sort || "latest"), search: String(req.query.search || ""), sessionId: activeSessionId() }));
});
app.get("/api/users", (_req, res) => res.json(questions.getUsers(activeSessionId())));
app.get("/api/users/:userId/questions", (req, res) => validId(req.params.userId) ? res.json(questions.getUserQuestions(req.params.userId, activeSessionId())) : res.status(400).json({ error: "User ID không hợp lệ" }));

app.patch("/api/questions/:id/answered", async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "Question ID không hợp lệ" });
  const answered = requireAnswered(req, res); if (answered === null) return;
  const existing = activeThreads().find(thread => thread.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Không tìm thấy câu hỏi trong phiên hiện tại" });
  const thread = questions.setThreadAnswered(req.params.id, answered);
  try { await storage.save(); } catch { return res.status(500).json({ error: "Không lưu được trạng thái" }); }
  const payload = questions.enrichThread(thread); io.emit("question:updated", payload); emitUser(thread.userId); res.json(payload);
});
app.patch("/api/users/:userId/answered", async (req, res) => {
  if (!validId(req.params.userId)) return res.status(400).json({ error: "User ID không hợp lệ" });
  const answered = requireAnswered(req, res); if (answered === null) return;
  const threads = questions.setUserAnswered(req.params.userId, answered, new Date(), activeSessionId());
  if (!threads.length) return res.status(404).json({ error: "Không tìm thấy câu hỏi của user" });
  try { await storage.save(); } catch { return res.status(500).json({ error: "Không lưu được trạng thái" }); }
  for (const thread of threads) io.emit("question:updated", questions.enrichThread(thread)); emitUser(req.params.userId);
  res.json({ userId: req.params.userId, updated: threads.length, answered });
});

app.post("/api/target", async (req, res) => {
  const normalized = normalizeTargetInput(req.body?.username);
  if (!normalized) return res.status(400).json({ ok: false, error: { code: "INVALID_USERNAME", message: "TikTok ID không hợp lệ." } });
  if (normalized === targetUsername) return res.json({ ok: true, unchanged: true, target: targetPayload(), status });
  const previousUsername = targetUsername;
  const timestamp = new Date().toISOString();
  io.emit("target:changing", { username: normalized, previousUsername, timestamp });
  setStatus({ state: "switching", message: "Đang chuyển tài khoản...", roomId: null });
  await stopConnection();
  const switched = sessions.switchTarget(normalized);
  targetUsername = normalized;
  status = { ...status, state: "connecting", username: normalized, message: `Đang kết nối @${normalized}...`, roomId: null, lastCommentAt: null };
  await storage.save();
  const payload = { username: normalized, previousUsername, sessionId: switched.session.id, timestamp };
  io.emit("target:changed", payload);
  io.emit("status", status);
  const result = await connectTikTok();
  if (!result.ok) {
    io.emit("target:error", { ...payload, message: result.error || "Không kết nối được" });
    return res.status(502).json({ ok: false, error: { code: "CONNECTION_FAILED", message: result.error || "Không kết nối được" }, target: targetPayload(), status });
  }
  res.json({ ok: true, target: targetPayload(), status, activeSession: activeSession() });
});

app.post("/api/connect", async (_req, res) => {
  const result = await connectTikTok();
  res.status(result.ok ? 200 : 503).json(result.ok ? { ok: true } : { ok: false, error: result.error });
});
app.post("/api/disconnect", async (_req, res) => { await stopConnection(); setStatus({ state: "idle", message: "Đã dừng thu comment", roomId: null }); res.json({ ok: true }); });

app.get("/api/export.csv", (req, res) => {
  const sessionId = String(req.query.sessionId || activeSessionId() || "");
  const session = store.sessions.find(item => item.id === sessionId);
  if (!session) return res.status(404).json({ error: "Không tìm thấy phiên" });
  const scopedComments = store.comments.filter(comment => comment.sessionId === sessionId);
  const scopedThreads = store.questionThreads.filter(thread => thread.sessionId === sessionId);
  const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = [["sessionId","targetUsername","roomId","timestamp","userId","username","nickname","comment","question","questionThreadId","answered"], ...scopedComments.map(comment => {
    const thread = scopedThreads.find(item => item.commentIds.includes(comment.id));
    return [sessionId, session.targetUsername, session.roomId, comment.timestamp, comment.userId, comment.username, comment.nickname, comment.text, comment.question, thread?.id || "", thread?.answered || false];
  })];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${session.targetUsername}-comments.csv"`);
  res.send("\uFEFF" + rows.map(row => row.map(quote).join(",")).join("\n"));
});

io.on("connection", socket => { socket.emit("status", status); socket.emit("viewer:updated", viewerPayload()); });
httpServer.listen(PORT, () => { console.log(`LIVE Comment Hub: http://localhost:${PORT}`); console.log(`Đang theo dõi: @${targetUsername}`); if (!DISABLE_TIKTOK) void connectTikTok(); });

async function shutdown() {
  clearTimeout(analyticsSaveTimer); await stopConnection();
  try { await storage.save(); } catch {}
  httpServer.close(() => process.exit(0));
}
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
