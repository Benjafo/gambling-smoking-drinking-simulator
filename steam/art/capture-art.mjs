/* Renders wordmark.html → transparent PNGs (flat + glow variants).
   Uses the machine's cached playwright chromium (no repo dependency):
     cd <scratch dir> && npm i playwright-core, then
     node capture-art.mjs
   Outputs steam/art/wordmark.png and steam/art/wordmark-glow.png. */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// playwright-core may live in a scratch dir — let the caller point us at it
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
  viewport: { width: 3600, height: 2400 },
  deviceScaleFactor: 1,
});
await page.goto(pathToFileURL(path.join(here, "wordmark.html")).toString());
await page.evaluate(() => document.fonts.ready);

for (const variant of ["flat", "glow"]) {
  await page.evaluate((v) => document.body.classList.toggle("glow", v === "glow"), variant);
  const el = page.locator("#mark");
  const file = path.join(here, variant === "flat" ? "wordmark.png" : "wordmark-glow.png");
  await el.screenshot({ path: file, omitBackground: true });
  console.log("wrote", file);
}
await browser.close();
