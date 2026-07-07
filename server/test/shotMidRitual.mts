/* Screenshot taken mid-pour: verifies drop-target ring, tipped ghost bottle,
   spill drops, and progress ring are all visible during the gesture. */
import WebSocket from "ws";

const CDP_PORT = 9223;
const PAGE_URL = process.env.PAGE_URL ?? "http://localhost:5199/";
const SHOT = process.env.SHOT ?? "/tmp/degen-mid.png";

const targets = (await (await fetch(`http://localhost:${CDP_PORT}/json/list`)).json()) as {
  url: string;
  webSocketDebuggerUrl: string;
}[];
const page = targets.find((t) => t.url.startsWith(PAGE_URL));
if (!page) {
  console.error("FAIL: page target not found");
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const cbs = new Map<number, (r: any) => void>();
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && cbs.has(m.id)) {
    cbs.get(m.id)!(m);
    cbs.delete(m.id);
  }
});
const cmd = (method: string, params: object = {}): Promise<any> =>
  new Promise((res) => {
    const i = ++id;
    cbs.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await new Promise((r) => ws.on("open", r));
await sleep(2500);
await cmd("Runtime.evaluate", { expression: `document.getElementById('startBtn').click()` });
await sleep(1200);
await cmd("Runtime.evaluate", {
  expression: `{const item=document.getElementById('beerItem');
    const cx=innerWidth/2, cy=innerHeight*0.45;
    const r=item.getBoundingClientRect();
    const fire=(t,x,y)=>item.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:x,clientY:y,pointerId:9}));
    fire('pointerdown', r.left+40, r.top+40);
    setTimeout(()=>fire('pointermove', cx, cy), 120);
    setTimeout(()=>fire('pointermove', cx, cy-85), 300);}`,
});
await sleep(1300); // ~1s into the pour
const shot = await cmd("Page.captureScreenshot", { format: "png" });
const { writeFileSync } = await import("node:fs");
writeFileSync(SHOT, Buffer.from(shot.result.data, "base64"));
console.log("mid-ritual screenshot:", SHOT);
process.exit(0);
