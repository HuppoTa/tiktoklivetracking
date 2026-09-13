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
  assert.equal(storage.store.schemaVersion, 9);
  assert.equal(storage.readiness().ready, true);
  storage.pendingTransactions = 3;
  assert.equal(storage.readiness().ready, true);
  assert.equal(storage.readiness().pendingTransactions, 3);
  assert.equal(calls.filter(([query]) => typeof query === "string").length, 2);
});

test("NeonStorage requires either a database URL or injected SQL client", () => {
  assert.throws(() => new NeonStorage({}), /DATABASE_URL_REQUIRED/);
});

test("NeonStorage coalesce save đồng thời để không giữ nhiều snapshot lớn", async () => {
  let block=false,writes=0;const releases=[];
  const sql=(...args)=>{const query=Array.isArray(args[0])?args[0].join(""):String(args[0]);if(query.includes("INSERT INTO app_state")){writes+=1;if(block)return new Promise(resolve=>{releases.push(()=>resolve([]))});}return[];};
  const storage=new NeonStorage({sql});await storage.load();block=true;writes=0;
  const first=storage.save(),second=storage.save(),third=storage.save();
  assert.equal(first,second);assert.equal(second,third);await Promise.resolve();assert.equal(writes,1);
  releases.shift()();await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,2);
  releases.shift()();await Promise.all([first,second,third]);assert.equal(writes,2);
});
