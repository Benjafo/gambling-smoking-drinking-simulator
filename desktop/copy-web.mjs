/* Stage the built client next to the shell so electron-builder can bundle it
   (its `files`/`extraResources` globs can't reach outside the package dir).
   Run `npm run build` (client) first; `pack` chains through here. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "../client/dist");
const dst = path.join(here, "dist-web");

if (!fs.existsSync(path.join(src, "index.html"))) {
  console.error("client/dist is missing — run `npm run build` first");
  process.exit(1);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log(`staged ${src} → ${dst}`);

/* steamworks.js hoists to the repo root, out of reach of electron-builder's
   package-dir globs — stage it too (shipped via extraResources, loaded from
   resources/steamworks by main.js) */
const swSrc = path.join(here, "../node_modules/steamworks.js");
const swDst = path.join(here, "vendor/steamworks");
fs.rmSync(swDst, { recursive: true, force: true });
fs.cpSync(swSrc, swDst, { recursive: true });
console.log(`staged ${swSrc} → ${swDst}`);
