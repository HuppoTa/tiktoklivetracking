import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTikTokEvent } from "../src/tiktok-normalizer.js";
import { legacyEvent, protobufEvent } from "./fixtures/tiktok-events.js";

const now = new Date("2026-01-01T00:00:00.000Z");

test("event TikTok legacy được chuẩn hóa đúng", () => {
  const comment = normalizeTikTokEvent(legacyEvent, now);
  assert.deepEqual({ id: comment.id, userId: comment.userId, username: comment.username, avatar: comment.avatar }, {
    id: "legacy-message-1", userId: "100001", username: "demo.user", avatar: "https://example.test/a.png"
  });
  assert.equal(comment.question, true);
});

test("event protobuf v3 được chuẩn hóa đúng", () => {
  const comment = normalizeTikTokEvent(protobufEvent, now);
  assert.deepEqual({ id: comment.id, userId: comment.userId, username: comment.username, avatar: comment.avatar }, {
    id: "protobuf-message-1", userId: "100002", username: "sample.user", avatar: "https://example.test/b.png"
  });
  assert.equal(comment.normalizedText.length > 0, true);
});

test("normalizer lưu received/event timestamp và forced question", () => {
  const event = { ...protobufEvent, content: "nội dung mẫu", common: { ...protobufEvent.common, createTime: 1767225590 } };
  const comment = normalizeTikTokEvent(event, now, { forcedQuestion: true });
  assert.equal(comment.receivedAt, now.toISOString()); assert.ok(comment.eventTimestamp); assert.equal(comment.question, true); assert.deepEqual(comment.questionReasons, ["tiktok-question-event"]);
});

test("normalizer fallback ID ổn định khi replay và ưu tiên stable event ID", () => {
  const now=new Date("2026-01-01T00:00:10Z"),event={createTime:"1767225600",comment:"Nội dung",user:{id:"u1",uniqueId:"demo"}};
  assert.equal(normalizeTikTokEvent(event,now).id,normalizeTikTokEvent(event,new Date("2026-01-01T00:00:20Z")).id);
  assert.equal(normalizeTikTokEvent({...event,msgId:"event-2"},now).eventId,"event-2");
});

test("legacy connector flattened user fields giữ đúng nickname, userId và avatar", () => {
  const comment = normalizeTikTokEvent({ msgId: "flattened-1", createTime: "1767225600", comment: "Xin chào", userId: "42", uniqueId: "viewer.test", nickname: "Người xem", profilePictureUrl: "https://example.test/viewer.png" }, now);
  assert.equal(comment.id, "flattened-1");
  assert.equal(comment.userId, "42");
  assert.equal(comment.username, "viewer.test");
  assert.equal(comment.nickname, "Người xem");
  assert.equal(comment.avatar, "https://example.test/viewer.png");
});
