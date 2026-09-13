import test from "node:test";
import assert from "node:assert/strict";
import { QuestionService } from "../src/question-service.js";
import { normalizeText } from "../src/normalize.js";

function setup() {
  const store = { schemaVersion: 2, comments: [], questionThreads: [] };
  return { store, service: new QuestionService(store) };
}

function comment(id, userId, text, timestamp = "2026-01-01T00:00:00.000Z") {
  return { id, timestamp, sessionId: "session-a", targetUsername: "account.a", userId, username: `user.${userId}`, nickname: `User ${userId}`, avatar: "", text, normalizedText: normalizeText(text), question: true };
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

test("cùng user gửi ba câu khác nhau vẫn chỉ tạo một queue entry", () => {
  const { store, service } = setup();
  service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?"));
  service.addComment(comment("m2", "u1", "Tình cảm với người cũ ra sao?"));
  service.addComment(comment("m3", "u1", "Tài chính tháng sau có tốt không?"));
  assert.equal(store.questionThreads.length, 1);
  assert.equal(store.questionThreads[0].questionItems.length, 3);
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

test("user đã trả hỏi câu mới thì reopen entry cũ, giữ queue number và lịch sử trả lời", () => {
  const { store, service } = setup();
  const first = service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?")).thread;
  first.queueNumber = 7;
  service.setThreadAnswered(first.id, true, new Date("2026-01-02T00:00:00Z"));
  service.addComment(comment("m2", "u1", "Tình cảm với người cũ ra sao?", "2026-01-03T00:00:00.000Z"));
  assert.equal(store.questionThreads.length, 1);
  assert.equal(first.answered, false);
  assert.equal(first.queueNumber, 7);
  assert.equal(first.questionItems.length, 2);
  assert.equal(first.answerHistory.length, 1);
});

test("hoàn tác đặt answeredAt null", () => {
  const { service } = setup();
  const result = service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?"));
  service.setThreadAnswered(result.thread.id, true);
  const thread = service.setThreadAnswered(result.thread.id, false);
  assert.equal(thread.answered, false);
  assert.equal(thread.answeredAt, null);
});

test("đánh dấu queue entry duy nhất của user", () => {
  const { store, service } = setup();
  service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?"));
  service.addComment(comment("m2", "u1", "Tình cảm sắp tới ra sao?"));
  service.addComment(comment("m3", "u2", "Tài chính sắp tới thế nào?"));
  assert.equal(service.setUserAnswered("u1", true).length, 1);
  assert.equal(store.questionThreads.filter(item => item.userId === "u1").every(item => item.answered), true);
  assert.equal(store.questionThreads.find(item => item.userId === "u2").answered, false);
});

test("thống kê user tách số câu con, vẫn chỉ có một card", () => {
  const { service } = setup();
  service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?"));
  service.addComment(comment("m2", "u1", "Công việc sắp tới thế nào?"));
  service.addComment(comment("m3", "u1", "Tình cảm sắp tới ra sao?"));
  const stats = service.getUsers()[0];
  assert.deepEqual({ totalQuestions: stats.totalQuestions, uniqueQuestions: stats.uniqueQuestions, repeatedQuestions: stats.repeatedQuestions, unansweredQuestions: stats.unansweredQuestions }, { totalQuestions: 3, uniqueQuestions: 2, repeatedQuestions: 1, unansweredQuestions: 2 });
});

test("một card có active question đầu tiên và các câu sau vẫn pending", () => {
  const { service } = setup();
  const thread = service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?", "2026-01-01T00:00:00.000Z")).thread;
  service.addComment(comment("m2", "u1", "Tình cảm với người cũ ra sao?", "2026-01-01T00:01:00.000Z"));
  service.addComment(comment("m3", "u1", "Tài chính tháng sau có tốt không?", "2026-01-01T00:02:00.000Z"));
  const view = service.enrichThread(thread);
  assert.equal(view.questionItems.length, 3);
  assert.equal(view.activeQuestion.id, view.questionItems[0].id);
  assert.equal(view.questionItems.filter(item => item.status === "ACTIVE").length, 1);
});

test("trả active chỉ chuyển câu đó và active kế tiếp tự đổi", () => {
  const { service } = setup(); const thread = service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?")).thread;
  service.addComment(comment("m2", "u1", "Tình cảm với người cũ ra sao?", "2026-01-01T00:01:00.000Z"));
  const first = service.enrichThread(thread).activeQuestion;
  service.setQuestionItemStatus(thread.id, first.id, "ANSWERED", new Date("2026-01-01T00:02:00.000Z"));
  const view = service.enrichThread(thread);
  assert.equal(view.answered, false); assert.equal(view.questionItems[0].status, "ANSWERED");
  assert.equal(view.activeQuestion.id, view.questionItems[1].id);
});

test("skip và undo tính lại active theo thứ tự tạo", () => {
  const { service } = setup(); const thread = service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?")).thread;
  service.addComment(comment("m2", "u1", "Tình cảm với người cũ ra sao?", "2026-01-01T00:01:00.000Z"));
  const first = service.enrichThread(thread).activeQuestion;
  service.setQuestionItemStatus(thread.id, first.id, "SKIPPED");
  assert.equal(service.enrichThread(thread).activeQuestion.id, thread.questionItems[1].id);
  service.setQuestionItemStatus(thread.id, first.id, "WAITING");
  assert.equal(service.enrichThread(thread).activeQuestion.id, first.id);
});

test("trả hết card rồi câu mới reopen với active mới", () => {
  const { service } = setup(); const thread = service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?")).thread;
  service.setQuestionItemStatus(thread.id, thread.questionItems[0].id, "ANSWERED");
  assert.equal(service.enrichThread(thread).answered, true);
  service.addComment(comment("m2", "u1", "Tình cảm với người cũ ra sao?", "2026-01-02T00:00:00.000Z"));
  const view = service.enrichThread(thread);
  assert.equal(view.answered, false); assert.equal(view.activeQuestion.text, "Tình cảm với người cũ ra sao?");
});

test("lặp lại câu không tạo câu con và giữ active hiện tại", () => {
  const { service } = setup(); const thread = service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?")).thread;
  service.addComment(comment("m2", "u1", "Tình cảm với người cũ ra sao?", "2026-01-01T00:01:00.000Z"));
  const active = service.enrichThread(thread).activeQuestion;
  service.addComment(comment("m3", "u1", "Chị ơi công việc sắp tới thế nào ạ?", "2026-01-01T00:02:00.000Z"));
  const view = service.enrichThread(thread);
  assert.equal(view.questionItems.length, 2); assert.equal(view.questionItems[0].repeatCount, 2); assert.equal(view.activeQuestion.id, active.id);
});

test("cùng user cùng nội dung nhưng khác session tạo hai thread", () => {
  const { store, service } = setup(); const first = comment("m1", "u1", "Công việc sắp tới thế nào?");
  service.addComment(first); service.addComment({ ...comment("m2", "u1", first.text), sessionId: "session-b" });
  assert.equal(store.questionThreads.length, 2);
});

test("lọc chưa trả dựa answered boolean và bỏ deleted", () => {
  const { service } = setup(); const a = service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?")).thread;
  const b = service.addComment(comment("m2", "u2", "Tình cảm sắp tới ra sao?")).thread;
  a.answered = false; a.answeredAt = "2026-01-01T01:00:00Z"; b.deleted = true;
  assert.deepEqual(service.getQuestions({ sessionId: "session-a", answered: false }).map(item => item.id), [a.id]);
});

test("answer/skip idempotent và hai tab không thể đổi terminal state của nhau", () => {
  const { service }=setup();const thread=service.addComment(comment("m1","u1","Công việc sắp tới thế nào?")).thread;const item=thread.questionItems[0];
  const first=service.transitionQuestionItem(thread.id,item.id,"ANSWERED",new Date("2026-01-01T00:01:00Z"),{idempotencyKey:"tab-a"});
  const retry=service.transitionQuestionItem(thread.id,item.id,"ANSWERED",new Date("2026-01-01T00:02:00Z"),{idempotencyKey:"tab-a"});
  const competing=service.transitionQuestionItem(thread.id,item.id,"SKIPPED",new Date("2026-01-01T00:03:00Z"),{idempotencyKey:"tab-b"});
  const current=service.enrichThread(thread).questionItems[0];assert.equal(first.item.status,"ANSWERED");assert.equal(retry.idempotent,true);assert.equal(competing.conflict,true);assert.equal(current.status,"ANSWERED");assert.equal(current.version,2);
});

test("terminal task chỉ trở lại waiting qua explicit undo có version mới", () => {
  const { service }=setup();const thread=service.addComment(comment("m1","u1","Công việc sắp tới thế nào?")).thread;const item=thread.questionItems[0];
  service.transitionQuestionItem(thread.id,item.id,"SKIPPED",new Date("2026-01-01T00:01:00Z"),{idempotencyKey:"skip"});
  service.transitionQuestionItem(thread.id,item.id,"WAITING",new Date("2026-01-01T00:02:00Z"),{idempotencyKey:"undo"});
  const current=service.enrichThread(thread).questionItems[0];assert.equal(current.status,"ACTIVE");assert.equal(current.version,3);assert.equal(thread.answered,false);
});

test("bulk user answer tăng item version để snapshot cũ không hồi sinh task", () => {
  const { service } = setup();
  const thread = service.addComment(comment("m1", "u1", "Công việc sắp tới thế nào?")).thread;
  const taskId = thread.questionItems[0].id;
  service.setUserAnswered("u1", true, new Date("2026-01-01T00:01:00Z"), "session-a");
  const answered = service.enrichThread(thread).questionItems.find(item => item.id === taskId);
  assert.equal(answered.status, "ANSWERED");
  assert.equal(answered.version, 2);
  service.setUserAnswered("u1", false, new Date("2026-01-01T00:02:00Z"), "session-a");
  const undone = service.enrichThread(thread).questionItems.find(item => item.id === taskId);
  assert.equal(undone.status, "ACTIVE");
  assert.equal(undone.version, 3);
});
