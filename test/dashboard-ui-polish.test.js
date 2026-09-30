import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";

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

test("hologram theme uses local CSS layers and preserves reduced-motion support", () => {
  assert.match(css, /--holo-cyan:/);
  assert.match(css, /--holo-pink:/);
  assert.match(css, /--holo-violet:/);
  assert.match(css, /\.hero::after/);
  assert.match(css, /\.panel\s*\{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("hologram hierarchy keeps energy ambience bounded and reserves pink for primary actions", () => {
  assert.match(css, /--holo-copy-muted:\s*#[0-9a-f]{6}/i);
  assert.match(css, /body::before\s*\{[\s\S]*?opacity:\s*\.84;/);
  assert.match(css, /\.hero::after\s*\{[\s\S]*?opacity:\s*\.30;/);
  assert.match(css, /#toggle,\s*#loginButton,\s*#connectTarget/);
});

test("feminine hologram direction carries pink and violet through the aurora, hero and metric cards", () => {
  assert.match(css, /--holo-rose:\s*#[0-9a-f]{6}/i);
  assert.match(css, /--holo-orchid:\s*#[0-9a-f]{6}/i);
  assert.match(css, /\.hero h1\s*\{[\s\S]*?background:\s*linear-gradient/);
  assert.match(css, /\.stats article:nth-child\(2n\)\s*\{\s*border-top-color:\s*var\(--holo-rose\)/);
});

test("energy-universe background uses one bounded liquid transform layer and avoids expensive effects", () => {
  const energyLayer = css.match(/body::before\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  const topbarRules = [...css.matchAll(/\.topbar\s*\{([\s\S]*?)\n\}/g)].map((match) => match[1]);

  assert.match(energyLayer, /radial-gradient/);
  assert.match(energyLayer, /animation:\s*energyDrift/);
  assert.match(css, /@keyframes energyDrift/);
  assert.equal((css.match(/animation:\s*energyDrift/g) || []).length, 1);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?body::before\s*\{[\s\S]*?animation:\s*none/);
  assert.doesNotMatch(energyLayer, /mask-image|filter:|background-position/);
  assert.equal(topbarRules.some((rules) => /backdrop-filter/.test(rules)), false);
  assert.doesNotMatch(css, /\.panel::before\s*\{[\s\S]*?mask:/);
});

test("liquid universe adds visual depth through distant static color fields and one transform-only foreground drift", () => {
  const energyLayer = css.match(/body::before\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  const driftKeyframes = css.match(/@keyframes energyDrift\s*\{([\s\S]*?)\n\}/)?.[1] || "";

  assert.match(css, /radial-gradient\(84rem 46rem at 6% -22%/);
  assert.match(css, /radial-gradient\(46rem 30rem at 8% 16%/);
  assert.match(energyLayer, /animation:\s*energyDrift 42s/);
  assert.match(energyLayer, /transform: translate3d/);
  assert.doesNotMatch(energyLayer, /filter:|mask|mix-blend-mode|background-position|will-change/);
  assert.doesNotMatch(driftKeyframes, /opacity|background|filter/);
  assert.match(css, /\.panel\s*\{[\s\S]*?rgba\(52, 30, 83, \.68\)/);
});

test("cosmic background fallback asset is local, bounded and does not introduce a network or scrolling cost", async () => {
  const asset = new URL("../public/assets/pastel-cosmic-nebula-sparkle.webp", import.meta.url);
  const assetInfo = await stat(asset);

  assert.ok(assetInfo.size > 100_000 && assetInfo.size < 350_000);
  assert.match(css, /url\(["']?\/assets\/pastel-cosmic-nebula-sparkle\.webp["']?\)/);
  assert.doesNotMatch(css, /presentationgo\.com|rawpixel\.com|https?:\/\/.*nebula/i);
  assert.doesNotMatch(css, /background-attachment:\s*fixed/);
});

test("liquid glass keeps the nebula crisp and removes decorative scan lines from the hero", () => {
  const heroSheen = css.match(/\.hero::after\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  const staticNebula = css.match(/body::after\s*\{([\s\S]*?)\n\}/)?.[1] || "";

  assert.match(staticNebula, /position:\s*fixed/);
  assert.match(staticNebula, /url\(["']?\/assets\/pastel-cosmic-nebula-sparkle\.webp["']?\)/);
  assert.doesNotMatch(staticNebula, /animation:|transform:|filter:|mask|background-attachment/);
  assert.match(heroSheen, /linear-gradient/);
  assert.doesNotMatch(heroSheen, /repeating-linear-gradient/);
});

test("cosmic sparkle is carried by the existing liquid layer without adding a second animation", () => {
  const energyLayer = css.match(/body::before\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  const heroSheen = css.match(/\.hero::after\s*\{([\s\S]*?)\n\}/)?.[1] || "";

  assert.match(energyLayer, /radial-gradient\(circle at 13% 18%/);
  assert.match(energyLayer, /radial-gradient\(circle at 82% 31%/);
  assert.match(heroSheen, /radial-gradient\(circle at 11% 24%/);
  assert.equal((css.match(/animation:\s*energyDrift/g) || []).length, 1);
  assert.doesNotMatch(css, /animation:\s*(?!energyDrift)[\w-]*sparkle/i);
});

test("liquid glass keeps cosmic texture visible and gives the existing energy layer visible star glints", () => {
  const energyLayer = css.match(/body::before\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  const heroSheen = css.match(/\.hero::after\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  const panelRules = css.match(/\.panel\s*\{([\s\S]*?)\n\}/g) || [];

  assert.match(energyLayer, /radial-gradient\(circle at 13% 18%, rgba\(255, 247, 255, \.96\) 0 1\.7px, transparent 3\.6px\)/);
  assert.match(energyLayer, /radial-gradient\(circle at 82% 31%, rgba\(203, 247, 255, \.92\) 0 1\.5px, transparent 3\.4px\)/);
  assert.match(heroSheen, /radial-gradient\(circle at 11% 24%, rgba\(255, 246, 253, \.92\) 0 1\.6px, transparent 3\.5px\)/);
  assert.ok(panelRules.some((rules) => /rgba\(52, 30, 83, \.68\)/.test(rules)));
});

test("sparkling cosmic art uses a responsive 4K asset without forcing its download on standard-density displays", async () => {
  const standard = new URL("../public/assets/pastel-cosmic-nebula-sparkle.webp", import.meta.url);
  const retina = new URL("../public/assets/pastel-cosmic-nebula-sparkle-4k.webp", import.meta.url);
  const [standardInfo, retinaInfo] = await Promise.all([stat(standard), stat(retina)]);

  assert.match(css, /image-set\(/);
  assert.match(css, /pastel-cosmic-nebula-sparkle\.webp[\s\S]*?1x/);
  assert.match(css, /pastel-cosmic-nebula-sparkle-4k\.webp[\s\S]*?2x/);
  assert.ok(standardInfo.size < 350_000);
  assert.ok(retinaInfo.size < 800_000);
});
