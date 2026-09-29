import test from "node:test";
import assert from "node:assert/strict";
import { liveIndicator } from "../public/live-indicator.js";

test("only verified TikTok transport activity receives the LIVE label", () => {
  assert.deepEqual(
    liveIndicator({ state: "live", connectionState: "LIVE_IDLE" }),
    { className: "verifying", label: "ĐANG XÁC MINH LIVE" },
  );
  assert.deepEqual(
    liveIndicator({ state: "live", connectionState: "LIVE_HEALTHY" }),
    { className: "live", label: "ĐANG LIVE" },
  );
});

test("non-live and connecting states keep their existing meanings", () => {
  assert.deepEqual(liveIndicator({ state: "connecting" }), { className: "connecting", label: "KẾT NỐI" });
  assert.deepEqual(liveIndicator({ state: "offline" }), { className: "offline", label: "OFFLINE" });
});
