/* Key-art backdrop capture: boots the built client headless, starts a solo
   game with bots, lets them play + litter for a while, hides the DOM HUD,
   and screenshots the raw 3D den at 3840×2160 from a couple of angles.
   Usage: npm run build && npm --workspace client run preview  (port 4173)
          PLAYWRIGHT_DIR=<dir with playwright-core> node capture-backdrop.mjs */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFrom = createRequire(
  process.env.PLAYWRIGHT_DIR
    ? path.join(process.env.PLAYWRIGHT_DIR, "package.json")
    : import.meta.url
);
const { chromium } = requireFrom("playwright-core");

function findChromium() {
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  for (const dir of fs.readdirSync(cache)) {
    if (dir.startsWith("chromium_headless_shell")) {
      const bin = path.join(
        cache, dir, "chrome-headless-shell-mac-arm64/chrome-headless-shell"
      );
      if (fs.existsSync(bin)) return bin;
    }
  }
  throw new Error("no cached playwright chromium found");
}

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2, // → 3840×2160 masters
});
page.on("console", (m) => m.type() === "error" && console.log("console.error:", m.text()));

await page.goto("http://localhost:4173/");
await page.waitForSelector("#titleSoloBtn");
await page.evaluate(() => document.fonts.ready);

// solo seat (local worker, we are the leader)
await page.click("#titleSoloBtn");
await page.waitForSelector("#lobbyScreen.active", { timeout: 15000 });

// four bots for a full table, then start; the sim runs its 10s countdown
await page.evaluate(() => {
  for (let i = 0; i < 4; i++) window.__send({ type: "addBot", difficulty: "medium" });
  window.__send({ type: "startGame" });
});
await page.waitForFunction(
  () => window.__snap && window.__snap.phase !== "lobby" && window.__snap.phase !== "over",
  { timeout: 30000 }
);
console.log("in the den, phase:", await page.evaluate(() => window.__snap.phase));

// keep our vices topped up while bots play/litter (idle players die ~50s in)
const keepAlive = setInterval(() => {
  page.evaluate(() => {
    window.__send({ type: "buy", item: "beer", qty: 1 });
    window.__send({ type: "buy", item: "cigar", qty: 1 });
    window.__send({ type: "consumeStart", kind: "beer" });
    window.__send({ type: "ritualEngage", on: true });
  }).catch(() => {});
}, 6000);

// let the table get lived-in: hands dealt, bottles flung
await page.waitForTimeout(35000);
clearInterval(keepAlive);

// strip every DOM overlay — raw canvas only (vignette stays: it's the mood)
await page.addStyleTag({
  content: "#hud,#startBanner,#betsBanner,.screen,#optionsBtn{display:none !important}",
});

// angle A: default seat view — dealer, table, the far neon
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(here, "backdrop-a.png") });
console.log("wrote backdrop-a.png");

// angle B: drag-look left ~35° for a moodier off-axis wall/neon framing
await page.mouse.move(960, 540);
await page.mouse.down();
for (let x = 960; x <= 1330; x += 46) {
  await page.mouse.move(x, 540);
  await page.waitForTimeout(30);
}
await page.mouse.up();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(here, "backdrop-b.png") });
console.log("wrote backdrop-b.png");

// angle C: look right + slightly up — neighbor player in frame
await page.mouse.move(960, 540);
await page.mouse.down();
for (let x = 960; x >= 300; x -= 60) {
  await page.mouse.move(x, 560);
  await page.waitForTimeout(30);
}
await page.mouse.up();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(here, "backdrop-c.png") });
console.log("wrote backdrop-c.png");

await browser.close();
