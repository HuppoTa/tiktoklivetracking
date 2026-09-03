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
import { NeonStorage } from "./src/neon-storage.js";
import { normalizeTargetInput, resolveTarget } from "./src/target.js";
import { normalizeQuestionEvent, normalizeTikTokEvent } from "./src/tiktok-normalizer.js";
import { normalizeTikTokGift } from "./src/tiktok-gift-normalizer.js";
import { GiftService, validateGiftSettingsPatch } from "./src/gift-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const ALLOW_REMOTE_ACCESS = process.env.ALLOW_REMOTE_ACCESS === "true";
const APP_AUTH_TOKEN = process.env.APP_AUTH_TOKEN || "";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || (process.env.RAILWAY_ENVIRONMENT ? "https://tiktoklivetracking.vercel.app" : "");
const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
if ((!loopbackHosts.has(HOST) || ALLOW_REMOTE_ACCESS) && !APP_AUTH_TOKEN) throw new Error("REMOTE_ACCESS_REQUIRES_APP_AUTH_TOKEN");
const DISABLE_TIKTOK = process.env.DISABLE_TIKTOK === "1";
const QUESTION_DEBUG = process.env.QUESTION_DEBUG === "true";
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "data");
const storage = process.env.DATABASE_URL
  ? new NeonStorage({ databaseUrl: process.env.DATABASE_URL })
  : new JsonStorage({ storeFile: join(DATA_DIR, "store.json"), legacyFile: join(DATA_DIR, "comments.json") });
const store = await storage.load();
const questions = new QuestionService(store); const sessions = new SessionService(store);
const gifts = new GiftService(store);
let targetUsername = resolveTarget(process.env.TIKTOK_USERNAME, store.settings?.targetUsername);
if (sessions.active?.targetUsername !== targetUsername) sessions.switchTarget(targetUsername); else sessions.ensurePending(targetUsername);
store.settings.targetUsername = targetUsername;

const app = express(); const httpServer = createServer(app); const io = new Server(httpServer, {
  cors: FRONTEND_ORIGIN ? { origin: FRONTEND_ORIGIN } : undefined,
});
app.disable("x-powered-by"); app.use((_req,res,next)=>{res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","no-referrer");res.setHeader("X-Frame-Options","DENY");next();});
app.use((req, res, next) => {
  if (FRONTEND_ORIGIN && req.headers.origin === FRONTEND_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", FRONTEND_ORIGIN);
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
  }
  next();
});
const requiresAuth = Boolean(APP_AUTH_TOKEN); const authorized = req => !requiresAuth || req.headers.authorization === `Bearer ${APP_AUTH_TOKEN}`;
app.use((req,res,next)=>{if(req.path.startsWith("/api/")&&!['/api/health','/api/ready'].includes(req.path)&&!authorized(req))return res.status(401).json({error:{code:"UNAUTHORIZED",message:"Authentication required"}});next();});
io.use((socket,next)=>{if(!requiresAuth||socket.handshake.auth?.token===APP_AUTH_TOKEN)return next();next(new Error("UNAUTHORIZED"));});
app.use(express.static(join(__dirname, "public"))); app.use(express.json({ limit: "32kb" }));
const guard = new ConnectionGuard(); let connection = null; let connectionContext = null; let analyticsSaveTimer = null;
let status = { state: "idle", username: targetUsername, message: "Chưa kết nối", roomId: sessions.active?.roomId || null, lastCommentAt: null };
const telemetry = { reconnectAttempts:0,lastConnectAttempt:null,lastSuccessfulConnect:null,lastEventAt:null,oldGenerationEventsDropped:0,wrongSessionEventsDropped:0,initialEventsDropped:0,lastDisconnectReason:null };
const activeSession = () => sessions.active; const activeSessionId = () => activeSession()?.id;
const targetPayload = () => ({ username: targetUsername, displayUsername: `@${targetUsername}` });
const meta = session => ({ sessionId: session?.id || null, targetUsername: session?.targetUsername || targetUsername, roomId: session?.roomId || null, timestamp: new Date().toISOString() });
const scopedComments = id => store.comments.filter(comment => comment.sessionId === id);
const scopedThreads = id => store.questionThreads.filter(thread => thread.sessionId === id && thread.deleted !== true);
const viewerFor = session => new ViewerAnalytics(session?.viewerAnalytics);

function setStatus(next, generation) { if (generation !== undefined && !guard.isCurrent(generation)) return; status = { ...status, ...next, username: targetUsername }; io.emit("status", { ...status, ...meta(activeSession()) }); }
function scheduleSave() { if (analyticsSaveTimer) return; analyticsSaveTimer = setTimeout(async () => { analyticsSaveTimer = null; try { await storage.save(); } catch (error) { console.error("Không lưu được analytics:", error.message); } }, 3000); }
function eventIsCurrent(context) { const session = activeSession(); if(!context||connection!==context.connection||!guard.isCurrent(context.generation)){telemetry.oldGenerationEventsDropped++;return false} const valid=Boolean(context.sessionId&&session?.id===context.sessionId&&session.roomId===context.roomId&&session.status==="live"&&session.connectionGeneration===context.generation);if(!valid)telemetry.wrongSessionEventsDropped++;return valid; }
function isHistorical(normalized, session) { if (!normalized.eventTimestamp || !session.collectorConnectedAt) return false; return new Date(normalized.eventTimestamp).getTime() < new Date(session.collectorConnectedAt).getTime() - 5000; }
function emitUser(userId, sessionId) { const session = sessions.get(sessionId); const user = questions.getUsers(sessionId).find(item => item.userId === userId); if (user) io.emit("user:updated", { ...user, ...meta(session) }); }

async function onChat(data, context, forcedQuestion = false) {
  if (!eventIsCurrent(context)) return;
  const receivedAt = new Date(); const normalized = normalizeTikTokEvent(data, receivedAt, { forcedQuestion }); if (!normalized) return;
  const session = activeSession(); if (isHistorical(normalized, session)) { telemetry.initialEventsDropped++; return; } telemetry.lastEventAt=receivedAt.toISOString();
  const comment = { ...normalized, sessionId: session.id, targetUsername: session.targetUsername, roomId: session.roomId, connectionGeneration: context.generation };
  let committed; try { committed=await storage.mutate(draft=>{const current=draft.sessions.find(s=>s.id===session.id&&s.roomId===context.roomId&&s.connectionGeneration===context.generation&&s.status==="live");if(!current)throw new Error("STALE_EVENT");const service=new QuestionService(draft),result=service.addComment(comment);if(result.duplicateMessage)return{duplicateMessage:true};if(result.thread)new GiftService(draft).link(session.id,comment.userId,result.thread.id);new SessionService(draft).refreshSummary(session.id);return{duplicateMessage:false,threadId:result.thread?.id||null,threadCreated:result.threadCreated}});} catch (error) { console.error("Không lưu được comment metadata:", error.message); return; }
  if(committed.duplicateMessage)return;const result={thread:committed.threadId?store.questionThreads.find(q=>q.id===committed.threadId):null,threadCreated:committed.threadCreated};
  if (!eventIsCurrent(context)) return;
  io.emit("comment", comment);
  if (result.thread) { const thread = questions.enrichThread(result.thread); if (!QUESTION_DEBUG) delete thread.duplicateDebug; io.emit(result.threadCreated ? "question:created" : "question:updated", { ...thread, roomId: session.roomId, timestamp: receivedAt.toISOString() }); }
  if (comment.question) emitUser(comment.userId, session.id);
  setStatus({ lastCommentAt: comment.receivedAt }, context.generation);
}
async function onGift(data,context){if(!eventIsCurrent(context))return;const normalized=normalizeTikTokGift(data,new Date());if(!normalized)return;const session=activeSession(),gift={...normalized,sessionId:session.id,roomId:session.roomId,connectionGeneration:context.generation};if(gift.giftType===1&&!gift.repeatEnd){io.emit("gift:received",{...meta(session),userId:gift.userId,eventId:gift.id,questionId:null,committedAt:null,transient:true,repeatCount:gift.repeatCount});return}let result;try{result=await storage.mutate(draft=>new GiftService(draft).receive(gift))}catch{return}if(result.duplicate)return;const canonicalGift=store.gifts.find(g=>g.sessionId===session.id&&g.id===gift.id),attention=gifts.attention(session.id,gift.userId),thread=attention?.linkedQuestionId?store.questionThreads.find(q=>q.id===attention.linkedQuestionId):null,payload={...meta(session),userId:gift.userId,eventId:gift.id,questionId:thread?.id||null,committedAt:new Date().toISOString(),gift:canonicalGift,summary:gifts.summary(session.id,gift.userId),attention};io.emit("gift:received",payload);io.emit("gift:summary-updated",payload);if(attention){io.emit(thread?"gift:question-linked":"gift:attention-created",payload);io.emit("gift:attention-updated",payload)}if(thread)io.emit("question:updated",{...questions.enrichThread(thread),...meta(session)});}
function onRoomUser(data, context) { if (!eventIsCurrent(context)) return; const session = activeSession(); const analytics = viewerFor(session); const result = analytics.observeRoomUser(data); if (!result.updated) return; session.viewerAnalytics = analytics.state; io.emit("viewer:updated", { ...analytics.payload(), ...meta(session) }); if (result.sampled || result.changed) scheduleSave(); }
function onMember(data, context) { if (!eventIsCurrent(context)) return; const session = activeSession(); const analytics = viewerFor(session); const result = analytics.observeMember(data); if (!result.updated) return; session.viewerAnalytics = analytics.state; io.emit("viewer:updated", { ...analytics.payload(), ...meta(session) }); scheduleSave(); }
async function stopConnection() { const old = connection; connection = null; connectionContext = null; await retireConnection(guard, old); }
function scheduleReconnect(generation, message, reason="connection_lost") { if (!guard.isCurrent(generation)) return; telemetry.reconnectAttempts++;telemetry.lastDisconnectReason=reason;sessions.markOffline(); setStatus({ state: "offline", message, roomId: null }, generation); guard.schedule(generation, () => void connectTikTok(), 30000); }

async function connectTikTok() {
  if (DISABLE_TIKTOK) return { ok: false, error: "TikTok connector đang tắt" };
  telemetry.lastConnectAttempt=new Date().toISOString(); await stopConnection(); const generation = guard.next(); const username = targetUsername;
  sessions.ensurePending(username, generation); setStatus({ state: "connecting", message: `Đang kết nối @${username}...`, roomId: null }, generation);
  const current = new TikTokLiveConnection(username, { enableExtendedGiftInfo: false, processInitialData: false });
  const context = { connection: current, generation, username, sessionId: null, roomId: null }; connection = current; connectionContext = context;
  current.on(WebcastEvent.CHAT, data => void onChat(data, context, false));
  current.on(WebcastEvent.QUESTION_NEW, data => void onChat(normalizeQuestionEvent(data), context, true));
  current.on(WebcastEvent.GIFT,data=>void onGift(data,context));
  current.on(WebcastEvent.ROOM_USER, data => onRoomUser(data, context)); current.on(WebcastEvent.MEMBER, data => onMember(data, context));
  current.on(WebcastEvent.STREAM_END, async () => { if (!guard.isCurrent(generation)) return; const ended = sessions.closeActive("stream_end"); await storage.save(); if (ended) io.emit("session:ended", { ...sessions.summary(ended.id), ...meta(ended) }); scheduleReconnect(generation, `@${username} đã kết thúc LIVE.`); });
  current.on(ControlEvent.DISCONNECTED, () => scheduleReconnect(generation, "Mất kết nối — sẽ thử lại sau 30 giây"));
  current.on(ControlEvent.ERROR, ({ info, exception } = {}) => { if (guard.isCurrent(generation)) console.error("TikTok error:", info || exception?.message || "Unknown error"); });
  try {
    const result = await current.connect(); if (connection !== current || !guard.isCurrent(generation)) return { ok: false, stale: true };
    const attached = sessions.attachRoom(username, result.roomId, generation, new Date()); if (!attached) throw new Error("TikTok không trả room ID hợp lệ"); telemetry.lastSuccessfulConnect=new Date().toISOString();
    context.sessionId = attached.session.id; context.roomId = attached.session.roomId;
    const analytics = viewerFor(attached.session); analytics.startSession(result.roomId); attached.session.viewerAnalytics = analytics.state; await storage.save();
    setStatus({ state: "live", message: "Đang thu comment trực tiếp", roomId: result.roomId }, generation);
    io.emit(attached.created ? "session:created" : "session:updated", { ...sessions.summary(attached.session.id), ...meta(attached.session) });
    io.emit("viewer:updated", { ...analytics.payload(), ...meta(attached.session) }); return { ok: true, roomId: result.roomId, sessionId: attached.session.id };
  } catch (error) { if (!guard.isCurrent(generation)) return { ok: false, stale: true }; const message = String(error?.message || error); const display = message.includes("not live") ? `@${username} hiện chưa livestream. Hệ thống sẽ tự thử lại sau 30 giây.` : `Không kết nối được: ${message}`; scheduleReconnect(generation, display); return { ok: false, error: display }; }
}

function validId(value) { return typeof value === "string" && value.length > 0 && value.length <= 200 && /^[\w:.-]+$/u.test(value); }
function validUserId(value) { return validId(value) && !["undefined","null"].includes(value); }
function resolveSession(req, res, { required = false } = {}) { const id = String(req.query.sessionId || req.body?.sessionId || activeSessionId() || ""); const session = sessions.get(id); if (!session && (required || id)) { res.status(404).json({ error: "Không tìm thấy phiên" }); return null; } return session; }
function stateFor(session) { const id = session?.id; const threads = id ? scopedThreads(id) : []; return { target: targetPayload(), settings: { recentTargets: store.settings.recentTargets, questionDebug: QUESTION_DEBUG },giftSettings:store.giftSettings, activeSession: activeSession(), selectedSession: session || null, sessions: sessions.list(), status, comments: id ? scopedComments(id) : [], questions: id ? questions.getQuestions({ sessionId: id }) : [], users: id ? questions.getUsers(id) : [],gifts:id?store.gifts.filter(g=>g.sessionId===id):[],giftAttention:id?store.giftAttention.filter(a=>a.sessionId===id):[], analytics: buildAnalytics(threads, session?.viewerAnalytics, id?store.gifts.filter(g=>g.sessionId===id):[],id?store.giftAttention.filter(a=>a.sessionId===id):[]) }; }
function requireAnswered(req, res) { if (typeof req.body?.answered !== "boolean") { res.status(400).json({ error: "answered phải là boolean" }); return null; } return req.body.answered; }

app.get("/api/health", (_req,res)=>res.json({status:"ok",process:{uptimeSeconds:Math.floor(process.uptime())}}));
app.get("/api/ready", (_req,res)=>{const ready=storage.readiness();const payload={status:ready.ready?"ok":ready.storageHealthy?"degraded":"unhealthy",storage:{healthy:ready.storageHealthy,lastSaveAt:ready.lastSaveAt,lastErrorAt:ready.lastSaveErrorAt,consecutiveFailures:ready.consecutiveSaveFailures,pendingTransactions:ready.pendingTransactions},collector:{state:status.state,targetUsername,roomIdPresent:Boolean(activeSession()?.roomId),connectionGeneration:guard.generation,activeConnectionCount:connection?1:0,lastEventAt:telemetry.lastEventAt,...telemetry},process:{uptimeSeconds:Math.floor(process.uptime())}};res.status(ready.ready?200:503).json(payload);});

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

app.post("/api/sessions/:id/end", async (req, res) => { if (!validId(req.params.id)) return res.status(400).json({ error: "Session ID không hợp lệ" }); const session = sessions.get(req.params.id); if (!session) return res.status(404).json({ error: "Không tìm thấy phiên" }); if (activeSessionId() === session.id) await stopConnection(); sessions.end(session.id, "manual_end"); await storage.save(); const payload = { ...sessions.summary(session.id), ...meta(session) }; io.emit("session:ended", payload); setStatus({ state: "idle", message: "Đã kết thúc phiên", roomId: null }); res.json(payload); });
app.post("/api/sessions/start", async (_req, res) => { if (activeSession()?.status === "live") return res.status(409).json({ error: "Hãy kết thúc phiên LIVE hiện tại trước" }); const session = sessions.start(targetUsername, guard.generation + 1); await storage.save(); io.emit("session:created", { ...sessions.summary(session.id), ...meta(session) }); const result = await connectTikTok(); res.status(result.ok ? 201 : 202).json({ session: sessions.summary(session.id), connection: result }); });
app.post("/api/sessions/:id/reset-answers", async (req, res) => { const session = sessions.get(req.params.id); if (!session) return res.status(404).json({ error: "Không tìm thấy phiên" }); if (req.body?.confirmation !== "RESET TRA BAI") return res.status(400).json({ error: "Confirmation không hợp lệ" }); const result = sessions.resetAnswers(session.id); await storage.save(); const payload = { sessionId: session.id, updated: result.updated, ...meta(session) }; io.emit("session:answers-reset", payload); res.json(payload); });
app.delete("/api/sessions/:id", async (req, res) => { const session = sessions.get(req.params.id); if (!session) return res.status(404).json({ error: "Không tìm thấy phiên" }); if (req.body?.confirmation !== "XOA PHIEN") return res.status(400).json({ error: "Confirmation không hợp lệ" }); if (session.status === "live" || activeSessionId() === session.id) return res.status(409).json({ error: "Phải kết thúc phiên hiện tại trước khi xóa" }); const backup = await storage.backupSession(session.id); const snapshot = structuredClone(store); try { const summary = sessions.deleteSession(session.id); await storage.save(); const payload = { sessionId: session.id, summary, backupCreated: true, ...meta(session) }; io.emit("session:deleted", payload); res.json(payload); } catch (error) { Object.assign(store, snapshot); res.status(500).json({ error: `Không xóa được phiên: ${error.message}` }); } });

app.post("/api/target", async (req, res) => { const normalized = normalizeTargetInput(req.body?.username); if (!normalized) return res.status(400).json({ ok: false, error: { code: "INVALID_USERNAME", message: "TikTok ID không hợp lệ." } }); if (normalized === targetUsername) return res.json({ ok: true, unchanged: true, target: targetPayload(), status }); const previousUsername = targetUsername; io.emit("target:changing", { username: normalized, previousUsername, timestamp: new Date().toISOString(), sessionId: activeSessionId(), roomId: activeSession()?.roomId || null, targetUsername }); await stopConnection(); const switched = sessions.switchTarget(normalized, guard.generation + 1); targetUsername = normalized; await storage.save(); const payload = { username: normalized, previousUsername, sessionId: switched.session.id, targetUsername: normalized, roomId: null, timestamp: new Date().toISOString() }; io.emit("target:changed", payload); const result = await connectTikTok(); if (!result.ok) return res.status(502).json({ ok: false, error: { code: "CONNECTION_FAILED", message: result.error }, target: targetPayload(), status }); res.json({ ok: true, target: targetPayload(), status, activeSession: activeSession() }); });
app.post("/api/connect", async (_req, res) => { const result = await connectTikTok(); res.status(result.ok ? 200 : 503).json(result.ok ? { ok: true, ...result } : { ok: false, error: result.error }); });
app.post("/api/disconnect", async (_req, res) => { await stopConnection(); setStatus({ state: "idle", message: "Đã dừng thu comment", roomId: null }); res.json({ ok: true }); });
app.get("/api/export.csv", (req, res) => { const session = resolveSession(req, res, { required: true }); if (!session) return; const comments = scopedComments(session.id); const threads = scopedThreads(session.id); const safe=value=>/^[=+\-@\t\r]/.test(String(value??""))?`'${value}`:value; const quote = value => `"${String(safe(value) ?? "").replaceAll('"', '""')}"`; const rows = [["sessionId","targetUsername","roomId","receivedAt","eventTimestamp","userId","username","nickname","comment","question","questionScore","questionThreadId","answered"], ...comments.map(comment => { const thread = threads.find(item => item.commentIds.includes(comment.id)); return [session.id,session.targetUsername,session.roomId,comment.receivedAt,comment.eventTimestamp,comment.userId,comment.username,comment.nickname,comment.text,comment.question,comment.questionScore,thread?.id||"",thread?.answered||false]; })]; res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="${session.targetUsername}-comments.csv"`); res.send("\uFEFF" + rows.map(row => row.map(quote).join(",")).join("\n")); });

io.on("connection", socket => { socket.emit("status", { ...status, ...meta(activeSession()) }); const session = activeSession(); if (session) socket.emit("viewer:updated", { ...viewerFor(session).payload(), ...meta(session) }); });
httpServer.listen(PORT, HOST, () => { console.log(`LIVE Comment Hub: http://${HOST}:${PORT}`); console.log(`Đang theo dõi: @${targetUsername}`); if (!DISABLE_TIKTOK) void connectTikTok(); });
async function shutdown() { clearTimeout(analyticsSaveTimer); await stopConnection(); try { await storage.save(); } catch {} httpServer.close(() => process.exit(0)); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
