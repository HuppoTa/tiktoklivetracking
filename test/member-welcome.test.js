import test from "node:test";
import assert from "node:assert/strict";
import { buildWelcomeMemberPayload } from "../src/member-welcome.js";

const session = { id: "s1", roomId: "r1", connectionGeneration: 4 };
const member = (id, nickname = "Minh Anh", uniqueId = "minhanh") => ({ user: { id, nickname, uniqueId } });

test("member hợp lệ tạo payload transient theo userId", () => {
  const result = buildWelcomeMemberPayload({ data: member("u1"), session, welcomedUserIds: [], threads: [{ sessionId:"s1",userId:"u1" }], gifts: [{ sessionId:"s1",userId:"u1" }], now: new Date("2026-01-01T00:00:00Z") });
  assert.equal(result.reason, null); assert.deepEqual(result.payload, { sessionId:"s1",roomId:"r1",connectionGeneration:4,userId:"u1",nickname:"Minh Anh",uniqueId:"minhanh",displayName:"Minh Anh",joinedAt:"2026-01-01T00:00:00.000Z",hasQuestion:true,hasGift:true });
});
test("same session user được dedupe, session mới được welcome lại", () => {
  assert.equal(buildWelcomeMemberPayload({ data: member("u1"), session, welcomedUserIds:["u1"] }).reason, "DUPLICATE_MEMBER_IN_SESSION");
  assert.equal(buildWelcomeMemberPayload({ data: member("u1"), session:{...session,id:"s2"}, welcomedUserIds:[] }).payload.sessionId, "s2");
});
test("hai nickname giống nhau vẫn là hai identity và thiếu userId bị bỏ qua", () => {
  assert.notEqual(buildWelcomeMemberPayload({data:member("u1","Trùng"),session}).payload.userId, buildWelcomeMemberPayload({data:member("u2","Trùng"),session}).payload.userId);
  assert.equal(buildWelcomeMemberPayload({data:{user:{nickname:"Trùng",uniqueId:"name"}},session}).reason,"MISSING_MEMBER_IDENTITY");
});
