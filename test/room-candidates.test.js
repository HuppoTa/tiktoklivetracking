import test from "node:test";
import assert from "node:assert/strict";
import { clearRoomCandidates, markRoomCandidate, roomCandidateStatus, upsertRoomCandidate } from "../src/room-candidates.js";

test("room candidates are metadata and do not duplicate a room", () => {
  const first = upsertRoomCandidate([], { roomId: "r1", source: "resolver" }, new Date("2026-01-01T00:00:00Z"));
  const second = upsertRoomCandidate(first, { roomId: "r1", status: "active" }, new Date("2026-01-01T00:01:00Z"));
  assert.equal(second.length, 1);
  assert.equal(roomCandidateStatus(second, "r1").status, "active");
  assert.equal(roomCandidateStatus(second, "r1").firstSeenAt, "2026-01-01T00:00:00.000Z");
});

test("failed refresh marks a candidate unavailable and clear removes only metadata", () => {
  const list = markRoomCandidate([{ roomId: "old", status: "selected" }], "old", "unavailable", "ROOM_ID_UNAVAILABLE");
  assert.equal(list[0].status, "unavailable");
  assert.equal(list[0].lastError, "ROOM_ID_UNAVAILABLE");
  assert.deepEqual(clearRoomCandidates(list), []);
});

test("clearing one target keeps other target candidates", () => {
  const first = upsertRoomCandidate([], { username: "account.a", roomId: "123456", status: "stale" });
  const second = upsertRoomCandidate(first, { username: "account.b", roomId: "123456", status: "new" });
  assert.equal(second.length, 2);
  assert.equal(roomCandidateStatus(second, "123456", "account.a").status, "stale");
  assert.equal(clearRoomCandidates(second, "account.a").length, 1);
  assert.equal(clearRoomCandidates(second, "account.a")[0].username, "account.b");
});
