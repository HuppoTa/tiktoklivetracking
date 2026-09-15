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

  assert.equal(calls.length, 7);
  assert.equal(storage.store.schemaVersion, 9);
  assert.equal(storage.readiness().ready, true);
  storage.pendingTransactions = 3;
  assert.equal(storage.readiness().ready, true);
  assert.equal(storage.readiness().pendingTransactions, 3);
  assert.equal(calls.filter(([query]) => typeof query === "string").length, 4);
});

test("NeonStorage requires either a database URL or injected SQL client", () => {
  assert.throws(() => new NeonStorage({}), /DATABASE_URL_REQUIRED/);
});

test("normalized load backs up and durably repairs duplicate queue rows only", async () => {
  const metadata = { schemaVersion: 9, storageMode: "normalized-v1", stateRevision: 1, activeSessionId: null, settings: { targetUsername: "fixture.user", recentTargets: ["fixture.user"] }, giftSettings: {} };
  const session = { id: "s1", targetUsername: "fixture.user", status: "ended", nextQueueNumber: 4 };
  const threads = [
    { id: "q1", sessionId: "s1", userId: "u1", queueNumber: 1, commentIds: [], createdAt: "2026-01-01T00:00:00Z" },
    { id: "q2", sessionId: "s1", userId: "u2", queueNumber: 1, commentIds: [], createdAt: "2026-01-01T00:00:01Z" },
  ];
  const rows = [{ kind: "session", record_id: "s1", session_id: "s1", payload: session }, ...threads.map(thread => ({ kind: "question_thread", record_id: JSON.stringify(["s1", thread.id]), session_id: "s1", payload: thread }))];
  const calls = [];
  const sql = (...args) => { const query = Array.isArray(args[0]) ? args[0].join("?") : String(args[0]); calls.push({ query, values: args.slice(1) }); if (query.includes("SELECT state")) return [{ state: metadata }]; if (query.includes("FROM app_records")) return rows; return []; };
  const storage = new NeonStorage({ sql });
  await storage.load();
  assert.deepEqual(storage.store.questionThreads.map(thread => thread.queueNumber), [1, 4]);
  assert.ok(calls.some(call => call.query.includes("INSERT INTO session_backups")));
  const write = calls.find(call => call.query.includes("INSERT INTO app_records"));
  assert.ok(write);
  const changed = JSON.parse(write.values[0]);
  assert.equal(changed.find(record => record.kind === "question_thread")?.payload.queueNumber, 4);
  assert.deepEqual(changed.filter(record => record.kind === "question_thread").map(record => record.payload.id), ["q2"]);
});

test("NeonStorage coalesce save đồng thời để không giữ nhiều snapshot lớn", async () => {
  let block=false,writes=0;const releases=[];
  const sql=(...args)=>{const query=Array.isArray(args[0])?args[0].join(""):String(args[0]);if(query.includes("INSERT INTO app_state")){writes+=1;if(block)return new Promise(resolve=>{releases.push(()=>resolve([]))});}return[];};
  const storage=new NeonStorage({sql});await storage.load();block=true;writes=0;
  storage.store.settings.targetUsername="changed.user";
  const first=storage.save(),second=storage.save(),third=storage.save();
  assert.equal(first,second);assert.equal(second,third);await Promise.resolve();assert.equal(writes,1);
  releases.shift()();await Promise.all([first,second,third]);assert.equal(writes,1);
});

test("NeonStorage migrates a legacy snapshot to normalized records without losing data", async () => {
  const legacy = {
    schemaVersion: 9,
    stateRevision: 4,
    activeSessionId: null,
    settings: { targetUsername: "fixture.user", recentTargets: ["fixture.user"] },
    sessions: [{ id:"s1", targetUsername:"fixture.user", status:"ended", startedAt:"2026-01-01T00:00:00.000Z", endedAt:"2026-01-01T01:00:00.000Z", welcomedUserIds:["u1"], viewerAnalytics:{ joinedUserIds:["u1"], memberMessageIds:["m1"], viewerSamples:[{timestamp:"2026-01-01T00:00:10.000Z",viewerCount:3}] } }],
    comments: [{ id:"c1", sessionId:"s1", username:"asker", userId:"u1", text:"xin xem cong viec", receivedAt:"2026-01-01T00:00:01.000Z" }],
    questionThreads: [], gifts: [], giftAttention: [], giftSettings: {},
  };
  const calls = [];
  const sql = (...args) => {
    const query = Array.isArray(args[0]) ? args[0].join("?") : String(args[0]);
    calls.push({ query, values: args.slice(1) });
    if (query.includes("SELECT state")) return [{ state: legacy }];
    if (query.includes("FROM app_records")) return [];
    return [];
  };
  const storage = new NeonStorage({ sql });
  await storage.load();
  assert.equal(storage.store.comments[0].id, "c1");
  assert.deepEqual(storage.store.sessions[0].welcomedUserIds, ["u1"]);
  const normalizedWrite = calls.find(call => call.query.includes("INSERT INTO app_records"));
  assert.ok(normalizedWrite);
  assert.match(JSON.stringify(normalizedWrite.values), /welcome_user/);
  assert.doesNotMatch(JSON.stringify(normalizedWrite.values.at(-1)), /"comments"/);
});

test("NeonStorage saves only changed records after normalization", async () => {
  const calls = [];
  const sql = (...args) => {
    const query = Array.isArray(args[0]) ? args[0].join("?") : String(args[0]);
    calls.push({ query, values: args.slice(1) });
    if (query.includes("SELECT state")) return [];
    if (query.includes("FROM app_records")) return [];
    return [];
  };
  const storage = new NeonStorage({ sql });
  await storage.load();
  storage.store.comments.push({ id:"old", sessionId:"s1", username:"a", userId:"u1", text:"historical-marker", receivedAt:"2026-01-01T00:00:00.000Z" });
  storage.store.sessions.push({ id:"s1", targetUsername:"fixture.user", status:"ended", startedAt:"2026-01-01T00:00:00.000Z", endedAt:"2026-01-01T01:00:00.000Z", welcomedUserIds:[], viewerAnalytics:{} });
  await storage.save();
  calls.length = 0;
  storage.store.sessions[0].commentCount = 1;
  await storage.save();
  const write = calls.find(call => call.query.includes("INSERT INTO app_records"));
  assert.ok(write);
  assert.doesNotMatch(JSON.stringify(write.values), /historical-marker/);
});

test("NeonStorage reconstructs normalized session arrays and records after restart", async () => {
  const metadata={schemaVersion:9,storageMode:"normalized-v1",stateRevision:7,activeSessionId:null,settings:{targetUsername:"fixture.user",recentTargets:["fixture.user"]},giftSettings:{}};
  const session={id:"s1",targetUsername:"fixture.user",status:"ended",startedAt:"2026-01-01T00:00:00.000Z",endedAt:"2026-01-01T01:00:00.000Z",welcomedUserIds:[],viewerAnalytics:{joinedUserIds:[],memberMessageIds:[],viewerSamples:[]}};
  const rows=[
    {kind:"session",record_id:"s1",session_id:"s1",payload:session},
    {kind:"welcome_user",record_id:'["s1","u1"]',session_id:"s1",payload:{userId:"u1"}},
    {kind:"joined_user",record_id:'["s1","u1"]',session_id:"s1",payload:{userId:"u1"}},
    {kind:"member_message",record_id:'["s1","m1"]',session_id:"s1",payload:{messageId:"m1"}},
    {kind:"viewer_sample",record_id:'["s1","2026"]',session_id:"s1",payload:{timestamp:"2026-01-01T00:00:10.000Z",viewerCount:4}},
    {kind:"comment",record_id:'["s1","c1"]',session_id:"s1",payload:{id:"c1",sessionId:"s1",username:"asker",userId:"u1",text:"xin xem cong viec",receivedAt:"2026-01-01T00:00:01.000Z",sequence:1}},
  ];
  const sql=(...args)=>{const query=Array.isArray(args[0])?args[0].join("?"):String(args[0]);if(query.includes("SELECT state"))return[{state:metadata}];if(query.includes("FROM app_records"))return rows;return[];};
  const storage=new NeonStorage({sql});await storage.load();
  assert.equal(storage.store.comments[0].id,"c1");
  assert.deepEqual(storage.store.sessions[0].welcomedUserIds,["u1"]);
  assert.deepEqual(storage.store.sessions[0].viewerAnalytics.joinedUserIds,["u1"]);
  assert.deepEqual(storage.store.sessions[0].viewerAnalytics.memberMessageIds,["m1"]);
  assert.equal(storage.store.sessions[0].viewerAnalytics.viewerSamples[0].viewerCount,4);
});

test("legacy rollback migration removes normalized rows absent from authoritative snapshot", async()=>{
  let write;
  const legacy={schemaVersion:9,stateRevision:1,settings:{targetUsername:"fixture.user",recentTargets:["fixture.user"]},sessions:[],comments:[],questionThreads:[],gifts:[],giftAttention:[],giftSettings:{}};
  const sql=(...args)=>{const query=Array.isArray(args[0])?args[0].join("?"):String(args[0]);if(query.includes("INSERT INTO app_records")){write=args.slice(1);return[]}if(query.includes("SELECT state"))return[{state:legacy}];if(query.includes("FROM app_records"))return[{kind:"comment",record_id:'["old","stale"]',session_id:"old",payload:{id:"stale",sessionId:"old"}}];return[];};
  await new NeonStorage({sql}).load();
  assert.match(String(write[1]),/stale/);
});
