/* Bridge between the sandboxed page and the shell. Everything the web build
   needs to know about the desktop wrapper hangs off window.desktop (typed in
   client/src/desktop.d.ts); its absence means "running in a browser". */
const { contextBridge, ipcRenderer } = require("electron");

const serverArg = process.argv.find((a) => a.startsWith("--last-call-server="));

contextBridge.exposeInMainWorld("desktop", {
  serverUrl: serverArg ? serverArg.slice("--last-call-server=".length) : null,
  quit: () => ipcRenderer.send("desktop:quit"),
  toggleFullscreen: () => ipcRenderer.send("desktop:toggle-fullscreen"),
});

/* page crashes belong in the shell's crash log */
window.addEventListener("error", (e) =>
  ipcRenderer.send("desktop:renderer-error", String(e.error?.stack ?? e.message))
);
window.addEventListener("unhandledrejection", (e) =>
  ipcRenderer.send("desktop:renderer-error", `unhandledrejection: ${String(e.reason?.stack ?? e.reason)}`)
);
