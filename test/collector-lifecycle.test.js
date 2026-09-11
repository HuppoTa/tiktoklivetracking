import test from "node:test";
import assert from "node:assert/strict";
import { StreamEndConfirmation } from "../src/collector-lifecycle.js";

test("stream end signal không kết thúc phiên trước khi được xác nhận", () => {
  const confirmation = new StreamEndConfirmation(2);
  confirmation.mark({ sessionId: "s1", roomId: "r1", action: 3 });
  assert.deepEqual(confirmation.observeNotLive("s1"), { pending: true, confirmed: false, count: 1 });
  assert.deepEqual(confirmation.observeNotLive("s1"), { pending: true, confirmed: true, count: 2 });
});

test("reconnect cùng room hủy stream end candidate", () => {
  const confirmation = new StreamEndConfirmation(2);
  confirmation.mark({ sessionId: "s1", roomId: "r1" });
  assert.equal(confirmation.observeConnected({ sessionId: "s1", roomId: "r1" }), "SAME_ROOM_RECOVERED");
  assert.deepEqual(confirmation.observeNotLive("s1"), { pending: false, confirmed: false, count: 0 });
});

test("not-live của session khác không xác nhận kết thúc", () => {
  const confirmation = new StreamEndConfirmation(2);
  confirmation.mark({ sessionId: "s1", roomId: "r1" });
  assert.deepEqual(confirmation.observeNotLive("s2"), { pending: false, confirmed: false, count: 0 });
});
