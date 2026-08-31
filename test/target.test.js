import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTargetInput, recentTargets, resolveTarget } from "../src/target.js";
import { normalizeTargetInput as normalizeBrowserInput } from "../public/target-input.js";

for (const normalize of [normalizeTargetInput, normalizeBrowserInput]) {
  test(`normalize @username (${normalize === normalizeTargetInput ? "server" : "browser"})`, () => assert.equal(normalize("  @Kathyuyen.TA "), "kathyuyen.ta"));
  test(`normalize TikTok LIVE URL (${normalize === normalizeTargetInput ? "server" : "browser"})`, () => assert.equal(normalize("https://www.tiktok.com/@Demo_User/live"), "demo_user"));
  test(`reject invalid/script/external URL (${normalize === normalizeTargetInput ? "server" : "browser"})`, () => {
    assert.equal(normalize("bad-user"), null); assert.equal(normalize("<script>alert(1)</script>"), null); assert.equal(normalize("https://example.com/@safe/live"), null);
  });
}

test("environment target ưu tiên stored và default", () => {
  assert.equal(resolveTarget("env.user", "stored.user"), "env.user");
  assert.equal(resolveTarget("", "stored.user"), "stored.user");
  assert.equal(resolveTarget("", ""), "kathyuyen.ta");
});

test("recent targets unique, mới nhất đầu và tối đa 5", () => {
  let recent = ["a", "b", "c", "d", "e"];
  recent = recentTargets(recent, "c"); assert.deepEqual(recent, ["c", "a", "b", "d", "e"]);
  recent = recentTargets(recent, "f"); assert.deepEqual(recent, ["f", "c", "a", "b", "d"]);
});
