import test from "node:test";
import assert from "node:assert/strict";
import { SessionService } from "../src/session-service.js";
import { ConnectionGuard, retireConnection } from "../src/connection-guard.js";
import { QuestionService } from "../src/question-service.js";

function store() { return { settings: { targetUsername: "account.a", recentTargets: ["account.a"] }, sessions: [], activeSessionId: null, comments: [], questionThreads: [] }; }

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
