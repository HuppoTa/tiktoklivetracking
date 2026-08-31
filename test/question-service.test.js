import test from "node:test";
import assert from "node:assert/strict";
import { QuestionService } from "../src/question-service.js";
import { normalizeText } from "../src/normalize.js";

function setup() {
  const store = { schemaVersion: 2, comments: [], questionThreads: [] };
  return { store, service: new QuestionService(store) };
}

function comment(id, userId, text, timestamp = "2026-01-01T00:00:00.000Z") {
  return { id, timestamp, userId, username: `user.${userId}`, nickname: `User ${userId}`, avatar: "", text, normalizedText: normalizeText(text), question: true };
}

test("hai message cùng ID không tạo hai comment", () => {
  const { store, service } = setup();
  service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?"));
  assert.equal(service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?")).duplicateMessage, true);
  assert.equal(store.comments.length, 1);
});

test("cùng user gửi cùng câu hỏi năm lần tạo một thread repeatCount 5", () => {
  const { store, service } = setup();
  for (let i = 1; i <= 5; i++) service.addComment(comment(`m${i}`, "u1", i % 2 ? "Chị ơi công việc sắp tới thế nào ạ?" : "Công việc sắp tới thế nào?"));
  assert.equal(store.questionThreads.length, 1);
  assert.equal(store.questionThreads[0].repeatCount, 5);
  assert.equal(store.questionThreads[0].commentIds.length, 5);
});

test("cùng user gửi ba câu khác nhau tạo ba thread", () => {
  const { store, service } = setup();
  service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?"));
  service.addComment(comment("m2", "u1", "Tình cảm với người cũ ra sao?"));
  service.addComment(comment("m3", "u1", "Tài chính tháng sau có tốt không?"));
  assert.equal(store.questionThreads.length, 3);
});

test("hai user gửi cùng nội dung tạo hai thread riêng", () => {
  const { store, service } = setup();
  service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?"));
  service.addComment(comment("m2", "u2", "Công việc sắp tới thế nào?"));
  assert.equal(store.questionThreads.length, 2);
});

test("thread đã trả nhận occurrence lặp vẫn giữ answered", () => {
  const { store, service } = setup();
  const first = service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?"));
  service.setThreadAnswered(first.thread.id, true, new Date("2026-01-02T00:00:00Z"));
  service.addComment(comment("m2", "u1", "Chị ơi công việc sắp tới thế nào ạ?"));
  assert.equal(store.questionThreads[0].answered, true);
  assert.equal(store.questionThreads[0].repeatCount, 2);
});

test("hoàn tác đặt answeredAt null", () => {
  const { service } = setup();
  const result = service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?"));
  service.setThreadAnswered(result.thread.id, true);
  const thread = service.setThreadAnswered(result.thread.id, false);
  assert.equal(thread.answered, false);
  assert.equal(thread.answeredAt, null);
});

test("đánh dấu tất cả câu hỏi của user", () => {
  const { store, service } = setup();
  service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?"));
  service.addComment(comment("m2", "u1", "Tình cảm sắp tới ra sao?"));
  service.addComment(comment("m3", "u2", "Tài chính sắp tới thế nào?"));
  assert.equal(service.setUserAnswered("u1", true).length, 2);
  assert.equal(store.questionThreads.filter(item => item.userId === "u1").every(item => item.answered), true);
  assert.equal(store.questionThreads.find(item => item.userId === "u2").answered, false);
});

test("thống kê user phân biệt occurrence và thread", () => {
  const { service } = setup();
  service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?"));
  service.addComment(comment("m2", "u1", "Công việc sắp tới thế nào?"));
  service.addComment(comment("m3", "u1", "Tình cảm sắp tới ra sao?"));
  const stats = service.getUsers()[0];
  assert.deepEqual({ totalQuestions: stats.totalQuestions, uniqueQuestions: stats.uniqueQuestions, repeatedQuestions: stats.repeatedQuestions, unansweredQuestions: stats.unansweredQuestions }, { totalQuestions: 3, uniqueQuestions: 2, repeatedQuestions: 1, unansweredQuestions: 2 });
});
