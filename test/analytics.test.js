import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalytics, calculateQuestionAnalytics, extractTotalLikeCount, extractViewerCount, ViewerAnalytics } from "../src/analytics.js";

test("ROOM_USER legacy viewerCount và protobuf v3 total được map đúng", () => {
  assert.equal(extractViewerCount({ viewerCount: 12 }), 12);
  assert.equal(extractViewerCount({ total: "15", totalUser: "900" }), 15);
});

test("ROOM_USER cập nhật current và peak không giảm", () => {
  const analytics = new ViewerAnalytics();
  analytics.observeRoomUser({ total: "20" }, new Date("2026-01-01T00:00:00Z"));
  analytics.observeRoomUser({ total: "11" }, new Date("2026-01-01T00:00:01Z"));
  assert.equal(analytics.state.currentViewers, 11);
  assert.equal(analytics.state.peakViewers, 20);
});

test("viewer event thiếu field không ghi 0 đè dữ liệu", () => {
  const analytics = new ViewerAnalytics({ currentViewers: 8, peakViewers: 10 });
  const result = analytics.observeRoomUser({ totalUser: "500" });
  assert.equal(result.updated, false);
  assert.equal(analytics.state.currentViewers, 8);
  assert.equal(analytics.state.peakViewers, 10);
});

test("LIKE chỉ dùng totalLikeCount TikTok, giữ tổng không giảm và không tự cộng likeCount", () => {
  const analytics = new ViewerAnalytics();
  assert.equal(extractTotalLikeCount({ likeCount: 99 }), null);
  assert.equal(extractTotalLikeCount({ totalLikeCount: "120" }), 120);
  assert.equal(extractTotalLikeCount({ count: 5, total: "125" }), 125);
  assert.equal(analytics.observeLike({ likeCount: 5, totalLikeCount: 120 }, new Date("2026-01-01T00:00:00Z")).updated, true);
  assert.equal(analytics.observeLike({ total: 125 }, new Date("2026-01-01T00:00:00Z")).delta, 5);
  assert.equal(analytics.observeLike({ likeCount: 5 }, new Date("2026-01-01T00:00:01Z")).updated, false);
  assert.equal(analytics.observeLike({ totalLikeCount: 119 }, new Date("2026-01-01T00:00:02Z")).stale, true);
  assert.equal(analytics.payload().totalLikes, 125);
  assert.equal(analytics.payload().totalLikesSource, "like_event");
});


test("viewer sample chỉ thêm khi count đổi hoặc qua 15 giây", () => {
  const analytics = new ViewerAnalytics();
  assert.equal(analytics.observeRoomUser({ total: "5" }, new Date("2026-01-01T00:00:00Z")).sampled, true);
  assert.equal(analytics.observeRoomUser({ total: "5" }, new Date("2026-01-01T00:00:05Z")).sampled, false);
  assert.equal(analytics.observeRoomUser({ total: "6" }, new Date("2026-01-01T00:00:06Z")).sampled, true);
  assert.equal(analytics.observeRoomUser({ total: "6" }, new Date("2026-01-01T00:00:22Z")).sampled, true);
  assert.equal(analytics.state.viewerSamples.length, 3);
});

test("MEMBER tăng event, dedupe message và unique user", () => {
  const analytics = new ViewerAnalytics();
  analytics.observeMember({ common: { msgId: "join-1" }, user: { id: "u1" } });
  analytics.observeMember({ common: { msgId: "join-2" }, user: { id: "u1" } });
  analytics.observeMember({ common: { msgId: "join-2" }, user: { id: "u1" } });
  analytics.observeMember({ common: { msgId: "join-3" }, user: { id: "u2" } });
  assert.equal(analytics.state.memberJoinEvents, 3);
  assert.equal(analytics.payload().uniqueJoinedUsers, 2);
});

test("analytics rỗng không chia cho 0 và không giả viewer", () => {
  assert.deepEqual(calculateQuestionAnalytics([]), { unanswered: 0, answered: 0, total: 0, completionRate: 0, averageWaitSeconds: 0 });
  const response = buildAnalytics([], {});
  assert.equal(response.viewers.current, null);
  assert.equal(response.viewers.peak, null);
  assert.equal(response.viewers.lastUpdatedAt, null);
});

test("completion rate và average wait được tính đúng, bỏ answeredAt thiếu", () => {
  const threads = [
    { answered: true, createdAt: "2026-01-01T00:00:00Z", answeredAt: "2026-01-01T00:02:00Z" },
    { answered: true, createdAt: "2026-01-01T00:00:00Z", answeredAt: null },
    { answered: false, createdAt: "2026-01-01T00:00:00Z", answeredAt: null }
  ];
  assert.deepEqual(calculateQuestionAnalytics(threads), { unanswered: 1, answered: 2, total: 3, completionRate: 66.67, averageWaitSeconds: 120 });
});

test("restart cùng room giữ summary, room mới reset viewer session", () => {
  const first = new ViewerAnalytics({ roomId: "room-1", currentViewers: 7, peakViewers: 12, memberJoinEvents: 4, joinedUserIds: ["u1"] });
  assert.equal(first.startSession("room-1"), false);
  assert.equal(first.state.peakViewers, 12);
  assert.equal(first.startSession("room-2"), true);
  assert.equal(first.state.currentViewers, null);
  assert.equal(first.state.memberJoinEvents, 0);
});
