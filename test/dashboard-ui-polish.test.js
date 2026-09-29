import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../public/style.css", import.meta.url), "utf8");

test("ended or empty dashboard gives a clear next step instead of a blank session panel", () => {
  assert.match(app, /class="sessionEmpty"/);
  assert.match(app, /Bắt đầu phiên mới để bắt đầu thu dữ liệu/);
});

test("manual Room ID fallback is a readable, responsive action card", () => {
  assert.match(html, /class="manualRoomIntro"/);
  assert.match(html, /class="manualRoomControls"/);
  assert.match(html, /Nhập Room ID thủ công/);
  assert.match(css, /\.manualRoomForm\s*\{/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.manualRoomControls/);
});

test("dashboard visual system has a soft modern hierarchy without changing UI controls", () => {
  assert.match(css, /--plum:/);
  assert.match(css, /--rose:/);
  assert.match(css, /\.hero::before/);
  assert.match(css, /\.panel\s*\{/);
  assert.match(css, /\.loginCard::before/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /button:focus-visible/);
});

test("Room ID tools are collapsed by default and retain their existing controls when opened", () => {
  assert.match(html, /<details id="roomPanel" class="roomPanel panel">/);
  assert.match(html, /<summary class="roomPanelSummary">/);
  assert.match(html, /class="roomPanelContent"/);
  assert.doesNotMatch(html, /<details id="roomPanel" class="roomPanel panel" open>/);
  assert.match(html, /id="refreshRooms"/);
  assert.match(html, /id="clearRooms"/);
  assert.match(html, /id="manualRoomForm"/);
  assert.match(css, /\.roomPanelSummary\s*\{/);
  assert.match(css, /\.roomPanel\[open\]/);
});
