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
