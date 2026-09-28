import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 40700 + Math.floor(Math.random() * 200);
const base = `http://127.0.0.1:${port}`;
let child;
let dir;

async function waitReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("server did not become ready");
}

test.before(async () => {
  dir = await mkdtemp(join(tmpdir(), "hub-end-discard-"));
  const session = { id: "active-session", targetUsername: "fixture.user", roomId: "fixture-room", status: "live", startedAt: "2026-01-01T00:00:00.000Z", connectedAt: "2026-01-01T00:00:00.000Z", collectorConnectedAt: "2026-01-01T00:00:00.000Z", endedAt: null, endReason: null, connectionGeneration: 1, commentCount: 1, questionCount: 0, answeredCount: 0, nextQueueNumber: 1, nextCommentSequence: 2, viewerAnalytics: {}, welcomedUserIds: [] };
  await writeFile(join(dir, "store.json"), JSON.stringify({ schemaVersion: 9, activeSessionId: session.id, settings: { targetUsername: session.targetUsername, recentTargets: [session.targetUsername] }, sessions: [session], comments: [{ id: "comment-1", sessionId: session.id, targetUsername: session.targetUsername, roomId: session.roomId, userId: "fixture-user", username: "fixture.user", nickname: "Fixture", text: "fixture", normalizedText: "fixture", question: false, timestamp: "2026-01-01T00:00:01.000Z", receivedAt: "2026-01-01T00:00:01.000Z", sequence: 1 }], questionThreads: [], gifts: [{ id: "gift-1", sessionId: session.id, roomId: session.roomId, userId: "fixture-user", username: "fixture.user", nickname: "Fixture", giftId: "rose", giftName: "Rose", giftType: 0, repeatCount: 1, repeatEnd: true, diamondValueEach: 1, totalDiamonds: 1, valueKnown: true, receivedAt: "2026-01-01T00:00:02.000Z" }], giftAttention: [{ sessionId: session.id, userId: "fixture-user", giftEventCount: 1 }], giftSettings: {} }));
  child = spawn(process.execPath, ["server.js"], { cwd: process.cwd(), env: { ...process.env, DATA_DIR: dir, DISABLE_TIKTOK: "1", PORT: String(port), HOST: "127.0.0.1" }, stdio: "ignore" });
  await waitReady();
});

test.after(async () => {
  if (child?.exitCode === null) { const exited = new Promise(resolve => child.once("exit", resolve)); child.kill("SIGTERM"); await exited; }
  await rm(dir, { recursive: true, force: true });
});

test("end discards active runtime data and locks collection until explicit start", async () => {
  const ended = await fetch(`${base}/api/sessions/active-session/end`, { method: "POST" });
  assert.equal(ended.status, 200);
  assert.equal((await ended.json()).discarded, true);
  const saved = JSON.parse(await readFile(join(dir, "store.json"), "utf8"));
  assert.equal(saved.activeSessionId, null);
  assert.equal(saved.settings.collectionPaused, true);
  assert.equal(saved.sessions.length, 0);
  assert.equal(saved.comments.length, 0);
  assert.equal(saved.gifts.length, 0);
  assert.equal(saved.giftAttention.length, 0);
  const blocked = await fetch(`${base}/api/connect`, { method: "POST" });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error.code, "COLLECTION_STOPPED");
  assert.equal((await fetch(`${base}/api/questions/manual`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "active-session", nickname: "Fixture", text: "fixture" }) })).status, 409);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).settings.collectionPaused, true);
  const started = await fetch(`${base}/api/sessions/start`, { method: "POST" });
  assert.equal(started.status, 202);
  const restarted = JSON.parse(await readFile(join(dir, "store.json"), "utf8"));
  assert.equal(restarted.settings.collectionPaused, false);
  assert.equal(restarted.sessions.length, 1);
  assert.notEqual(restarted.sessions[0].id, "active-session");
});
