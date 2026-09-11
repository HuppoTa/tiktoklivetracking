import test from "node:test";
import assert from "node:assert/strict";
import { NeonStorage } from "../src/neon-storage.js";

test("NeonStorage initializes schema and persists the store through the SQL client", async () => {
  const calls = [];
  const sql = (...args) => {
    calls.push(args);
    return [];
  };
  const storage = new NeonStorage({ sql });

  await storage.load();

  assert.equal(calls.length, 4);
  assert.equal(storage.store.schemaVersion, 8);
  assert.equal(storage.readiness().ready, true);
  assert.equal(calls.filter(([query]) => typeof query === "string").length, 2);
});

test("NeonStorage requires either a database URL or injected SQL client", () => {
  assert.throws(() => new NeonStorage({}), /DATABASE_URL_REQUIRED/);
});
