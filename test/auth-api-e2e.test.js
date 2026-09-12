import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { io as clientIo } from "socket.io-client";
import { hashPassword } from "../src/auth-service.js";

const port=39500+Math.floor(Math.random()*300),base=`http://127.0.0.1:${port}`,agent="auth-e2e-browser";let child;
const headers=token=>({"user-agent":agent,...(token?{authorization:`Bearer ${token}`}:{})});
async function waitReady(){for(let i=0;i<60;i++){try{if((await fetch(`${base}/api/health`)).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error("server timeout")}
async function login(){const response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{...headers(),"content-type":"application/json"},body:JSON.stringify({username:"kathy",password:"fixture-password"})});assert.equal(response.status,200);return response.json()}

test.before(async()=>{const dir=await mkdtemp(join(tmpdir(),"hub-auth-api-")),passwordHash=await hashPassword("fixture-password");child=spawn(process.execPath,["server.js"],{cwd:process.cwd(),env:{...process.env,DATA_DIR:dir,DISABLE_TIKTOK:"1",PORT:String(port),HOST:"127.0.0.1",AUTH_USERNAME:"kathy",AUTH_PASSWORD_HASH:passwordHash},stdio:"ignore"});await waitReady()});
test.after(()=>child?.kill("SIGTERM"));

test("API và Socket.IO yêu cầu login, login thứ hai thu hồi session đầu", async()=>{
  assert.equal((await fetch(`${base}/api/state`,{headers:headers()})).status,401);
  const unauthSocket=clientIo(base,{auth:{token:""},extraHeaders:{"user-agent":agent},reconnection:false});
  const socketError=await new Promise(resolve=>unauthSocket.on("connect_error",resolve));assert.match(socketError.message,/UNAUTHORIZED/);unauthSocket.close();
  const first=await login();assert.equal((await fetch(`${base}/api/auth/session`,{headers:headers(first.token)})).status,200);
  const socket=clientIo(base,{auth:{token:first.token},extraHeaders:{"user-agent":agent},reconnection:false});await new Promise((resolve,reject)=>{socket.once("connect",resolve);socket.once("connect_error",reject)});socket.close();
  const second=await login();assert.equal((await fetch(`${base}/api/auth/session`,{headers:headers(first.token)})).status,401);assert.equal((await fetch(`${base}/api/state`,{headers:headers(second.token)})).status,200);
  assert.equal((await fetch(`${base}/api/auth/logout`,{method:"POST",headers:headers(second.token)})).status,204);assert.equal((await fetch(`${base}/api/state`,{headers:headers(second.token)})).status,401);
});
