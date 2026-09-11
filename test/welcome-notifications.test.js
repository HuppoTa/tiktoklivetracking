import test from "node:test";
import assert from "node:assert/strict";
import { addWelcome, createWelcomeStore, takeWelcomeBurst, WELCOME_BUFFER_LIMIT } from "../public/welcome-notifications.js";
const item = (id, name = `User ${id}`) => ({ sessionId:"s1",userId:id,displayName:name });
test("welcome FIFO, dedupe và fallback payload hợp lệ", () => { const store=createWelcomeStore(); assert.equal(addWelcome(store,item("u1"),1),true);assert.equal(addWelcome(store,item("u1"),2),false);assert.equal(addWelcome(store,item("u2"),2),true);assert.equal(takeWelcomeBurst(store).primary.userId,"u1"); });
test("join burst được group và buffer có limit", () => { const store=createWelcomeStore(); for(let i=0;i<5;i++)addWelcome(store,item(`u${i}`),i*100); const burst=takeWelcomeBurst(store); assert.deepEqual(burst.names,["User u0","User u1","User u2"]);assert.equal(burst.extraCount,2); for(let i=0;i<WELCOME_BUFFER_LIMIT+3;i++)addWelcome(store,item(`x${i}`),3000+i); assert.ok(store.queue.length<=WELCOME_BUFFER_LIMIT);assert.ok(store.dropped>0); });
