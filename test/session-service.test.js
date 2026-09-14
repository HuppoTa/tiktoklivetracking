import test from "node:test";
import assert from "node:assert/strict";
import { SessionService } from "../src/session-service.js";
import { ConnectionGuard, retireConnection } from "../src/connection-guard.js";
import { QuestionService } from "../src/question-service.js";

function store() { return { settings: { targetUsername: "account.a", recentTargets: ["account.a"] }, sessions: [], activeSessionId: null, comments: [], questionThreads: [], gifts:[], giftAttention:[] }; }

test("cùng target không tạo session/connection generation mới", () => {
  const data = store(), service = new SessionService(data, () => new Date("2026-01-01T00:00:00Z"));
  const first = service.ensureActive("account.a"); const second = service.switchTarget("account.a");
  assert.equal(second.changed, false); assert.equal(second.session.id, first.id); assert.equal(data.sessions.length, 1);
});

test("đổi target đóng session cũ và tạo session mới", () => {
  const data = store(), service = new SessionService(data, () => new Date("2026-01-01T00:00:00Z"));
  const old = service.ensureActive("account.a"); const result = service.switchTarget("account.b");
  assert.equal(old.status, "ended"); assert.equal(old.endReason, "target_changed"); assert.ok(old.endedAt);
  assert.equal(result.session.targetUsername, "account.b"); assert.notEqual(result.session.id, old.id);
});

test("A → B → C chỉ generation C hợp lệ và timer A bị hủy", async () => {
  const guard = new ConnectionGuard(); let called = false;
  const a = guard.next(); guard.schedule(a, () => { called = true; }, 5);
  const b = guard.next(); const c = guard.next();
  assert.equal(guard.isCurrent(a), false); assert.equal(guard.isCurrent(b), false); assert.equal(guard.isCurrent(c), true);
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(called, false);
});

test("scheduleOnce không dời reconnect khi nhiều lỗi cùng generation", async () => {
  const guard = new ConnectionGuard(); const generation = guard.next(); let calls = 0;
  assert.equal(guard.scheduleOnce(generation, () => { calls += 1; }, 5), true);
  assert.equal(guard.scheduleOnce(generation, () => { calls += 1; }, 5), false);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls, 1);
  assert.equal(guard.reconnectTimer, null);
});

test("event muộn và viewer cũ bị guard từ chối", () => {
  const guard = new ConnectionGuard(); const old = guard.next(); guard.next();
  assert.equal(guard.isCurrent(old), false);
});

test("đổi A → B gỡ listener và disconnect connection A", async () => {
  const guard = new ConnectionGuard(); guard.next();
  const fake = { listenersRemoved: false, disconnected: false, removeAllListeners() { this.listenersRemoved = true; }, disconnect() { this.disconnected = true; } };
  await retireConnection(guard, fake);
  assert.equal(fake.listenersRemoved, true); assert.equal(fake.disconnected, true);
});

test("comment và hàng đợi được phân tách theo session", () => {
  const data = store(), service = new QuestionService(data);
  const base = { timestamp: "2026-01-01T00:00:00Z", userId: "u1", username: "demo", nickname: "Demo", avatar: "", normalizedText: "cau hoi", text: "Câu hỏi?", question: true };
  service.addComment({ ...base, id: "m1", sessionId: "s1", targetUsername: "account.a" });
  service.addComment({ ...base, id: "m2", sessionId: "s2", targetUsername: "account.b" });
  assert.equal(data.questionThreads.length, 2);
  assert.equal(service.getQuestions({ sessionId: "s1" }).length, 1);
  assert.equal(service.getQuestions({ sessionId: "s2" }).length, 1);
  assert.equal(data.comments.find(item => item.id === "m2").sessionId, "s2");
});

test("cùng room reconnect dùng session cũ, room mới tạo session mới", () => {
  const data = store(), service = new SessionService(data, () => new Date("2026-01-01T00:00:00Z"));
  service.ensurePending("account.a", 1); const first = service.attachRoom("account.a", "room-1", 1).session;
  assert.equal(service.attachRoom("account.a", "room-1", 2).session.id, first.id);
  const second = service.attachRoom("account.a", "room-2", 3).session;
  assert.notEqual(second.id, first.id); assert.equal(first.status, "ended"); assert.equal(first.endReason, "room_changed");
});

test("kết thúc giữ dữ liệu và start mới không copy", () => {
  const data = store(), service = new SessionService(data, () => new Date("2026-01-01T00:00:00Z"));
  const first = service.ensurePending("account.a"); data.comments.push({ id: "m1", sessionId: first.id });
  service.end(first.id); const second = service.start("account.a");
  assert.equal(data.comments.length, 1); assert.notEqual(second.id, first.id); assert.equal(data.comments.some(item => item.sessionId === second.id), false);
});

test("delete chỉ đúng session, chặn active và reset answers giữ record", () => {
  const data = store(), service = new SessionService(data, () => new Date("2026-01-01T00:00:00Z"));
  const first = service.ensurePending("account.a"); data.comments.push({ id: "m1", sessionId: first.id }); data.questionThreads.push({ id: "q1", sessionId: first.id, answered: true, answeredAt: "2026-01-01T01:00:00Z" });
  data.gifts.push({ id:"g1", sessionId:first.id }); data.giftAttention.push({ userId:"u1", sessionId:first.id });
  assert.throws(() => service.deleteSession(first.id), /ACTIVE_SESSION/);
  service.end(first.id); const reset = service.resetAnswers(first.id); assert.equal(reset.updated, 1); assert.equal(data.questionThreads[0].answered, false); assert.equal(data.comments.length, 1);
  service.deleteSession(first.id); assert.equal(data.comments.length, 0); assert.equal(data.questionThreads.length, 0);
  assert.equal(data.gifts.length, 0); assert.equal(data.giftAttention.length, 0);
});

test("retention chỉ xóa session đã kết thúc trước cutoff", () => {
  const data=store(),service=new SessionService(data,()=>new Date("2026-01-03T00:00:00Z"));
  const old=service.ensurePending("account.a");service.end(old.id);old.endedAt="2026-01-01T00:00:00.000Z";
  const recent=service.start("account.a");service.end(recent.id);recent.endedAt="2026-01-02T18:00:00.000Z";
  const active=service.start("account.a");
  data.comments.push({id:"old-comment",sessionId:old.id},{id:"recent-comment",sessionId:recent.id});
  assert.deepEqual(service.purgeEndedBefore(new Date("2026-01-02T00:00:00Z")), [old.id]);
  assert.equal(service.get(old.id),null);assert.ok(service.get(recent.id));assert.ok(service.get(active.id));
  assert.deepEqual(data.comments.map(item=>item.id),["recent-comment"]);
});
