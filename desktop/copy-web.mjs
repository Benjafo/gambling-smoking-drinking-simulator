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
