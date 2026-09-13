import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import httpProxy from "http-proxy";
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from "tiktok-live-connector";
import { buildAnalytics, ViewerAnalytics } from "./src/analytics.js";
import { ConnectionGuard, retireConnection } from "./src/connection-guard.js";
import { QuestionService } from "./src/question-service.js";
import { SessionService } from "./src/session-service.js";
import { JsonStorage } from "./src/storage.js";
import { NeonStorage } from "./src/neon-storage.js";
import { normalizeTargetInput, resolveTarget } from "./src/target.js";
import { normalizeQuestionEvent, normalizeTikTokEvent } from "./src/tiktok-normalizer.js";
import { normalizeTikTokGift } from "./src/tiktok-gift-normalizer.js";
import { GiftService, validateGiftSettingsPatch } from "./src/gift-service.js";
import { config as watchdogConfig, evaluate as evaluateWatchdog, shouldReconnect as watchdogShouldReconnect } from "./src/collector-watchdog.js";
import { StreamEndConfirmation } from "./src/collector-lifecycle.js";
import { buildWelcomeMemberPayload } from "./src/member-welcome.js";
import { connectWithRoomFallback, describeConnectionError, errorSourceMessages, isOfflineError, reconnectBackoffMs, ReconnectController } from "./src/reconnect-policy.js";
import { AuthService, LoginRateLimiter, MemorySessionRepository, NeonSessionRepository } from "./src/auth-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const ALLOW_REMOTE_ACCESS = process.env.ALLOW_REMOTE_ACCESS === "true";
const AUTH_USERNAME = process.env.AUTH_USERNAME || "";
const AUTH_PASSWORD_HASH = process.env.AUTH_PASSWORD_HASH || "";
const REMOTE_BACKEND_MODE = process.env.REMOTE_BACKEND_MODE === "1";
const REMOTE_BACKEND_URL = process.env.REMOTE_BACKEND_URL || process.env.API_BASE_URL || "https://tiktoklivetracking-api.onrender.com";
const API_BASE_URL = REMOTE_BACKEND_MODE ? "/remote" : process.env.API_BASE_URL || "";
const SOCKET_URL = REMOTE_BACKEND_MODE ? "" : process.env.SOCKET_URL || API_BASE_URL;
const FRONTEND_ORIGINS = new Set([
  "https://tiktoklivetracking.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...String(process.env.FRONTEND_ORIGIN || "").split(",").map(value => value.trim()).filter(Boolean),
]);
const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
if ((!loopbackHosts.has(HOST) || ALLOW_REMOTE_ACCESS) && !(AUTH_USERNAME && AUTH_PASSWORD_HASH)) throw new Error("REMOTE_ACCESS_REQUIRES_AUTH");
const DISABLE_TIKTOK = process.env.DISABLE_TIKTOK === "1" || REMOTE_BACKEND_MODE;
const positiveEnv=(key,fallback,min)=>{const n=Number(process.env[key]);return Number.isFinite(n)&&n>=min?n:fallback};
const RECONNECT_COOLDOWN_MS = positiveEnv("RECONNECT_COOLDOWN_MS", 10_000, 1_000);
const RECONNECT_BACKOFF_BASE_MS = positiveEnv("RECONNECT_BACKOFF_BASE_MS", 5_000, 250);
const MAX_RECONNECT_ATTEMPTS = positiveEnv("MAX_RECONNECT_ATTEMPTS", 6, 1);
const ENABLE_CHAT_WATCHDOG=process.env.ENABLE_CHAT_WATCHDOG==="true";
const WATCHDOG_INTERVAL_MS=positiveEnv("WATCHDOG_INTERVAL_MS",15000,1000),CHAT_IDLE_MS=positiveEnv("CHAT_IDLE_MS",90000,10000),CHAT_STALL_SUSPECT_MS=positiveEnv("CHAT_STALL_SUSPECT_MS",180000,30000),CHAT_STALL_RECONNECT_MS=positiveEnv("CHAT_STALL_RECONNECT_MS",300000,60000);
const QUESTION_DEBUG = process.env.QUESTION_DEBUG === "true";
const ENABLE_WELCOME_NOTIFICATIONS = process.env.NODE_ENV === "production" ? process.env.ENABLE_WELCOME_NOTIFICATIONS === "true" : process.env.ENABLE_WELCOME_NOTIFICATIONS !== "false";
const WELCOME_DEBUG = process.env.WELCOME_DEBUG === "true";
const MAX_PENDING_CHAT_EVENTS = positiveEnv("MAX_PENDING_CHAT_EVENTS", 10_000, 100);
const WATCHDOG = watchdogConfig({ ...process.env, ENABLE_CHAT_WATCHDOG: String(ENABLE_CHAT_WATCHDOG), RECONNECT_COOLDOWN_MS: String(RECONNECT_COOLDOWN_MS), MAX_RECONNECT_ATTEMPTS: String(MAX_RECONNECT_ATTEMPTS) });
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "data");
const storage = process.env.DATABASE_URL
  ? new NeonStorage({ databaseUrl: process.env.DATABASE_URL })
  : new JsonStorage({ storeFile: join(DATA_DIR, "store.json"), legacyFile: join(DATA_DIR, "comments.json") });
const store = await storage.load();
const auth = new AuthService({
  username: AUTH_USERNAME,
  passwordHash: AUTH_PASSWORD_HASH,
  repository: storage.sql ? new NeonSessionRepository(storage.sql) : new MemorySessionRepository(),
});
await auth.initialize();
const loginLimiter = new LoginRateLimiter();
const questions = new QuestionService(store); const sessions = new SessionService(store);
const gifts = new GiftService(store);
let targetUsername = resolveTarget(process.env.TIKTOK_USERNAME, store.settings?.targetUsername);
if (sessions.active?.targetUsername !== targetUsername) sessions.switchTarget(targetUsername); else sessions.ensurePending(targetUsername);
store.settings.targetUsername = targetUsername;

const app = express(); const httpServer = createServer(app); const io = new Server(httpServer, {
  path: REMOTE_BACKEND_MODE ? "/local-socket.io" : "/socket.io",
  cors: { origin: [...FRONTEND_ORIGINS] },
});
app.disable("x-powered-by"); app.use((_req,res,next)=>{res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","no-referrer");res.setHeader("X-Frame-Options","DENY");next();});
app.use((req, res, next) => {
  if (FRONTEND_ORIGINS.has(req.headers.origin)) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
  }
  next();
});
app.use(express.json({ limit: "32kb" }));
const bearerToken = value => /^Bearer\s+(.+)$/i.exec(String(value || ""))?.[1] || "";
const requiresAuth = auth.enabled;
const authenticateRequest = async req => {
  const token = bearerToken(req.headers.authorization);
  return auth.authenticate(token, req.headers["user-agent"]);
};
app.post("/api/auth/login", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!auth.enabled) return res.status(503).json({ error: { code: "AUTH_NOT_CONFIGURED", message: "Đăng nhập chưa được cấu hình" } });
  const username = String(req.body?.username || "").slice(0, 100);
  const password = String(req.body?.password || "").slice(0, 256);
  const limit = loginLimiter.check(req.ip, username);
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))));
    return res.status(429).json({ error: { code: "LOGIN_RATE_LIMITED", message: "Đăng nhập tạm khóa. Vui lòng thử lại sau." } });
  }
  const session = await auth.login({ username, password, userAgent: req.headers["user-agent"] });
  if (!session) {
    loginLimiter.fail(req.ip, username);
    return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Tên đăng nhập hoặc mật khẩu không đúng" } });
  }
  loginLimiter.clear(req.ip, username);
  res.json(session);
});
app.get("/api/auth/session", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const session = await authenticateRequest(req);
  if (!session) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Vui lòng đăng nhập" } });
  res.json({ username: session.username, expiresAt: session.expiresAt || null });
});
app.post("/api/auth/logout", async (req, res) => {
  const token = bearerToken(req.headers.authorization);
  if (auth.enabled) await auth.logout(token);
  res.status(204).end();
});
app.use(async (req,res,next)=>{if(!req.path.startsWith("/api/")||['/api/health','/api/ready'].includes(req.path)||req.path.startsWith('/api/auth/'))return next();if(!requiresAuth)return next();const session=await authenticateRequest(req);if(!session)return res.status(401).json({error:{code:"UNAUTHORIZED",message:"Vui lòng đăng nhập"}});req.auth=session;next();});
io.use(async (socket,next)=>{if(!requiresAuth)return next();const token=String(socket.handshake.auth?.token||"");const session=await auth.authenticate(token,socket.handshake.headers["user-agent"]);if(session){socket.data.auth=session;return next()}next(new Error("UNAUTHORIZED"));});
app.get("/runtime-config.js", (_req, res) => {
  const config = REMOTE_BACKEND_MODE
    ? { apiBaseUrl: API_BASE_URL, socketUrl: SOCKET_URL, socketPath: "/remote/socket.io", devRemote: true }
    : { apiBaseUrl: API_BASE_URL, socketUrl: SOCKET_URL };
  res.type("application/javascript").send(`globalThis.__APP_CONFIG__ = ${JSON.stringify(config)};\n`);
});
if (REMOTE_BACKEND_MODE) {
  const remote = new URL(REMOTE_BACKEND_URL);
  if (remote.protocol !== "https:") throw new Error("REMOTE_BACKEND_URL_MUST_USE_HTTPS");
  const proxy = httpProxy.createProxyServer({ target: remote.origin, changeOrigin: true, secure: true, ws: true });
  proxy.on("error", (error, _req, resOrSocket) => {
    console.error("Development proxy error:", error.message);
    if (typeof resOrSocket?.writeHead === "function") resOrSocket.writeHead(502, { "Content-Type": "application/json" });
    if (typeof resOrSocket?.end === "function") resOrSocket.end(JSON.stringify({ error: { code: "REMOTE_BACKEND_UNAVAILABLE", message: "Backend Render tạm thời không phản hồi" } }));
    else resOrSocket?.destroy?.();
  });
  app.use("/remote", (req, res) => proxy.web(req, res));
  httpServer.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/remote/socket.io")) return;
    req.url = req.url.slice("/remote".length);
    proxy.ws(req, socket, head);
  });
}
app.use(express.static(join(__dirname, "public")));
const guard = new ConnectionGuard(); let connection = null; let connectionContext = null; let analyticsSaveTimer = null;
const reconnectController = new ReconnectController({ cooldownMs: RECONNECT_COOLDOWN_MS }); let reconnectFailureStreak = 0;
let reconnectRequestVersion = 0;
let watchdogTimer=null, connectionState="OFFLINE", pipelineFailureStreak=0;
const streamEndConfirmation = new StreamEndConfirmation(2);
const CHAT_FAILURE_DEGRADED_THRESHOLD=3;
function recordChatFailure(context, stage, reason){pipelineFailureStreak++;telemetry.chatErrorCount++;chatTelemetry(stage,context,null,reason);if(pipelineFailureStreak>=CHAT_FAILURE_DEGRADED_THRESHOLD)setConnectionState("DEGRADED",context?.generation)}
const CHAT_BATCH_DELAY_MS = 100;
let chatBatchTimer = null; let chatBatchInFlight = false; let acceptingChatEvents = false; const pendingChatEvents = [];
let status = { state: "idle", username: targetUsername, message: "Chưa kết nối", roomId: sessions.active?.roomId || null, lastCommentAt: null, nextReconnectAt: null };
const telemetry = { reconnectAttempts:0,reconnectFailureStreak:0,lastConnectAttempt:null,lastSuccessfulConnect:null,lastRoomIdErrorSources:[],lastRoomIdFallbackAt:null,lastEventAt:null,lastAnyEventAt:null,lastChatCallbackAt:null,lastChatNormalizedAt:null,lastChatPersistedAt:null,lastChatEmittedAt:null,lastViewerEventAt:null,lastMemberEventAt:null,lastGiftEventAt:null,lastLikeEventAt:null,lastLikeUpdateAt:null,lastLikePayloadShape:null,chatReceivedCount:0,chatNormalizedCount:0,chatPersistedCount:0,chatEmittedCount:0,chatDroppedCount:0,chatDuplicateCount:0,chatErrorCount:0,chatBackpressureDroppedCount:0,likeReceivedCount:0,likeTotalUpdatedCount:0,likeMissingTotalCount:0,memberReceivedCount:0,memberEmittedCount:0,memberDuplicateCount:0,memberDroppedCount:0,lastMemberWelcomeAt:null,lastMemberDropReason:null,recentMemberOutcomes:[],recentChatOutcomes:[],recentChatLatencies:[],oldGenerationEventsDropped:0,wrongSessionEventsDropped:0,initialEventsDropped:0,lastDisconnectReason:null };
function chatTelemetry(stage, context, comment, reasonCode = null, timing = {}) { const timestamp = new Date().toISOString(); const eventId = String(comment?.eventId || comment?.id || comment?.msgId || comment?.common?.msgId || `chat:${timestamp}`); telemetry.recentChatOutcomes.push({stage,eventType:"comment",correlationId:eventId,eventId,commentId:comment?.id||null,liveSessionId:context?.sessionId||comment?.sessionId||null,roomId:context?.roomId||comment?.roomId||null,connectionGeneration:context?.generation||comment?.connectionGeneration||null,userId:comment?.userId||comment?.user?.id||null,sourceTimestamp:comment?.eventTimestamp||comment?.createTime||comment?.common?.createTime||null,receivedAt:comment?.receivedAt||timing.receivedAt||null,persistedAt:timing.persistedAt||null,publishedAt:timing.publishedAt||null,taskId:timing.taskId||null,timestamp,reasonCode}); if(telemetry.recentChatOutcomes.length>30)telemetry.recentChatOutcomes.shift(); return timestamp; }
function memberTelemetry(outcome, context, payload, reasonCode = null) { const timestamp = new Date().toISOString(); telemetry.recentMemberOutcomes.push({ outcome, sessionId: context?.sessionId || payload?.sessionId || null, roomId: context?.roomId || payload?.roomId || null, connectionGeneration: context?.generation || payload?.connectionGeneration || null, userId: payload?.userId || null, timestamp, reasonCode }); if (telemetry.recentMemberOutcomes.length > 30) telemetry.recentMemberOutcomes.shift(); if (outcome === "dropped" || outcome === "error") telemetry.lastMemberDropReason = reasonCode; return timestamp; }
const activeSession = () => sessions.active; const activeSessionId = () => activeSession()?.id;
const targetPayload = () => ({ username: targetUsername, displayUsername: `@${targetUsername}` });
const meta = session => ({ sessionId: session?.id || null, targetUsername: session?.targetUsername || targetUsername, roomId: session?.roomId || null, revision: Math.max(0, Number(store.stateRevision) || 0), timestamp: new Date().toISOString() });
const scopedComments = id => store.comments.filter(comment => comment.sessionId === id);
const scopedThreads = id => store.questionThreads.filter(thread => thread.sessionId === id && thread.deleted !== true);
const viewerFor = session => new ViewerAnalytics(session?.viewerAnalytics);

function setConnectionState(next, generation) { if(generation!==undefined&&!guard.isCurrent(generation))return; if(connectionState===next)return; connectionState=next; setStatus({connectionState:next,live:["LIVE_HEALTHY","LIVE_IDLE","CHAT_SUSPECTED_STALLED","RECONNECTING","DEGRADED"].includes(next)},generation); }
function setStatus(next, generation) { if (generation !== undefined && !guard.isCurrent(generation)) return; status = { ...status, ...next, username: targetUsername }; io.emit("status", { ...status, ...meta(activeSession()) }); }
function scheduleSave() { if (analyticsSaveTimer) return; analyticsSaveTimer = setTimeout(async () => { analyticsSaveTimer = null; try { await storage.save(); } catch (error) { console.error("Không lưu được analytics:", error.message); } }, 3000); }
function eventIsCurrent(context) { const session = activeSession(); if(!context||connection!==context.connection||!guard.isCurrent(context.generation)){telemetry.oldGenerationEventsDropped++;return false} const valid=Boolean(context.sessionId&&session?.id===context.sessionId&&session.roomId===context.roomId&&session.status==="live"&&session.connectionGeneration===context.generation);if(!valid)telemetry.wrongSessionEventsDropped++;return valid; }
function isHistorical(normalized, session) { if (!normalized.eventTimestamp || !session.collectorConnectedAt) return false; return new Date(normalized.eventTimestamp).getTime() < new Date(session.collectorConnectedAt).getTime() - 5000; }
function emitUser(userId, sessionId) { const session = sessions.get(sessionId); const user = questions.getUsers(sessionId).find(item => item.userId === userId); if (user) io.emit("user:updated", { ...user, ...meta(session) }); }

async function onChat(data, context, forcedQuestion = false) {
  telemetry.chatReceivedCount++; telemetry.lastChatCallbackAt=chatTelemetry("CHAT_CALLBACK_RECEIVED",context,data);
  if (!eventIsCurrent(context)) { telemetry.chatDroppedCount++; chatTelemetry("CHAT_DROPPED",context,data,"STALE_CONNECTION_GENERATION"); return; }
  if (!acceptingChatEvents) { telemetry.chatDroppedCount++; chatTelemetry("CHAT_DROPPED",context,data,"COLLECTOR_QUIESCING"); return; }
  const receivedAt = new Date(); let normalized; try { normalized=normalizeTikTokEvent(data, receivedAt, { forcedQuestion }); } catch { recordChatFailure(context,"CHAT_ERROR","NORMALIZE_FAILED"); return; } if (!normalized) { telemetry.chatDroppedCount++; chatTelemetry("CHAT_DROPPED",context,data,"EMPTY_TEXT"); return; }
  telemetry.chatNormalizedCount++; telemetry.lastChatNormalizedAt=chatTelemetry("CHAT_NORMALIZED",context,normalized);
  const session = activeSession(); if (isHistorical(normalized, session)) { telemetry.initialEventsDropped++;telemetry.chatDroppedCount++;chatTelemetry("CHAT_DROPPED",context,normalized,"HISTORICAL_EVENT"); return; } telemetry.lastEventAt=receivedAt.toISOString(); telemetry.lastAnyEventAt=telemetry.lastEventAt;
  const comment = { ...normalized, sessionId: session.id, targetUsername: session.targetUsername, roomId: session.roomId, connectionGeneration: context.generation };
  if (pendingChatEvents.length >= MAX_PENDING_CHAT_EVENTS) { telemetry.chatDroppedCount++; telemetry.chatBackpressureDroppedCount++; chatTelemetry("CHAT_DROPPED",context,comment,"BACKPRESSURE_PENDING_LIMIT"); return; }
  pendingChatEvents.push({ comment, context, receivedAt });
  scheduleChatBatch();
}

function scheduleChatBatch(delay = CHAT_BATCH_DELAY_MS) {
  if (chatBatchTimer || chatBatchInFlight) return;
  chatBatchTimer = setTimeout(() => { chatBatchTimer = null; void flushChatBatch(); }, delay);
}

async function flushChatBatch() {
  if (chatBatchInFlight || !pendingChatEvents.length) return;
  chatBatchInFlight = true;
  const batch = pendingChatEvents.splice(0);
  let retry = false;
  try {
    const committed = await storage.mutate(draft => {
      const outcomes = [];
      const touchedSessions = new Set();
      for (const entry of batch) {
        const { comment, context } = entry;
        const current = draft.sessions.find(session => session.id === comment.sessionId && session.roomId === context.roomId && session.connectionGeneration === context.generation && session.status === "live");
        if (!current) { outcomes.push({ ...entry, stale: true }); continue; }
        const result = new QuestionService(draft).addComment(comment);
        if (!result.duplicateMessage && result.thread) new GiftService(draft).link(comment.sessionId, comment.userId, result.thread.id);
        touchedSessions.add(comment.sessionId);
        outcomes.push({ ...entry, result });
      }
      const service = new SessionService(draft);
      for (const sessionId of touchedSessions) service.refreshSummary(sessionId);
      return outcomes;
    });
    for (const entry of committed) {
      const { comment, context, receivedAt, stale, result } = entry;
      if (stale || !eventIsCurrent(context)) { telemetry.chatDroppedCount++; chatTelemetry("CHAT_DROPPED",context,comment,"STALE_CONNECTION_GENERATION"); continue; }
      if (result?.duplicateMessage) { telemetry.chatDuplicateCount++; chatTelemetry("CHAT_DROPPED",context,comment,"DUPLICATE_TRANSPORT_EVENT"); continue; }
      const thread = result.thread?.id ? store.questionThreads.find(item => item.id === result.thread.id) : null;
      const canonicalComment = store.comments.find(item => item.sessionId === comment.sessionId && item.id === comment.id) || comment;
      const persistedAt = new Date().toISOString(); telemetry.chatPersistedCount++; telemetry.lastChatPersistedAt=chatTelemetry("CHAT_PERSISTED",context,canonicalComment,null,{persistedAt,taskId:thread?.activeQuestionId||null});
      const publishedAt = new Date().toISOString(); const commentPayload={...canonicalComment,revision:Math.max(0,Number(store.stateRevision)||0),persistedAt,publishedAt}; io.emit("comment",commentPayload); telemetry.chatEmittedCount++; telemetry.lastChatEmittedAt=chatTelemetry("CHAT_SOCKET_EMITTED",context,canonicalComment,null,{persistedAt,publishedAt,taskId:thread?.activeQuestionId||null}); telemetry.recentChatLatencies.push({eventId:canonicalComment.eventId||canonicalComment.id,liveSessionId:canonicalComment.sessionId,receivedToPersistedMs:Math.max(0,new Date(persistedAt)-new Date(canonicalComment.receivedAt)),persistedToPublishedMs:Math.max(0,new Date(publishedAt)-new Date(persistedAt))});if(telemetry.recentChatLatencies.length>100)telemetry.recentChatLatencies.shift(); pipelineFailureStreak=0; setConnectionState("LIVE_HEALTHY",context.generation);
      if (thread) { const payload = questions.enrichThread(thread); if (!QUESTION_DEBUG) delete payload.duplicateDebug; io.emit(result.threadCreated ? "question:created" : "question:updated", { ...payload, revision:Math.max(0,Number(store.stateRevision)||0), roomId: comment.roomId, timestamp: receivedAt.toISOString() }); }
      if (comment.question) emitUser(comment.userId, comment.sessionId);
      setStatus({ lastCommentAt: comment.receivedAt }, context.generation);
    }
  } catch (error) { for(const entry of batch)recordChatFailure(entry.context,"CHAT_ERROR","PERSIST_FAILED"); pendingChatEvents.unshift(...batch); retry = true; console.error("Không lưu được comment metadata:", error.message); }
  finally { chatBatchInFlight = false; if (pendingChatEvents.length) scheduleChatBatch(retry ? 1000 : CHAT_BATCH_DELAY_MS); }
}

async function drainChatBatches() {
  clearTimeout(chatBatchTimer); chatBatchTimer = null;
  const deadline = Date.now() + 10_000;
  while ((chatBatchInFlight || pendingChatEvents.length) && Date.now() < deadline) {
    if (!chatBatchInFlight) await flushChatBatch();
    else await new Promise(resolve => setTimeout(resolve, 5));
  }
  if (pendingChatEvents.length) console.error(`Dừng service khi còn ${pendingChatEvents.length} comment chưa lưu`);
}
function recordTransportActivity(kind) { const at = new Date().toISOString(); telemetry.lastAnyEventAt = at; if (kind === "gift") telemetry.lastGiftEventAt = at; if (kind === "viewer") telemetry.lastViewerEventAt = at; if (kind === "member") telemetry.lastMemberEventAt = at; if (kind === "like") telemetry.lastLikeEventAt = at; }
async function onGift(data,context){if(!eventIsCurrent(context))return;recordTransportActivity("gift");const normalized=normalizeTikTokGift(data,new Date());if(!normalized)return;const session=activeSession(),gift={...normalized,sessionId:session.id,roomId:session.roomId,connectionGeneration:context.generation};if(gift.giftType===1&&!gift.repeatEnd){io.emit("gift:received",{...meta(session),userId:gift.userId,eventId:gift.id,questionId:null,committedAt:null,transient:true,repeatCount:gift.repeatCount});return}let result;try{result=await storage.mutate(draft=>new GiftService(draft).receive(gift))}catch{return}if(result.duplicate)return;const canonicalGift=store.gifts.find(g=>g.sessionId===session.id&&g.id===gift.id),attention=gifts.attention(session.id,gift.userId),thread=attention?.linkedQuestionId?store.questionThreads.find(q=>q.id===attention.linkedQuestionId):null,payload={...meta(session),userId:gift.userId,eventId:gift.id,questionId:thread?.id||null,committedAt:new Date().toISOString(),gift:canonicalGift,summary:gifts.summary(session.id,gift.userId),attention};io.emit("gift:received",payload);io.emit("gift:summary-updated",payload);if(attention){io.emit(thread?"gift:question-linked":"gift:attention-created",payload);io.emit("gift:attention-updated",payload)}if(thread)io.emit("question:updated",{...questions.enrichThread(thread),...meta(session),giftEventId:payload.eventId});}
function onRoomUser(data, context) { if (!eventIsCurrent(context)) return; recordTransportActivity("viewer"); const session = activeSession(); const analytics = viewerFor(session); const result = analytics.observeRoomUser(data); if (!result.updated) return; session.viewerAnalytics = analytics.state; io.emit("viewer:updated", { ...analytics.payload(), ...meta(session) }); if (result.sampled || result.changed) scheduleSave(); }
function describeLikePayload(data) { const numericFields = {}; for (const [key, value] of Object.entries(data || {})) if (typeof value === "number" || typeof value === "bigint") numericFields[key] = String(value); return { keys:Object.keys(data || {}).sort().slice(0, 40), numericFields }; }
function onLike(data, context) { if (!eventIsCurrent(context)) return; telemetry.likeReceivedCount++; telemetry.lastLikePayloadShape = describeLikePayload(data); recordTransportActivity("like"); const session = activeSession(); const analytics = viewerFor(session); const result = analytics.observeLike(data); if (!result.updated) { if (!result.stale) telemetry.likeMissingTotalCount++; return; } if (!result.changed) return; telemetry.likeTotalUpdatedCount++; telemetry.lastLikeUpdateAt = analytics.state.lastLikeUpdateAt; session.viewerAnalytics = analytics.state; const viewerPayload = { ...analytics.payload(), ...meta(session) }; io.emit("viewer:updated", viewerPayload); const eventCount = Number(data?.count); io.emit("like:received", { ...meta(session), eventId:String(data?.msgId || data?.common?.msgId || `like:${session.id}:${analytics.state.lastLikeUpdateAt}`), totalLikes:analytics.state.totalLikes, totalDelta:result.delta, eventCount:Number.isSafeInteger(eventCount) && eventCount > 0 ? eventCount : null, receivedAt:analytics.state.lastLikeUpdateAt }); scheduleSave(); }
function onMember(data, context) {
  telemetry.memberReceivedCount++;
  if (!data || typeof data !== "object") { telemetry.memberDroppedCount++; memberTelemetry("dropped", context, null, "INVALID_MEMBER_PAYLOAD"); return; }
  const session = activeSession();
  if (!session) { telemetry.memberDroppedCount++; memberTelemetry("dropped", context, null, "NO_ACTIVE_SESSION"); return; }
  if (!eventIsCurrent(context)) { telemetry.memberDroppedCount++; memberTelemetry("dropped", context, null, "STALE_CONNECTION_GENERATION"); return; }
  recordTransportActivity("member"); const analytics = viewerFor(session);
  const welcome = buildWelcomeMemberPayload({ data, session, welcomedUserIds: session.welcomedUserIds || [], threads: store.questionThreads, gifts: store.gifts });
  const result = analytics.observeMember(data);
  if (!result.updated) { if (result.duplicate) telemetry.memberDuplicateCount++; else telemetry.memberDroppedCount++; memberTelemetry(result.duplicate ? "duplicate" : "dropped", context, welcome.payload, result.duplicate ? "DUPLICATE_MEMBER_IN_SESSION" : "MISSING_MEMBER_IDENTITY"); return; }
  session.viewerAnalytics = analytics.state; io.emit("viewer:updated", { ...analytics.payload(), ...meta(session) }); scheduleSave();
  if (!ENABLE_WELCOME_NOTIFICATIONS) { telemetry.memberDroppedCount++; memberTelemetry("dropped", context, welcome.payload, "WELCOME_FEATURE_DISABLED"); return; }
  if (!welcome.payload) { if (welcome.reason === "DUPLICATE_MEMBER_IN_SESSION") telemetry.memberDuplicateCount++; else telemetry.memberDroppedCount++; memberTelemetry(welcome.reason === "DUPLICATE_MEMBER_IN_SESSION" ? "duplicate" : "dropped", context, null, welcome.reason || "INVALID_MEMBER_PAYLOAD"); return; }
  const payload = { ...welcome.payload, eventId: `member:${welcome.payload.sessionId}:${welcome.payload.userId}` };
  try { io.emit("member:joined", payload); session.welcomedUserIds ||= []; session.welcomedUserIds.push(payload.userId); session.welcomedUserIds = [...new Set(session.welcomedUserIds)].slice(-5_000); scheduleSave(); telemetry.memberEmittedCount++; telemetry.lastMemberWelcomeAt = payload.joinedAt; memberTelemetry("emitted", context, payload); if (WELCOME_DEBUG) console.debug("[welcome] emitting", { sessionId: payload.sessionId, userId: payload.userId, displayName: payload.displayName }); }
  catch { telemetry.memberDroppedCount++; memberTelemetry("error", context, payload, "SOCKET_EMIT_FAILED"); }
}
async function stopConnection() { acceptingChatEvents = false; await drainChatBatches(); if (pendingChatEvents.length) { const dropped = pendingChatEvents.splice(0); telemetry.chatDroppedCount += dropped.length; for (const entry of dropped) chatTelemetry("CHAT_DROPPED", entry.context, entry.comment, "CONNECTION_RETIRED_PENDING"); } const old = connection; connection = null; connectionContext = null; await retireConnection(guard, old); }
async function requestReconnect(reason = "manual_reconnect") {
  const admission = reconnectController.request(async () => {
    guard.clearReconnect();
    const requestVersion = ++reconnectRequestVersion;
    telemetry.reconnectAttempts++;
    telemetry.lastDisconnectReason = reason;
    setConnectionState("RECONNECTING");
    setStatus({ state: "reconnecting", message: "Đang kết nối lại collector...", roomId: activeSession()?.roomId || null, nextReconnectAt: null });
    if (requestVersion !== reconnectRequestVersion) return { ok: false, stale: true };
    return connectTikTok(reason);
  });

  if (admission.state === "cooldown") {
    const seconds = Math.max(1, Math.ceil(admission.retryAfterMs / 1000));
    const generation = guard.generation;
    const scheduled = scheduleReconnect(generation, `Đang chờ ${seconds} giây trước khi thử lại...`, reason, admission.retryAfterMs);
    return { ok: false, cooldown: true, scheduled, retryAfterMs: admission.retryAfterMs, error: `Vui lòng chờ ${seconds} giây trước khi thử lại` };
  }

  return admission.promise;
}
function scheduleReconnect(generation, message, reason="connection_lost", requestedDelay) {
  if (!guard.isCurrent(generation)) return false;
  sessions.markOffline();
  if (reconnectFailureStreak >= MAX_RECONNECT_ATTEMPTS) {
    guard.clearReconnect();
    setStatus({ state: "offline", message, roomId: null, nextReconnectAt: null }, generation);
    return false;
  }
  const backoff = reconnectBackoffMs(reconnectFailureStreak, { baseMs: RECONNECT_BACKOFF_BASE_MS });
  const delay = Math.max(requestedDelay ?? backoff, reconnectController.retryAfterMs);
  const nextReconnectAt = new Date(Date.now() + delay).toISOString();
  const scheduled = guard.scheduleOnce(generation, () => void requestReconnect(reason), delay);
  if (scheduled) setStatus({ state: "offline", message, roomId: null, nextReconnectAt }, generation);
  return scheduled;
}
function watchdogTick(){const now=Date.now(),lastAnyEventAt=new Date(telemetry.lastAnyEventAt||0).getTime(),lastChatAt=new Date(telemetry.lastChatCallbackAt||0).getTime(),snapshot={now,lastChatAt,lastAnyEventAt,connected:Boolean(connection),roomId:activeSession()?.roomId||null,reconnecting:reconnectController.inProgress,lastReconnectAt:reconnectController.lastStartedAt,consecutiveFailures:reconnectFailureStreak};const next=evaluateWatchdog(snapshot,WATCHDOG);setConnectionState(next);if(watchdogShouldReconnect(snapshot,WATCHDOG))void requestReconnect("CHAT_WATCHDOG_STALLED")}
watchdogTimer=setInterval(watchdogTick,WATCHDOG_INTERVAL_MS);watchdogTimer.unref?.();

async function connectTikTok(reason = "connect") {
  if (DISABLE_TIKTOK) return { ok: false, error: "TikTok connector đang tắt" };
  const previousSession = activeSession();
  const cachedRoomId = previousSession?.targetUsername === targetUsername && previousSession?.roomId ? previousSession.roomId : null;
  acceptingChatEvents = false; telemetry.lastConnectAttempt=new Date().toISOString(); telemetry.lastRoomIdErrorSources=[]; await stopConnection(); const generation = guard.next(); const username = targetUsername;
  sessions.ensurePending(username, generation); setStatus({ state: "connecting", message: `Đang kết nối @${username}...`, roomId: null, nextReconnectAt: null }, generation);
  const current = new TikTokLiveConnection(username, { enableExtendedGiftInfo: false, processInitialData: false });
  const context = { connection: current, generation, username, sessionId: null, roomId: null }; connection = current; connectionContext = context;
  current.on(WebcastEvent.CHAT, data => void onChat(data, context, false));
  current.on(WebcastEvent.QUESTION_NEW, data => void onChat(normalizeQuestionEvent(data), context, true));
  current.on(WebcastEvent.GIFT,data=>void onGift(data,context));
  current.on(WebcastEvent.ROOM_USER, data => onRoomUser(data, context)); current.on(WebcastEvent.LIKE, data => onLike(data, context)); current.on(WebcastEvent.MEMBER, data => onMember(data, context));
  current.on(WebcastEvent.STREAM_END, ({ action } = {}) => {
    if (!guard.isCurrent(generation)) return;
    const session = activeSession();
    streamEndConfirmation.mark({ sessionId: session?.id, roomId: session?.roomId, action });
    scheduleReconnect(generation, `TikTok báo @${username} có thể đã kết thúc LIVE — đang xác minh...`, "stream_end_signal", 2_000);
  });
  current.on(ControlEvent.DISCONNECTED, () => scheduleReconnect(generation, "Mất kết nối — hệ thống sẽ tự thử lại"));
  current.on(ControlEvent.ERROR, ({ info, exception } = {}) => {
    if (!guard.isCurrent(generation)) return;
    const message = String(info || exception?.message || "Unknown error");
    console.error("TikTok error:", message);
    scheduleReconnect(generation, `Collector gặp lỗi: ${message}`, "connector_error");
  });
  try {
    const result = await connectWithRoomFallback(current, cachedRoomId, error => {
      telemetry.lastRoomIdErrorSources = errorSourceMessages(error);
      telemetry.lastRoomIdFallbackAt = new Date().toISOString();
      console.warn(`TikTok Room ID resolver failed; retrying cached room ${cachedRoomId}`);
      if (telemetry.lastRoomIdErrorSources.length) console.warn("TikTok Room ID sources:", telemetry.lastRoomIdErrorSources);
    }); if (connection !== current || !guard.isCurrent(generation)) return { ok: false, stale: true };
    guard.clearReconnect();
    const attached = sessions.attachRoom(username, result.roomId, generation, new Date()); if (!attached) throw new Error("TikTok không trả room ID hợp lệ"); telemetry.lastSuccessfulConnect=new Date().toISOString(); reconnectFailureStreak=0; telemetry.reconnectFailureStreak=0; acceptingChatEvents=true;
    streamEndConfirmation.observeConnected({ sessionId: attached.session.id, roomId: attached.session.roomId });
    context.sessionId = attached.session.id; context.roomId = attached.session.roomId;
    const analytics = viewerFor(attached.session); analytics.startSession(result.roomId); attached.session.viewerAnalytics = analytics.state; await storage.save();
    setConnectionState("LIVE_IDLE",generation); setStatus({ state: "live", message: "Đang thu comment trực tiếp", roomId: result.roomId, nextReconnectAt: null }, generation);
    io.emit(attached.created ? "session:created" : "session:updated", { ...sessions.summary(attached.session.id), ...meta(attached.session) });
    io.emit("viewer:updated", { ...analytics.payload(), ...meta(attached.session) }); return { ok: true, roomId: result.roomId, sessionId: attached.session.id };
  } catch (error) {
    acceptingChatEvents=false;
    if (!guard.isCurrent(generation)) return { ok: false, stale: true };
    reconnectFailureStreak++; telemetry.reconnectFailureStreak=reconnectFailureStreak;
    const message = String(error?.message || error);
    const sourceMessages = errorSourceMessages(error);
    telemetry.lastRoomIdErrorSources = sourceMessages;
    if (sourceMessages.length) console.error("TikTok Room ID sources:", sourceMessages);
    let notLive = isOfflineError(error);
    if (!notLive && /unexpected server response:\s*200/i.test(message)) {
      try { notLive = (await current.fetchIsLive()) === false; } catch {}
    }
    const connectionHint = describeConnectionError(error);
    const display = notLive ? `@${username} hiện chưa livestream. Hệ thống sẽ tự kiểm tra lại.` : connectionHint || `Không kết nối được: ${message}`;
    const confirmation = notLive ? streamEndConfirmation.observeNotLive(activeSessionId()) : { confirmed: false };
    if (confirmation.confirmed) {
      const ended = sessions.closeActive("stream_end_confirmed");
      streamEndConfirmation.clear();
      await stopConnection();
      await storage.save();
      if (ended) io.emit("session:ended", { ...sessions.summary(ended.id), ...meta(ended) });
      setConnectionState("OFFLINE");
      setStatus({ state: "idle", message: `@${username} đã kết thúc LIVE.`, roomId: null, nextReconnectAt: null });
      return { ok: false, ended: true, error: display };
    }
    setConnectionState(reconnectFailureStreak>=MAX_RECONNECT_ATTEMPTS?"ERROR":"OFFLINE",generation);
    scheduleReconnect(generation, display, reason === "stream_end_signal" ? "stream_end_confirmation" : "connection_lost");
    return { ok: false, error: display };
  }
}

function validId(value) { return typeof value === "string" && value.length > 0 && value.length <= 200 && /^[\w:.-]+$/u.test(value); }
function validUserId(value) { return validId(value) && !["undefined","null"].includes(value); }
function resolveSession(req, res, { required = false } = {}) { const id = String(req.query.sessionId || req.body?.sessionId || activeSessionId() || ""); const session = sessions.get(id); if (!session && (required || id)) { res.status(404).json({ error: "Không tìm thấy phiên" }); return null; } return session; }
function stateFor(session) { const id = session?.id; const threads = id ? scopedThreads(id) : []; return { revision:Math.max(0,Number(store.stateRevision)||0), target: targetPayload(), settings: { recentTargets: store.settings.recentTargets, questionDebug: QUESTION_DEBUG },giftSettings:store.giftSettings, activeSession: activeSession(), selectedSession: session || null, sessions: sessions.list(), status, comments: id ? scopedComments(id) : [], questions: id ? questions.getQuestions({ sessionId: id }) : [], users: id ? questions.getUsers(id) : [],gifts:id?store.gifts.filter(g=>g.sessionId===id):[],giftAttention:id?store.giftAttention.filter(a=>a.sessionId===id):[], analytics: buildAnalytics(threads, session?.viewerAnalytics, id?store.gifts.filter(g=>g.sessionId===id):[],id?store.giftAttention.filter(a=>a.sessionId===id):[]) }; }
function requireAnswered(req, res) { if (typeof req.body?.answered !== "boolean") { res.status(400).json({ error: "answered phải là boolean" }); return null; } return req.body.answered; }

app.get("/api/health", (_req,res)=>res.json({status:"ok",process:{uptimeSeconds:Math.floor(process.uptime())}}));
app.get("/api/ready", (_req,res)=>{const ready=storage.readiness(),chatAt=new Date(telemetry.lastChatCallbackAt||0).getTime();const payload={status:ready.ready?"ok":ready.storageHealthy?"degraded":"unhealthy",storage:{healthy:ready.storageHealthy,lastSaveAt:ready.lastSaveAt,lastErrorAt:ready.lastSaveErrorAt,consecutiveFailures:ready.consecutiveSaveFailures,pendingTransactions:ready.pendingTransactions},collector:{state:status.state,connectionState,live:["LIVE_HEALTHY","LIVE_IDLE","CHAT_SUSPECTED_STALLED","RECONNECTING","DEGRADED"].includes(connectionState),watchdogEnabled:ENABLE_CHAT_WATCHDOG,welcomeNotificationsEnabled:ENABLE_WELCOME_NOTIFICATIONS,chatIdleForMs:chatAt?Date.now()-chatAt:null,reconnectInProgress:reconnectController.inProgress,activeConnectionCount:connection?1:0,chatReceivedCount:telemetry.chatReceivedCount,chatPersistedCount:telemetry.chatPersistedCount,chatDroppedCount:telemetry.chatDroppedCount,chatBackpressureDroppedCount:telemetry.chatBackpressureDroppedCount,memberReceivedCount:telemetry.memberReceivedCount,memberEmittedCount:telemetry.memberEmittedCount,memberDuplicateCount:telemetry.memberDuplicateCount,memberDroppedCount:telemetry.memberDroppedCount,lastMemberAt:telemetry.lastMemberEventAt,lastMemberDropReason:telemetry.lastMemberDropReason},process:{uptimeSeconds:Math.floor(process.uptime())}};res.status(ready.ready?200:503).json(payload);});
app.get("/api/collector/telemetry", (_req,res)=>res.json({ collector:{ targetUsername, sessionId:activeSessionId()||null, roomId:activeSession()?.roomId||null, connectionGeneration:guard.generation, connectionState, acceptingChatEvents, pendingChatEvents:pendingChatEvents.length, reconnectFailureStreak, telemetry } }));
app.post("/api/debug/welcome", (req, res) => {
  if (process.env.NODE_ENV === "production") return res.status(404).json({ error: "Not found" });
  if (!ENABLE_WELCOME_NOTIFICATIONS) return res.status(409).json({ error: "WELCOME_FEATURE_DISABLED" });
  const session = activeSession(); if (!session?.roomId) return res.status(409).json({ error: "NO_ACTIVE_SESSION" });
  const userId = String(req.body?.userId || "debug-welcome-user").trim().slice(0, 120); const nickname = String(req.body?.nickname || "Nguyễn Minh Anh").trim().slice(0, 100);
  if (!userId || !nickname) return res.status(400).json({ error: "INVALID_MEMBER_PAYLOAD" });
  const result = buildWelcomeMemberPayload({ data:{ user:{ id:userId, nickname } }, session, welcomedUserIds:[], threads:store.questionThreads, gifts:store.gifts });
  const payload = { ...result.payload, eventId:`debug-member:${session.id}:${userId}:${Date.now()}`, debug:true };
  try { io.emit("member:joined", payload); telemetry.memberEmittedCount++; telemetry.lastMemberWelcomeAt=payload.joinedAt; memberTelemetry("emitted", null, payload); if (WELCOME_DEBUG) console.debug("[welcome] emitting", { sessionId:payload.sessionId,userId:payload.userId,displayName:payload.displayName }); res.json({ ok:true, payload }); }
  catch { telemetry.memberDroppedCount++; memberTelemetry("error", null, payload, "SOCKET_EMIT_FAILED"); res.status(500).json({ error:"SOCKET_EMIT_FAILED" }); }
});

app.get("/api/state", (req, res) => { const session = resolveSession(req, res); if ((req.query.sessionId || activeSessionId()) && !session) return; res.json(stateFor(session)); });
app.get("/api/sessions", (_req, res) => res.json(sessions.list()));
app.get("/api/sessions/:id", (req, res) => { if (!validId(req.params.id)) return res.status(400).json({ error: "Session ID không hợp lệ" }); const session = sessions.get(req.params.id); return session ? res.json(stateFor(session)) : res.status(404).json({ error: "Không tìm thấy phiên" }); });
app.get("/api/analytics", (req, res) => { const session = resolveSession(req, res, { required: true }); if (session) res.json(stateFor(session).analytics); });
app.get("/api/questions", (req, res) => { const session = resolveSession(req, res, { required: true }); if (!session) return; const answered = req.query.answered === "true" ? true : req.query.answered === "false" ? false : undefined; if (req.query.answered !== undefined && answered === undefined) return res.status(400).json({ error: "answered phải là true hoặc false" }); res.json(questions.getQuestions({ answered, sort: String(req.query.sort || "queue"), search: String(req.query.search || ""), sessionId: session.id })); });
app.get("/api/users", (req, res) => { const session = resolveSession(req, res, { required: true }); if (session) res.json(questions.getUsers(session.id)); });
app.get("/api/users/:userId/questions", (req, res) => { if (!validId(req.params.userId)) return res.status(400).json({ error: "User ID không hợp lệ" }); const session = resolveSession(req, res, { required: true }); if (session) res.json(questions.getUserQuestions(req.params.userId, session.id)); });
app.get("/api/gifts",(req,res)=>{const s=resolveSession(req,res,{required:true});if(s)res.json(store.gifts.filter(g=>g.sessionId===s.id))});
app.get("/api/gifts/attention",(req,res)=>{const s=resolveSession(req,res,{required:true});if(s)res.json(store.giftAttention.filter(a=>a.sessionId===s.id&&!a.acknowledged))});
app.get("/api/users/:userId/gifts",(req,res)=>{if(!validUserId(req.params.userId))return res.status(400).json({error:"User ID không hợp lệ"});const s=resolveSession(req,res,{required:true});if(s)res.json({summary:gifts.summary(s.id,req.params.userId),events:store.gifts.filter(g=>g.sessionId===s.id&&g.userId===req.params.userId)})});
app.patch("/api/gifts/attention/:userId/acknowledge",async(req,res)=>{if(!validUserId(req.params.userId))return res.status(400).json({error:"User ID không hợp lệ"});if(req.body?.acknowledged!==undefined&&typeof req.body.acknowledged!=="boolean")return res.status(400).json({error:"acknowledged phải là boolean"});const s=resolveSession(req,res,{required:true});if(!s)return;let result;try{result=await storage.mutate(d=>new GiftService(d).acknowledge(s.id,req.params.userId,req.body?.acknowledged!==false))}catch{return res.status(500).json({error:{code:"SAVE_FAILED",message:"Không lưu được thay đổi"}})}if(!result)return res.status(404).json({error:"Không tìm thấy gift attention"});const payload={...gifts.attention(s.id,req.params.userId),...meta(s),eventId:`attention:${req.params.userId}:${Date.now()}`,questionId:result.linkedQuestionId||null,committedAt:new Date().toISOString()};io.emit("gift:attention-updated",payload);io.emit(result.acknowledged?"gift:acknowledged":"gift:attention-created",payload);res.json(payload)});
app.post("/api/gifts/:userId/assign-question",async(req,res)=>{if(!validUserId(req.params.userId)||!validId(req.body?.questionId))return res.status(400).json({error:"Gift user hoặc question không hợp lệ"});const s=resolveSession(req,res,{required:true});if(!s)return;const q=store.questionThreads.find(q=>q.id===req.body.questionId&&q.sessionId===s.id&&q.userId===req.params.userId&&!q.answered&&!q.archived&&!q.deleted);if(!q||!gifts.summary(s.id,req.params.userId).giftEventCount)return res.status(400).json({error:"Gift user hoặc question không hợp lệ"});try{await storage.mutate(d=>new GiftService(d).link(s.id,req.params.userId,q.id))}catch{return res.status(500).json({error:{code:"SAVE_FAILED",message:"Không lưu được thay đổi"}})}const thread=store.questionThreads.find(x=>x.id===q.id),payload={...questions.enrichThread(thread),...meta(s),userId:req.params.userId,questionId:q.id,eventId:`assign:${q.id}:${Date.now()}`,committedAt:new Date().toISOString()};io.emit("gift:priority-updated",payload);io.emit("gift:attention-updated",{...gifts.attention(s.id,req.params.userId),...meta(s),eventId:payload.eventId,questionId:q.id,committedAt:payload.committedAt});res.json(payload)});
app.get("/api/gift-settings",(_req,res)=>res.json(store.giftSettings));
app.patch("/api/gift-settings",async(req,res)=>{let patch;try{patch=validateGiftSettingsPatch(req.body)}catch(error){return res.status(400).json({error:{code:"INVALID_GIFT_SETTINGS",message:error.message}})}try{await storage.mutate(d=>Object.assign(d.giftSettings,patch))}catch{return res.status(500).json({error:{code:"SAVE_FAILED",message:"Không lưu được cài đặt"}})}const payload={settings:store.giftSettings,sessionId:null,userId:null,questionId:null,eventId:`settings:${Date.now()}`,committedAt:new Date().toISOString()};io.emit("gift:settings-updated",payload);res.json(store.giftSettings)});
app.patch("/api/questions/:id/answered", async (req, res) => { if (!validId(req.params.id)) return res.status(400).json({ error: "Question ID không hợp lệ" }); const session = resolveSession(req, res, { required: true }); if (!session) return; const answered = requireAnswered(req, res); if (answered === null) return; if(!scopedThreads(session.id).some(thread=>thread.id===req.params.id))return res.status(404).json({error:"Không tìm thấy câu hỏi trong phiên yêu cầu"});let id;try{id=await storage.mutate(d=>{const thread=new QuestionService(d).setThreadAnswered(req.params.id,answered);new SessionService(d).refreshSummary(session.id);return thread.id})}catch{return res.status(500).json({error:"Không lưu được trạng thái"})}const thread=store.questionThreads.find(q=>q.id===id),payload={...questions.enrichThread(thread),...meta(session)};io.emit("question:updated",payload);emitUser(thread.userId,session.id);res.json(payload); });
app.get("/api/questions/:id/items/:itemId", (req, res) => {
  if (!validId(req.params.id) || !validId(req.params.itemId)) return res.status(400).json({ error: "Question ID không hợp lệ" });
  const session = resolveSession(req, res, { required: true }); if (!session) return;
  const thread = store.questionThreads.find(item => item.id === req.params.id && item.sessionId === session.id && !item.deleted);
  const item = thread ? questions.normalizeQuestionItems(thread).find(candidate => candidate.id === req.params.itemId) : null;
  if (!thread || !item) return res.status(404).json({ error: "Không tìm thấy câu hỏi con" });
  res.json({ ...questions.enrichThread(thread), ...meta(session), taskId:item.id, status:item.status, version:item.version, updatedAt:item.updatedAt });
});
app.patch("/api/questions/:id/items/:itemId", async (req, res) => {
  if (!validId(req.params.id) || !validId(req.params.itemId)) return res.status(400).json({ error: "Question ID không hợp lệ" });
  const session = resolveSession(req, res, { required: true }); if (!session) return;
  const status = String(req.body?.status || "");
  if (!['ANSWERED', 'SKIPPED', 'WAITING'].includes(status)) return res.status(400).json({ error: "Trạng thái câu hỏi không hợp lệ" });
  const idempotencyKey = String(req.body?.idempotencyKey || req.headers["idempotency-key"] || `server:${randomUUID()}`).trim();
  if (idempotencyKey.length > 200 || !/^[\w:.-]+$/u.test(idempotencyKey)) return res.status(400).json({ error: "Idempotency key không hợp lệ" });
  if (!scopedThreads(session.id).some(thread => thread.id === req.params.id)) return res.status(404).json({ error: "Không tìm thấy câu hỏi trong phiên yêu cầu" });
  let committed;
  try { committed = await storage.mutate(d => { const result = new QuestionService(d).transitionQuestionItem(req.params.id, req.params.itemId, status, new Date(), { idempotencyKey }); if (!result.thread) return null; new SessionService(d).refreshSummary(session.id); return { threadId:result.thread.id, taskId:result.item.id, status:result.item.status, version:result.item.version, updatedAt:result.item.updatedAt, idempotent:result.idempotent, conflict:result.conflict }; }); }
  catch (error) { return res.status(error.message === "INVALID_QUESTION_STATUS" ? 400 : 500).json({ error: "Không lưu được trạng thái câu hỏi" }); }
  const thread = committed ? store.questionThreads.find(item => item.id === committed.threadId) : null;
  if (!thread) return res.status(404).json({ error: "Không tìm thấy câu hỏi con" });
  const payload = { ...questions.enrichThread(thread), ...meta(session), ...committed, eventType:"task.updated", idempotencyKey };
  io.emit("question:updated", payload); io.emit("task:updated", payload); io.emit("queue:updated", { ...meta(session), questionId: thread.id, taskId:committed.taskId }); emitUser(thread.userId, session.id);
  res.json(payload);
});
app.patch("/api/users/:userId/answered", async (req, res) => { if (!validUserId(req.params.userId)) return res.status(400).json({ error: "User ID không hợp lệ" }); const session = resolveSession(req, res, { required: true }); if (!session) return; const answered = requireAnswered(req, res); if (answered === null) return;if(!scopedThreads(session.id).some(q=>q.userId===req.params.userId))return res.status(404).json({error:"Không tìm thấy câu hỏi của user"});let ids;try{ids=await storage.mutate(d=>{const rows=new QuestionService(d).setUserAnswered(req.params.userId,answered,new Date(),session.id);new SessionService(d).refreshSummary(session.id);return rows.map(q=>q.id)})}catch{return res.status(500).json({error:"Không lưu được trạng thái"})}const threads=ids.map(id=>store.questionThreads.find(q=>q.id===id)).filter(Boolean);for(const thread of threads)io.emit("question:updated",{...questions.enrichThread(thread),...meta(session)});emitUser(req.params.userId,session.id);res.json({userId:req.params.userId,sessionId:session.id,updated:threads.length,answered}); });

app.post("/api/comments/:commentId/promote-question", async (req, res) => {
  if (!validId(req.params.commentId)) return res.status(400).json({ error: "Comment ID không hợp lệ" });
  const session = resolveSession(req, res, { required: true }); if (!session) return;
  let committed;try{committed=await storage.mutate(d=>{const qs=new QuestionService(d),result=qs.promoteComment(req.params.commentId,session.id,String(req.body?.reason||"").trim().slice(0,200)||null);if(!result)return null;new GiftService(d).link(session.id,result.thread.userId,result.thread.id);new SessionService(d).refreshSummary(session.id);return{threadId:result.thread.id,created:result.created,idempotent:result.idempotent}})}catch{return res.status(500).json({error:{code:"SAVE_FAILED",message:"Không lưu được câu hỏi"}})}
  if (!committed) return res.status(404).json({ error: "Không tìm thấy comment trong phiên yêu cầu" });const thread=store.questionThreads.find(q=>q.id===committed.threadId); const payload = { ...questions.enrichThread(thread), ...meta(session), idempotent: committed.idempotent };
  io.emit("question:promoted", payload); io.emit("queue:updated", { ...meta(session), questionId: thread.id }); emitUser(thread.userId, session.id);
  if(thread.giftPriority)io.emit("gift:question-linked",{...meta(session),userId:thread.userId,questionId:thread.id,eventId:`promote-link:${thread.id}`,committedAt:new Date().toISOString()});
  res.status(committed.created ? 201 : 200).json(payload);
});
app.post("/api/questions/manual", async (req, res) => {
  const session = resolveSession(req, res, { required: true }); if (!session) return;
  const text = String(req.body?.text || "").trim(); if (!text || text.length > 500) return res.status(400).json({ error: "Nội dung câu hỏi phải từ 1 đến 500 ký tự" });
  const userId = req.body?.userId ? String(req.body.userId) : null; if (userId && !validId(userId)) return res.status(400).json({ error: "User ID không hợp lệ" });
  const canonical = userId ? scopedComments(session.id).filter(item=>item.userId===userId).at(-1) : null; if(userId&&!canonical)return res.status(400).json({error:{code:"USER_NOT_IN_SESSION",message:"User không thuộc phiên yêu cầu"}});
  const clientRequestId=String(req.body?.clientRequestId||"").trim(); if(clientRequestId&&!validId(clientRequestId))return res.status(400).json({error:"clientRequestId không hợp lệ"});
  let result; try { result = await storage.mutate(d=>{const qs=new QuestionService(d),created=qs.createManual({ sessionId: session.id, userId, username: canonical?.username||"", nickname: canonical?.nickname||String(req.body?.nickname || "").trim().slice(0, 100), text, reason: String(req.body?.reason || "").trim().slice(0, 200) || null, duplicateAction: req.body?.duplicateAction, targetThreadId: req.body?.targetThreadId,clientRequestId:clientRequestId||null });if(created.suggestion)return created;new GiftService(d).link(session.id,created.thread.userId,created.thread.id);new SessionService(d).refreshSummary(session.id);return{...created,threadId:created.thread.id,thread:undefined}}); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  if (result.suggestion) return res.status(409).json({ error: "Có câu hỏi tương tự", duplicateSuggestion: result.suggestion });
  const thread=store.questionThreads.find(q=>q.id===result.threadId);const payload = { ...questions.enrichThread(thread), ...meta(session) };
  io.emit("question:manually-created", payload); io.emit("queue:updated", { ...meta(session), questionId: thread.id }); emitUser(thread.userId, session.id);if(thread.giftPriority)io.emit("gift:question-linked",{...meta(session),userId:thread.userId,questionId:thread.id,eventId:`manual-link:${thread.id}`,committedAt:new Date().toISOString()});
  res.status(result.created ? 201 : 200).json(payload);
});
app.patch("/api/questions/:id/pin",async(req,res)=>{if(typeof req.body?.pinned!=="boolean")return res.status(400).json({error:"pinned phải là boolean"});const session=resolveSession(req,res,{required:true});if(!session)return;let thread;try{const result=await storage.mutate(d=>{const item=new QuestionService(d).setPinned(req.params.id,session.id,req.body.pinned);return item?.id||null});thread=result?store.questionThreads.find(q=>q.id===result):null}catch{return res.status(500).json({error:{code:"SAVE_FAILED",message:"Không lưu được trạng thái ghim"}})}if(!thread)return res.status(404).json({error:"Không tìm thấy câu hỏi"});const payload={...questions.enrichThread(thread),...meta(session),eventId:`pin:${thread.id}:${Date.now()}`,committedAt:new Date().toISOString()};io.emit("question:priority-updated",payload);io.emit("queue:updated",{...meta(session),questionId:thread.id});res.json(payload)});
app.patch("/api/questions/:id/priority", async (req, res) => {
  const session = resolveSession(req, res, { required: true }); if (!session) return;
  let id; try { id = await storage.mutate(d=>new QuestionService(d).updatePriority(req.params.id,session.id,req.body?.action)?.id||null); } catch (error) { return res.status(error.message==="INVALID_PRIORITY_ACTION"?400:500).json({ error: error.message }); }
  const thread=id?store.questionThreads.find(q=>q.id===id):null;if (!thread) return res.status(404).json({ error: "Không tìm thấy câu hỏi trong phiên yêu cầu" });
  const payload = { ...questions.enrichThread(thread), ...meta(session) }; io.emit("question:priority-updated", payload); io.emit("queue:updated", { ...meta(session), questionId: thread.id }); res.json(payload);
});
app.patch("/api/questions/:id/archive", async (req, res) => {
  const session = resolveSession(req, res, { required: true }); if (!session) return; if (typeof req.body?.archived !== "boolean") return res.status(400).json({ error: "archived phải là boolean" });
  let id;try{id=await storage.mutate(d=>{const thread=new QuestionService(d).archive(req.params.id,session.id,req.body.archived);if(thread)new SessionService(d).refreshSummary(session.id);return thread?.id||null})}catch{return res.status(500).json({error:"Không lưu được câu hỏi"})}const thread=id?store.questionThreads.find(q=>q.id===id):null;if (!thread) return res.status(404).json({ error: "Không tìm thấy câu hỏi" });
  const payload = { ...questions.enrichThread(thread), ...meta(session) }; io.emit("question:updated", payload); io.emit("queue:updated", { ...meta(session), questionId: thread.id }); res.json(payload);
});

app.post("/api/sessions/:id/end", async (req, res) => { if (!validId(req.params.id)) return res.status(400).json({ error: "Session ID không hợp lệ" }); const session = sessions.get(req.params.id); if (!session) return res.status(404).json({ error: "Không tìm thấy phiên" }); if (activeSessionId() === session.id) await stopConnection(); streamEndConfirmation.clear(); sessions.end(session.id, "manual_end"); await storage.save(); const payload = { ...sessions.summary(session.id), ...meta(session) }; io.emit("session:ended", payload); setStatus({ state: "idle", message: "Đã kết thúc phiên", roomId: null, nextReconnectAt: null }); res.json(payload); });
app.post("/api/sessions/start", async (_req, res) => { if (activeSession()?.status === "live") return res.status(409).json({ error: "Hãy kết thúc phiên LIVE hiện tại trước" }); streamEndConfirmation.clear(); const session = sessions.start(targetUsername, guard.generation + 1); await storage.save(); io.emit("session:created", { ...sessions.summary(session.id), ...meta(session) }); const result = await connectTikTok(); res.status(result.ok ? 201 : 202).json({ session: sessions.summary(session.id), connection: result }); });
app.post("/api/sessions/:id/reset-answers", async (req, res) => { const session = sessions.get(req.params.id); if (!session) return res.status(404).json({ error: "Không tìm thấy phiên" }); if (req.body?.confirmation !== "RESET TRA BAI") return res.status(400).json({ error: "Confirmation không hợp lệ" }); const result = sessions.resetAnswers(session.id); await storage.save(); const payload = { sessionId: session.id, updated: result.updated, ...meta(session) }; io.emit("session:answers-reset", payload); res.json(payload); });
app.delete("/api/sessions/:id", async (req, res) => { const session = sessions.get(req.params.id); if (!session) return res.status(404).json({ error: "Không tìm thấy phiên" }); if (req.body?.confirmation !== "XOA PHIEN") return res.status(400).json({ error: "Confirmation không hợp lệ" }); if (session.status === "live" || activeSessionId() === session.id) return res.status(409).json({ error: "Phải kết thúc phiên hiện tại trước khi xóa" }); const backup = await storage.backupSession(session.id); const snapshot = structuredClone(store); try { const summary = sessions.deleteSession(session.id); await storage.save(); const payload = { sessionId: session.id, summary, backupCreated: true, ...meta(session) }; io.emit("session:deleted", payload); res.json(payload); } catch (error) { Object.assign(store, snapshot); res.status(500).json({ error: `Không xóa được phiên: ${error.message}` }); } });

app.post("/api/target", async (req, res) => { const normalized = normalizeTargetInput(req.body?.username); if (!normalized) return res.status(400).json({ ok: false, error: { code: "INVALID_USERNAME", message: "TikTok ID không hợp lệ." } }); if (normalized === targetUsername) return res.json({ ok: true, unchanged: true, target: targetPayload(), status }); const previousUsername = targetUsername; io.emit("target:changing", { username: normalized, previousUsername, timestamp: new Date().toISOString(), sessionId: activeSessionId(), roomId: activeSession()?.roomId || null, targetUsername }); await stopConnection(); streamEndConfirmation.clear(); const switched = sessions.switchTarget(normalized, guard.generation + 1); targetUsername = normalized; await storage.save(); const payload = { username: normalized, previousUsername, sessionId: switched.session.id, targetUsername: normalized, roomId: null, timestamp: new Date().toISOString() }; io.emit("target:changed", payload); const result = await connectTikTok(); if (!result.ok) return res.status(502).json({ ok: false, error: { code: "CONNECTION_FAILED", message: result.error }, target: targetPayload(), status }); res.json({ ok: true, target: targetPayload(), status, activeSession: activeSession() }); });
app.post("/api/connect", async (_req, res) => { const result = await requestReconnect("manual_connect"); res.status(result.ok ? 200 : result.cooldown ? 202 : 503).json(result.ok ? { ok: true, ...result } : { ok: false, ...result }); });
app.post("/api/collector/reconnect", async (_req, res) => { const result = await requestReconnect("manual_reconnect"); res.status(result.ok ? 200 : result.cooldown ? 202 : 503).json({ ...result, reconnectInProgress: reconnectController.inProgress, reason: "MANUAL_RECONNECT" }); });
app.post("/api/disconnect", async (_req, res) => { await stopConnection(); streamEndConfirmation.clear(); setStatus({ state: "idle", message: "Đã dừng thu comment", roomId: null, nextReconnectAt: null }); res.json({ ok: true }); });
app.get("/api/export.csv", (req, res) => { const session = resolveSession(req, res, { required: true }); if (!session) return; const comments = scopedComments(session.id); const threads = scopedThreads(session.id); const safe=value=>/^[=+\-@\t\r]/.test(String(value??""))?`'${value}`:value; const quote = value => `"${String(safe(value) ?? "").replaceAll('"', '""')}"`; const rows = [["sessionId","targetUsername","roomId","receivedAt","eventTimestamp","userId","username","nickname","comment","question","questionScore","questionThreadId","questionItemId","questionItemStatus","answered"], ...comments.map(comment => { const thread = threads.find(item => item.commentIds.includes(comment.id)); const item = thread ? questions.normalizeQuestionItems(thread).find(candidate => candidate.commentIds.includes(comment.id)) : null; return [session.id,session.targetUsername,session.roomId,comment.receivedAt,comment.eventTimestamp,comment.userId,comment.username,comment.nickname,comment.text,comment.question,comment.questionScore,thread?.id||"",item?.id||"",item?.status||"",thread?.answered||false]; })]; res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="${session.targetUsername}-comments.csv"`); res.send("\uFEFF" + rows.map(row => row.map(quote).join(",")).join("\n")); });

io.on("connection", socket => { socket.emit("status", { ...status, ...meta(activeSession()) }); const session = activeSession(); if (session) socket.emit("viewer:updated", { ...viewerFor(session).payload(), ...meta(session) }); });
httpServer.listen(PORT, HOST, () => { console.log(`LIVE Comment Hub: http://${HOST}:${PORT}`); console.log(REMOTE_BACKEND_MODE ? `Development proxy dùng backend: ${REMOTE_BACKEND_URL}` : `Đang theo dõi: @${targetUsername}`); if (!DISABLE_TIKTOK) void connectTikTok(); });
async function shutdown() { clearTimeout(analyticsSaveTimer); clearInterval(watchdogTimer); await drainChatBatches(); await stopConnection(); try { await storage.save(); } catch {} httpServer.close(() => process.exit(0)); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
