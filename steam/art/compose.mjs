/* Assembles every Steam art deliverable from three masters:
     backdrop-a.png (3840×2160)  wordmark-glow.png  icon-1024.png
   → steam/art/out/*  plus desktop/build/icon.png
   Run: PLAYWRIGHT_DIR=<scratch pw dir> node compose.mjs
   (PLAYWRIGHT_DIR doubles as the dir that has sharp + png-to-ico installed) */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFrom = createRequire(
  process.env.PLAYWRIGHT_DIR
    ? path.join(process.env.PLAYWRIGHT_DIR, "package.json")
    : import.meta.url
);
const sharp = requireFrom("sharp");
const pngToIcoMod = requireFrom("png-to-ico");
const pngToIco = pngToIcoMod.default ?? pngToIcoMod;

const BACKDROP = path.join(here, "backdrop-a.png");
const WORDMARK = path.join(here, "wordmark-glow.png");
const ICON = path.join(here, "icon-1024.png");
const OUT = path.join(here, "out");
fs.mkdirSync(OUT, { recursive: true });

const SRC_W = 3840, SRC_H = 2160;
const MARK_AR = 1873 / 927; // wordmark aspect

/* cover-crop the backdrop to W×H keeping the dealer (x≈49%) framed */
async function crop(W, H, focusX = 0.49, focusY = 0.42) {
  const scale = Math.max(W / SRC_W, H / SRC_H);
  const cw = Math.round(W / scale), ch = Math.round(H / scale);
  const left = Math.min(SRC_W - cw, Math.max(0, Math.round(focusX * SRC_W - cw / 2)));
  const top = Math.min(SRC_H - ch, Math.max(0, Math.round(focusY * SRC_H - ch / 2)));
  return sharp(BACKDROP).extract({ left, top, width: cw, height: ch }).resize(W, H).png().toBuffer();
}

async function mark(widthPx) {
  return sharp(WORDMARK).resize({ width: Math.round(widthPx) }).png().toBuffer();
}

/* capsule = crop + wordmark at (xFrac from left | centered), yFrac from top */
async function capsule(file, W, H, markWFrac, markYFrac, opts = {}) {
  const base = await crop(W, H, opts.focusX, opts.focusY);
  const m = await mark(W * markWFrac);
  const mMeta = await sharp(m).metadata();
  const left = opts.markXFrac != null
    ? Math.round(W * opts.markXFrac)
    : Math.round((W - mMeta.width) / 2);
  const out = await sharp(base)
    .composite([{ input: m, left, top: Math.round(H * markYFrac) }])
    .png().toBuffer();
  fs.writeFileSync(path.join(OUT, file), out);
  console.log("wrote", file);
}

// ---- store capsules (name must be legible on each) ----
// wordmark hugs the left dark wall so the spotlit dealer stays clear of it
await capsule("header_capsule_460x215.png", 460, 215, 0.42, 0.06, { markXFrac: 0.04 });
await capsule("main_capsule_616x353.png", 616, 353, 0.42, 0.06, { markXFrac: 0.04 });
await capsule("vertical_capsule_374x448.png", 374, 448, 0.86, 0.05);
await capsule("library_capsule_600x900.png", 600, 900, 0.86, 0.05);

// small capsule 231×87: wordmark IS the capsule (art is illegible this small)
{
  const base = await sharp(BACKDROP)
    .extract({ left: 300, top: 120, width: 1200, height: 452 }) // clean dark wall
    .resize(231, 87).png().toBuffer();
  const m = await mark(87 * 0.8 * MARK_AR);
  const mMeta = await sharp(m).metadata();
  const out = await sharp(base)
    .composite([{ input: m, left: Math.round((231 - mMeta.width) / 2), top: Math.round(87 * 0.08) }])
    .png().toBuffer();
  fs.writeFileSync(path.join(OUT, "small_capsule_231x87.png"), out);
  console.log("wrote small_capsule_231x87.png");
}

// ---- library hero: art only (Steam overlays the library logo on it) ----
{
  const out = await sharp(BACKDROP)
    .extract({ left: 0, top: 380, width: 3840, height: 1240 })
    .png().toBuffer();
  fs.writeFileSync(path.join(OUT, "library_hero_3840x1240.png"), out);
  console.log("wrote library_hero_3840x1240.png");
}

// ---- library logo: wordmark on transparency ----
{
  const m = await mark(1180);
  const mMeta = await sharp(m).metadata();
  const out = await sharp({
    create: { width: 1280, height: 720, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: m, left: Math.round((1280 - mMeta.width) / 2), top: Math.round((720 - mMeta.height) / 2) }])
    .png().toBuffer();
  fs.writeFileSync(path.join(OUT, "library_logo_1280x720.png"), out);
  console.log("wrote library_logo_1280x720.png");
}

// ---- icons ----
fs.writeFileSync(
  path.join(OUT, "community_icon_184.jpg"),
  await sharp(ICON).resize(184, 184).jpeg({ quality: 92 }).toBuffer()
);
console.log("wrote community_icon_184.jpg");

const icoSizes = await Promise.all(
  [256, 64, 48, 32, 16].map((s) => sharp(ICON).resize(s, s).png().toBuffer())
);
fs.writeFileSync(path.join(OUT, "icon.ico"), await pngToIco(icoSizes));
console.log("wrote icon.ico");

// electron-builder convention: build/icon.png (≥512²) → converted per-platform
const buildDir = path.join(here, "../../desktop/build");
fs.mkdirSync(buildDir, { recursive: true });
fs.copyFileSync(ICON, path.join(buildDir, "icon.png"));
fs.copyFileSync(path.join(OUT, "icon.ico"), path.join(buildDir, "icon.ico"));
console.log("wrote desktop/build/icon.png + icon.ico");
