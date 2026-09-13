import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptsSessionEvent, clearSelectedSessionState, emptyStateFor, initialDashboardState, mergeCommentUpdate, mergeQuestionUpdate, mergeViewerUpdate,
  normalizeDashboardPayload, restoreQuestion, selectQuestions,
  pendingCommentIds, setQuestionAnsweredLocally, setQuestionItemStatusLocally, snapshotQuestion
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

test("item status cập nhật optimistic và chuyển active ngay", () => {
  const state = initialDashboardState();
  state.questions = [thread({
    questionItems: [
      { id: "i1", text: "Câu một", status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z" },
      { id: "i2", text: "Câu hai", status: "WAITING", createdAt: "2026-01-01T00:01:00Z" }
    ],
    activeQuestionId: "i1",
    activeQuestion: { id: "i1", text: "Câu một", status: "ACTIVE" }
  })];
  const at = "2026-01-01T00:02:00Z";
  assert.equal(setQuestionItemStatusLocally(state, "q1", "i1", "ANSWERED", at), true);
  assert.equal(state.questions[0].questionItems[0].answeredAt, at);
  assert.equal(state.questions[0].questionItems[1].status, "ACTIVE");
  assert.equal(state.questions[0].activeQuestionId, "i2");
  assert.equal(state.questions[0].answered, false);
  assert.equal(state.questions[0].canonicalText, "Câu hai");
});

test("item cuối xử lý optimistic đưa thread sang đã trả và rollback được", () => {
  const state = initialDashboardState();
  state.questions = [thread({
    questionItems: [{ id: "i1", text: "Câu một", status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z" }],
    activeQuestionId: "i1",
    activeQuestion: { id: "i1", text: "Câu một", status: "ACTIVE" }
  })];
  const snapshot = snapshotQuestion(state, "q1");
  assert.equal(setQuestionItemStatusLocally(state, "q1", "i1", "SKIPPED", "2026-01-01T00:02:00Z"), true);
  assert.equal(state.questions[0].answered, true);
  assert.deepEqual(selectQuestions(state, { answered: false }), []);
  restoreQuestion(state, snapshot);
  assert.equal(state.questions[0].answered, false);
  assert.equal(state.questions[0].questionItems[0].status, "ACTIVE");
});

test("socket duplicate update idempotent và không tạo card trùng", () => {
  const state = initialDashboardState(); state.questions = [thread()];
  mergeQuestionUpdate(state, thread({ repeatCount: 2 }));
  mergeQuestionUpdate(state, thread({ repeatCount: 2 }));
  assert.equal(state.questions.length, 1);
  assert.equal(state.questions[0].repeatCount, 2);
});

test("payload socket cũ không làm câu đã trả xuất hiện lại", () => {
  const state = initialDashboardState();
  state.questions = [thread({
    questionItems: [{ id: "i1", text: "Câu một", status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }],
    activeQuestionId: "i1",
    activeQuestion: { id: "i1", text: "Câu một", status: "ACTIVE" }
  })];
  setQuestionItemStatusLocally(state, "q1", "i1", "ANSWERED", "2026-01-01T00:02:00Z");
  mergeQuestionUpdate(state, thread({
    questionItems: [{ id: "i1", text: "Câu một", status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:01:00Z" }],
    answered: false,
    activeQuestionId: "i1"
  }));
  assert.equal(state.questions[0].questionItems[0].status, "ANSWERED");
  assert.equal(state.questions[0].answered, true);
  assert.deepEqual(selectQuestions(state, { answered: false }), []);
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

test("LIKE socket update merge tổng TikTok mà không làm mất viewer hiện tại", () => {
  const state = initialDashboardState();
  mergeViewerUpdate(state, { currentViewers: 9, peakViewers: 12, totalLikes: 120 });
  mergeViewerUpdate(state, { totalLikes: 135, lastLikeUpdateAt: "2026-01-01T00:01:00Z" });
  assert.equal(state.analytics.viewers.current, 9);
  assert.equal(state.analytics.viewers.peak, 12);
  assert.equal(state.analytics.viewers.totalLikes, 135);
  assert.equal(state.analytics.viewers.lastLikeUpdateAt, "2026-01-01T00:01:00Z");
});

test("comment replay upsert theo event ID và comment giống nhau khác ID vẫn giữ riêng", () => {
  const state = initialDashboardState(); state.selectedSession = { id:"s1" };
  const first = { id:"m1", eventId:"m1", sessionId:"s1", text:"giống nhau", sequence:2 };
  mergeCommentUpdate(state, first); mergeCommentUpdate(state, { ...first, nickname:"Bản mới" });
  mergeCommentUpdate(state, { ...first, id:"m2", eventId:"m2", sequence:1 });
  assert.deepEqual(state.comments.map(item => item.id), ["m2", "m1"]);
  assert.equal(state.comments[1].nickname, "Bản mới");
});

test("realtime đến trước snapshot cũ không bị snapshot xóa hoặc resurrect terminal task", () => {
  let state = initialDashboardState(); state.selectedSession = { id:"s1" }; state.revision = 4;
  state.questions = [thread({ sessionId:"s1", questionItems:[{ id:"i1", text:"Câu", status:"ACTIVE", version:1, updatedAt:"2026-01-01T00:00:00Z" }] })];
  mergeCommentUpdate(state, { id:"m2", eventId:"m2", sessionId:"s1", sequence:2, revision:5 });
  setQuestionItemStatusLocally(state, "q1", "i1", "ANSWERED", "2026-01-01T00:02:00Z", "mutation-1");
  state = normalizeDashboardPayload({ revision:4, selectedSession:{id:"s1"}, comments:[], questions:[thread({sessionId:"s1",questionItems:[{id:"i1",text:"Câu",status:"ACTIVE",version:1,updatedAt:"2026-01-01T00:00:00Z"}]})] }, state);
  assert.deepEqual(state.comments.map(item => item.id), ["m2"]);
  assert.equal(state.questions[0].questionItems[0].status, "ANSWERED");
});

test("API response và realtime event cùng version kết thúc optimistic state idempotently", () => {
  const state=initialDashboardState();state.selectedSession={id:"s1"};state.questions=[thread({sessionId:"s1",questionItems:[{id:"i1",text:"Câu",status:"ACTIVE",version:1,updatedAt:"2026-01-01T00:00:00Z"}]})];
  setQuestionItemStatusLocally(state,"q1","i1","SKIPPED","2026-01-01T00:02:00Z","mutation-2");
  const payload=thread({sessionId:"s1",revision:2,questionItems:[{id:"i1",text:"Câu",status:"SKIPPED",version:2,updatedAt:"2026-01-01T00:02:00Z",lastMutationKey:"mutation-2"}]});
  mergeQuestionUpdate(state,payload);mergeQuestionUpdate(state,payload);
  assert.equal(state.questions[0].questionItems[0]._optimistic,false);
  assert.equal(state.questions[0].answered,true);
  assert.deepEqual([...pendingCommentIds(state)],[]);
});

test("rollback chỉ áp dụng cho mutation đang chờ, không ghi đè update authoritative", () => {
  const state=initialDashboardState();state.questions=[thread({questionItems:[{id:"i1",text:"Câu",commentIds:["m1"],status:"ACTIVE",version:1}]})];
  const before=snapshotQuestion(state,"q1");setQuestionItemStatusLocally(state,"q1","i1","ANSWERED","2026-01-01T00:02:00Z","old-key");
  mergeQuestionUpdate(state,thread({questionItems:[{id:"i1",text:"Câu",commentIds:["m1"],status:"ANSWERED",version:3,updatedAt:"2026-01-01T00:03:00Z",lastMutationKey:"server-key"}]}));
  assert.equal(restoreQuestion(state,before,"old-key"),false);
  assert.equal(state.questions[0].questionItems[0].status,"ANSWERED");
});

test("task terminal cùng version không hồi sinh dù event cũ có timestamp mới hơn", () => {
  const state = initialDashboardState();
  state.questions = [thread({ questionItems: [{ id: "i1", text: "Câu", status: "ANSWERED", version: 2, updatedAt: "2026-01-01T00:01:00Z" }] })];
  mergeQuestionUpdate(state, thread({ questionItems: [{ id: "i1", text: "Câu", status: "WAITING", version: 2, updatedAt: "2026-01-01T00:03:00Z" }] }));
  assert.equal(state.questions[0].questionItems[0].status, "ANSWERED");
  assert.deepEqual(selectQuestions(state, { answered: false }), []);
});
