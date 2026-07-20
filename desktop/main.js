/* Desktop shell main process. The web build stays a plain static site; this
   wraps it with the things a Steam build needs and a browser tab doesn't:
   a real window + quit, F11 fullscreen, a crash log, and the house address
   (the web page derives the websocket URL from its own origin, which an
   app:// page can't do — see resolveServerUrl in client/src/transport.ts).

   The bundle is served over a privileged app:// scheme rather than file://
   because file:// pages get an opaque origin: module workers refuse to
   start (the sim worker) and localStorage (name/appearance/volume) is
   unreliable. app://bundle/ behaves like a normal https origin.

   Flags / env:
     --server=wss://host/ws   point the shell at a different lobby server
     LAST_CALL_SERVER=…       same, via env
     ELECTRON_START_URL=…     load the vite dev server instead of dist
     --smoke                  headless load check: boot, assert the title
                              screen exists, print console errors, exit */
import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_SERVER_URL = "wss://blackjack.benjafo.com/ws";
const SMOKE = process.argv.includes("--smoke");

function resolveServerUrl() {
  const arg = process.argv.find((a) => a.startsWith("--server="));
  return arg?.slice("--server=".length) || process.env.LAST_CALL_SERVER || DEFAULT_SERVER_URL;
}

/* the built client: packaged app → resources/web, repo checkout → whatever
   the last `vite build` / copy-web.mjs left behind */
function resolveWebRoot() {
  const candidates = [
    path.join(process.resourcesPath ?? "", "web"),
    path.join(__dirname, "dist-web"),
    path.join(__dirname, "../client/dist"),
  ];
  return candidates.find((p) => p && fs.existsSync(path.join(p, "index.html"))) ?? null;
}

/* ---------------- crash log ---------------- */
/* one append-only file in userData; the renderer forwards its own errors
   through the preload so web-side crashes land here too */
let logPath = null;
function logLine(kind, detail) {
  const line = `[${new Date().toISOString()}] ${kind}: ${detail}\n`;
  try {
    if (logPath) fs.appendFileSync(logPath, line);
  } catch {
    /* a failing log must never take the game down */
  }
  if (SMOKE || kind !== "console") console.error(line.trimEnd());
}

process.on("uncaughtException", (err) => logLine("main-uncaught", err.stack ?? String(err)));
process.on("unhandledRejection", (r) => logLine("main-unhandled-rejection", String(r)));

/* must run before app.whenReady */
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const serverUrl = resolveServerUrl();
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: !SMOKE,
    backgroundColor: "#0a0a0d",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      additionalArguments: [`--last-call-server=${serverUrl}`],
    },
  });

  // F11 everywhere (browser convention), plus whatever the OS binds natively
  win.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
    }
  });

  // the game never opens windows; anything that tries goes to the OS browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("render-process-gone", (_e, details) =>
    logLine("renderer-gone", JSON.stringify(details))
  );

  const devUrl = process.env.ELECTRON_START_URL;
  return devUrl ? win.loadURL(devUrl) : win.loadURL("app://bundle/");
}

app.on("child-process-gone", (_e, details) => logLine("child-gone", JSON.stringify(details)));
app.on("window-all-closed", () => app.quit());

ipcMain.on("desktop:quit", () => app.quit());
ipcMain.on("desktop:toggle-fullscreen", () => win?.setFullScreen(!win.isFullScreen()));
ipcMain.on("desktop:renderer-error", (_e, detail) => logLine("renderer", String(detail)));

app.whenReady().then(async () => {
  logPath = path.join(app.getPath("userData"), "last-call.log");

  const webRoot = resolveWebRoot();
  if (!webRoot) {
    console.error("No built client found. Run `npm run build` first (or desktop `pack`).");
    app.exit(1);
    return;
  }

  // app://bundle/<path> → <webRoot>/<path>; net.fetch supplies MIME types
  session.defaultSession.protocol.handle("app", (request) => {
    let rel = decodeURIComponent(new URL(request.url).pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    const file = path.normalize(path.join(webRoot, rel));
    if (file !== webRoot && !file.startsWith(webRoot + path.sep)) {
      return new Response("forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });

  if (SMOKE) return runSmoke();
  return createWindow();
});

/* boot the page invisibly, wait for load, check the shell wiring made it
   into the document, surface every console error — CI-able from day one */
async function runSmoke() {
  const errors = [];
  // createWindow awaits loadURL, which itself settles on finish/fail —
  // listeners must be up before it, and no second wait afterwards
  const loaded = createWindow();
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) errors.push(message);
    console.log(`console[${level}] ${message}`);
  });
  try {
    await loaded;
  } catch (err) {
    console.error(`SMOKE FAIL: load rejected — ${err}`);
    app.exit(1);
    return;
  }
  await new Promise((r) => setTimeout(r, 3000));
  const probe = await win.webContents.executeJavaScript(
    `({
      title: !!document.getElementById("titleScreen"),
      quitShown: document.getElementById("titleQuitBtn")?.style.display !== "none",
      server: window.desktop?.serverUrl ?? null,
      canvas: !!document.querySelector("#stage canvas"),
    })`
  );
  console.log("SMOKE probe:", JSON.stringify(probe));
  const ok = probe.title && probe.quitShown && probe.server && probe.canvas && errors.length === 0;
  console.log(ok ? "SMOKE PASS" : `SMOKE FAIL: ${errors.length} console error(s)`);
  app.exit(ok ? 0 : 1);
}
