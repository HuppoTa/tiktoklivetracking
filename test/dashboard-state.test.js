import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptsSessionEvent, clearSelectedSessionState, emptyStateFor, initialDashboardState, mergeQuestionUpdate, mergeViewerUpdate,
  normalizeDashboardPayload, restoreQuestion, selectQuestions,
  setQuestionAnsweredLocally, snapshotQuestion
} from "../public/dashboard-state.js";

function thread(overrides = {}) {
  return { id: "q1", userId: "u1", username: "demo", nickname: "Demo", canonicalText: "Câu hỏi mẫu?", commentIds: ["m1"], occurrences: [{ id: "m1" }], repeatCount: 1, answered: false, answeredAt: null, createdAt: "2026-01-01T00:00:00Z", lastAskedAt: "2026-01-01T00:01:00Z", ...overrides };
}

test("regression white-screen: partial socket update merge theo id không làm mất field", () => {
  const state = initialDashboardState();
  state.questions = [thread()];
  assert.equal(mergeQuestionUpdate(state, { id: "q1", answered: true, answeredAt: "2026-01-01T00:02:00Z" }), true);
  assert.equal(state.questions[0].canonicalText, "Câu hỏi mẫu?");
  assert.deepEqual(state.questions[0].occurrences, [{ id: "m1" }]);
});

test("frontend chỉ nhận socket event của selected session", () => {
  const state = initialDashboardState(); state.selectedSession = { id: "s2" };
  assert.equal(acceptsSessionEvent(state, { sessionId: "s1" }), false);
  assert.equal(acceptsSessionEvent(state, { sessionId: "s2" }), true);
});

test("đổi selected session clear dữ liệu hiển thị cũ", () => {
  const state = initialDashboardState(); state.comments = [{ id: "m1" }]; state.questions = [thread()];
  clearSelectedSessionState(state, { id: "s2" });
  assert.equal(state.selectedSession.id, "s2"); assert.deepEqual(state.comments, []); assert.deepEqual(state.questions, []);
});

test("PATCH lỗi có thể rollback snapshot đầy đủ", () => {
  const state = initialDashboardState(); state.questions = [thread()];
  const snapshot = snapshotQuestion(state, "q1");
  setQuestionAnsweredLocally(state, "q1", true);
  restoreQuestion(state, snapshot);
  assert.equal(state.questions[0].answered, false);
  assert.equal(state.questions[0].answeredAt, null);
});

test("question cuối rời tab trả empty state mà không throw", () => {
  const state = initialDashboardState(); state.questions = [thread()];
  setQuestionAnsweredLocally(state, "q1", true);
  assert.deepEqual(selectQuestions(state, { answered: false }), []);
  assert.equal(emptyStateFor("unanswered").title, "Đã xử lý hết câu hỏi trong hàng chờ.");
});

test("hoàn tác đưa question trở lại hàng chờ", () => {
  const state = initialDashboardState(); state.questions = [thread({ answered: true, answeredAt: "2026-01-01T00:02:00Z" })];
  setQuestionAnsweredLocally(state, "q1", false);
  assert.equal(selectQuestions(state, { answered: false }).length, 1);
});

test("socket duplicate update idempotent và không tạo card trùng", () => {
  const state = initialDashboardState(); state.questions = [thread()];
  mergeQuestionUpdate(state, thread({ repeatCount: 2 }));
  mergeQuestionUpdate(state, thread({ repeatCount: 2 }));
  assert.equal(state.questions.length, 1);
  assert.equal(state.questions[0].repeatCount, 2);
});

test("state render chịu được payload thiếu array hoặc array rỗng", () => {
  const state = normalizeDashboardPayload({ questions: null, users: undefined, comments: [] });
  assert.deepEqual(state.questions, []);
  assert.deepEqual(state.users, []);
  assert.doesNotThrow(() => selectQuestions(state, { answered: false }));
});

test("viewer update thiếu count giữ giá trị gần nhất", () => {
  const state = initialDashboardState();
  mergeViewerUpdate(state, { currentViewers: 9, peakViewers: 12, lastViewerUpdateAt: "2026-01-01T00:00:00Z" });
  mergeViewerUpdate(state, { memberJoinEvents: 3 });
  assert.equal(state.analytics.viewers.current, 9);
  assert.equal(state.analytics.viewers.peak, 12);
});
