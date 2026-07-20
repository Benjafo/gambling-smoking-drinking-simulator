/* Bridge between the sandboxed page and the shell. Everything the web build
   needs to know about the desktop wrapper hangs off window.desktop (typed in
   client/src/desktop.d.ts); its absence means "running in a browser". */
const { contextBridge, ipcRenderer } = require("electron");

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

contextBridge.exposeInMainWorld("desktop", {
  serverUrl: arg("last-call-server"),
  /* Steam persona name, or null when Steam isn't running */
  personaName: arg("last-call-persona") || null,
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
