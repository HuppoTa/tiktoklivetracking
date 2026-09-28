import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../public/style.css", import.meta.url), "utf8");

test("Room ID candidates use a compact disclosure with accessible details", () => {
  assert.match(app, /class="roomCandidateDetails roomCandidate/);
  assert.match(app, /Các Room ID khác/);
  assert.match(app, /data-select-room=/);
  assert.match(css, /\.roomCandidateDetails\b/);
});

test("room candidate styles are outside the reduced-motion declaration", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*, \*::before, \*::after\s*\{[^}]*animation: none !important;[^}]*transition: none !important;[^}]*scroll-behavior: auto !important;[^}]*}\s*}/s);
  assert.match(css, /\.roomCandidate\b/);
});
