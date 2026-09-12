import test from "node:test";
import assert from "node:assert/strict";
import { AuthService, hashPassword, LoginRateLimiter, MemorySessionRepository } from "../src/auth-service.js";

test("login mới thu hồi session cũ và session bị ràng buộc user-agent", async () => {
  let now = Date.parse("2026-01-01T00:00:00Z");
  const auth = new AuthService({ username:"kathy",passwordHash:await hashPassword("fixture-password"),repository:new MemorySessionRepository(),ttlMs:60_000,now:()=>now });
  await auth.initialize();
  assert.equal(await auth.login({username:"kathy",password:"wrong",userAgent:"browser-a"}),null);
  const first=await auth.login({username:"kathy",password:"fixture-password",userAgent:"browser-a"});
  assert.equal((await auth.authenticate(first.token,"browser-a")).username,"kathy");
  assert.equal(await auth.authenticate(first.token,"browser-b"),null);
  const second=await auth.login({username:"kathy",password:"fixture-password",userAgent:"browser-b"});
  assert.equal(await auth.authenticate(first.token,"browser-a"),null);
  assert.equal((await auth.authenticate(second.token,"browser-b")).username,"kathy");
  now += 60_001;
  assert.equal(await auth.authenticate(second.token,"browser-b"),null);
});

test("logout thu hồi token và rate limiter tách username/IP", async () => {
  let now=1_000;const limiter=new LoginRateLimiter({maxAttempts:2,windowMs:10_000,now:()=>now});
  assert.equal(limiter.check("ip-a","kathy").allowed,true);limiter.fail("ip-a","kathy");limiter.fail("ip-a","kathy");
  assert.equal(limiter.check("ip-a","kathy").allowed,false);assert.equal(limiter.check("ip-b","kathy").allowed,true);
  now+=10_001;assert.equal(limiter.check("ip-a","kathy").allowed,true);
  const auth=new AuthService({username:"kathy",passwordHash:await hashPassword("fixture-password"),repository:new MemorySessionRepository()});
  const session=await auth.login({username:"kathy",password:"fixture-password",userAgent:"browser"});await auth.logout(session.token);
  assert.equal(await auth.authenticate(session.token,"browser"),null);
});
