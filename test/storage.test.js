import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStorage } from "../src/storage.js";
import { QuestionService } from "../src/question-service.js";

const legacy = [{ id: "old-1", timestamp: "2025-01-01T00:00:00.000Z", user: "old.user", nickname: "Người cũ", avatar: "", text: "Công việc sắp tới thế nào?", question: true, groupId: "old-group" }];

async function paths() {
  const dir = await mkdtemp(join(tmpdir(), "live-hub-test-"));
  return { storeFile: join(dir, "store.json"), legacyFile: join(dir, "comments.json") };
}

test("migration không mất comment, có backup và chạy lần hai không tạo trùng", async () => {
  const files = await paths();
  await writeFile(files.legacyFile, JSON.stringify(legacy));
  const first = new JsonStorage(files);
  await first.load();
  assert.equal(first.store.schemaVersion, 4);
  assert.equal(first.store.comments.length, 1);
  assert.equal(first.store.questionThreads.length, 1);
  assert.equal(JSON.parse(await readFile(`${files.legacyFile}.v1.backup.json`, "utf8")).length, 1);
  const second = new JsonStorage(files);
  await second.load();
  assert.equal(second.store.comments.length, 1);
  assert.equal(second.store.questionThreads.length, 1);
});

test("trạng thái answered còn sau khi load storage mới", async () => {
  const files = await paths();
  await writeFile(files.legacyFile, JSON.stringify(legacy));
  const first = new JsonStorage(files);
  await first.load();
  const service = new QuestionService(first.store);
  service.setThreadAnswered(first.store.questionThreads[0].id, true, new Date("2026-01-01T00:00:00Z"));
  await first.save();
  const second = new JsonStorage(files);
  await second.load();
  assert.equal(second.store.questionThreads[0].answered, true);
  assert.equal(second.store.questionThreads[0].answeredAt, "2026-01-01T00:00:00.000Z");
});

test("viewer summary còn sau khi restart storage", async () => {
  const files = await paths();
  const first = new JsonStorage(files);
  await first.load();
  const session = first.store.sessions[0] || { id: "session-demo", targetUsername: "kathyuyen.ta", startedAt: "2026-01-01T00:00:00Z", endedAt: null, status: "live" };
  if (!first.store.sessions.length) { first.store.sessions.push(session); first.store.activeSessionId = session.id; }
  session.viewerAnalytics = { roomId: "room-demo", currentViewers: 7, peakViewers: 9, viewerSamples: [{ timestamp: "2026-01-01T00:00:00Z", viewerCount: 7 }], memberJoinEvents: 2, joinedUserIds: ["u1"], memberMessageIds: ["join-1"], lastViewerUpdateAt: "2026-01-01T00:00:00Z" };
  await first.save();
  const second = new JsonStorage(files);
  await second.load();
  const restored = second.store.sessions.find(item => item.id === session.id).viewerAnalytics;
  assert.equal(restored.currentViewers, 7);
  assert.equal(restored.peakViewers, 9);
  assert.deepEqual(restored.joinedUserIds, ["u1"]);
});
