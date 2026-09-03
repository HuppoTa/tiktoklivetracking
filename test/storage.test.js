import test from "node:test";
import assert from "node:assert/strict";
import * as realFs from "node:fs/promises";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStorage, LEGACY_SESSION_ID } from "../src/storage.js";
import { QuestionService } from "../src/question-service.js";

const legacy = [{ id: "old-1", timestamp: "2025-01-01T00:00:00.000Z", user: "old.user", nickname: "Người cũ", avatar: "", text: "Công việc sắp tới thế nào?", question: true, groupId: "old-group" }];

async function paths() {
  const dir = await mkdtemp(join(tmpdir(), "live-hub-test-"));
  return { storeFile: join(dir, "store.json"), legacyFile: join(dir, "comments.json") };
}

test("load tự phục hồi khi store.json corrupt và có backup hợp lệ", async () => {
  const files = await paths();
  const valid = { schemaVersion: 6, comments: legacy, questionThreads: [], sessions: [], settings: { targetUsername: "account.a" } };
  const backup = join(files.storeFile + ".schema-v6.backup.json");
  await writeFile(backup, JSON.stringify(valid));
  await writeFile(files.storeFile, "{not valid json");
  const storage = new JsonStorage(files);
  const store = await storage.load();
  assert.equal(store.comments.length, 1);
  assert.equal(store.questionThreads.length, 1);
  assert.equal(JSON.parse(await readFile(files.storeFile, "utf8")).schemaVersion, 7);
});

test("migration không mất comment, có backup và chạy lần hai không tạo trùng", async () => {
  const files = await paths();
  await writeFile(files.legacyFile, JSON.stringify(legacy));
  const first = new JsonStorage(files);
  await first.load();
  assert.equal(first.store.schemaVersion, 7);
  assert.equal(first.store.comments.length, 1);
  assert.equal(first.store.questionThreads.length, 1);
  assert.equal(JSON.parse(await readFile(`${files.legacyFile}.v1.backup.json`, "utf8")).length, 1);
  const second = new JsonStorage(files);
  await second.load();
  assert.equal(second.store.comments.length, 1);
  assert.equal(second.store.questionThreads.length, 1);
});

test("record thiếu session migrate vào legacy session và idempotent", async () => {
  const files = await paths(); await writeFile(files.storeFile, JSON.stringify({ schemaVersion: 4, comments: legacy, questionThreads: [], sessions: [], settings: { targetUsername: "account.a" } }));
  const first = new JsonStorage(files); await first.load();
  assert.equal(first.store.comments[0].sessionId, LEGACY_SESSION_ID); assert.equal(first.store.sessions.find(item => item.id === LEGACY_SESSION_ID).status, "ended"); assert.equal(first.store.activeSessionId, null);
  const second = new JsonStorage(files); await second.load(); assert.equal(second.store.comments.length, 1); assert.equal(second.store.sessions.filter(item => item.id === LEGACY_SESSION_ID).length, 1);
});

test("backup session ghi trước với đúng record", async () => {
  const files = await paths(); const storage = new JsonStorage(files); await storage.load();
  storage.store.sessions.push({ id: "s-history", targetUsername: "account.a", status: "ended" }); storage.store.comments.push({ id: "m1", sessionId: "s-history" }); storage.store.questionThreads.push({ id: "q1", sessionId: "s-history" });
  const backup = await storage.backupSession("s-history"); const parsed = JSON.parse(await readFile(backup.path, "utf8"));
  assert.equal(backup.commentCount, 1); assert.equal(parsed.questionThreads.length, 1);
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

test("save queue phục hồi sau một lần write fail và không corrupt primary", async () => {
  const files = await paths(); const base = new JsonStorage(files); await base.load(); const committed = await readFile(files.storeFile, "utf8");
  let failed = false, armed = false; const fs = { ...realFs, async writeFile(...args) { if (armed && !failed) { failed = true; throw new Error("INJECT_WRITE_FAIL"); } return realFs.writeFile(...args); } };
  const storage = new JsonStorage({ ...files, fs }); await storage.load(); armed = true; storage.store.settings.marker = "draft";
  await assert.rejects(storage.save(), /INJECT_WRITE_FAIL/); assert.equal(await readFile(files.storeFile, "utf8"), committed);
  await storage.save(); assert.equal(JSON.parse(await readFile(files.storeFile, "utf8")).settings.marker, "draft"); assert.equal(storage.health.storageHealthy, true); assert.equal(storage.health.consecutiveSaveFailures, 0);
});

test("save queue phục hồi sau rename fail và transaction fail không publish draft", async () => {
  const files = await paths(); const initial = new JsonStorage(files); await initial.load(); let failed = false, armed = false;
  const fs = { ...realFs, async rename(...args) { if (armed && !failed) { failed = true; throw new Error("INJECT_RENAME_FAIL"); } return realFs.rename(...args); } };
  const storage = new JsonStorage({ ...files, fs }); await storage.load(); armed = true;
  await assert.rejects(storage.mutate(draft => { draft.settings.marker = "should-not-publish"; }), /INJECT_RENAME_FAIL/);
  assert.equal(storage.store.settings.marker, undefined); await storage.mutate(draft => { draft.settings.marker = "committed"; });
  assert.equal(storage.store.settings.marker, "committed"); assert.equal(JSON.parse(await readFile(files.storeFile, "utf8")).settings.marker, "committed");
});
