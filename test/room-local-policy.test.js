import test from "node:test";
import assert from "node:assert/strict";
import { localActionPolicy } from "../src/local-request-policy.js";

test("local modes block production room actions", () => {
  for (const mode of ["dev", "live"])
    for (const path of ["/api/room-candidates/clear", "/api/room-candidates/refresh", "/api/room-candidates/select"])
      assert.equal(localActionPolicy(mode, "POST", path), "LOCAL_GUARDED_ACTION_ONLY");
});
