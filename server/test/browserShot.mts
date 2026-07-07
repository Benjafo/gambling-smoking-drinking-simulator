/* Drives the real client in headless Chrome via CDP: join the game, place a
   bet, deal, smoke, fling — then screenshot the live 3D scene. */
import WebSocket from "ws";

const CDP_PORT = 9223;
const PAGE_URL = process.env.PAGE_URL ?? "http://localhost:5199/";
const SHOT = process.env.SHOT ?? "/tmp/degen-shot.png";
const SCRIPT: [string, number][] = [
  // [expression, wait-ms-after]
  [`document.getElementById('startBtn').click()`, 1500],
  [`document.querySelector('#chipRack .plus[data-denom="100"]').click()`, 300],
  [`document.getElementById('dealBtn').click()`, 4500],
  [
    `{const b=document.getElementById('drinkBtn');
      b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      setTimeout(()=>b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})), 2300);}`,
    3500,
  ],
  // grab the held bottle (projected hand position) and flick it upward
  [
    `{const c=document.querySelector('#stage canvas');
      const fire=(type,x,y)=>c.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:x,clientY:y,pointerId:7}));
      let x=innerWidth*0.735, y=innerHeight*0.826;
      fire('pointerdown',x,y);
      let i=0;const iv=setInterval(()=>{i++;x-=7;y-=30;fire('pointermove',x,y);
        if(i>=6){clearInterval(iv);fire('pointerup',x,y);}},16);}`,
    2500,
  ],
  [`(document.getElementById('standBtn') || {click(){}}).click()`, 3500],
];

const listRes = await fetch(`http://localhost:${CDP_PORT}/json/list`);
const targets = (await listRes.json()) as { url: string; webSocketDebuggerUrl: string }[];
const page = targets.find((t) => t.url.startsWith(PAGE_URL));
if (!page) {
  console.error("FAIL: page target not found", targets.map((t) => t.url));
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pendingCbs = new Map<number, (r: any) => void>();
ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id && pendingCbs.has(msg.id)) {
    pendingCbs.get(msg.id)!(msg);
    pendingCbs.delete(msg.id);
  }
  if (msg.method === "Runtime.exceptionThrown")
    console.error("PAGE EXCEPTION:", JSON.stringify(msg.params.exceptionDetails.text));
});
const cmd = (method: string, params: object = {}): Promise<any> =>
  new Promise((res) => {
    const i = ++id;
    pendingCbs.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await new Promise((r) => ws.on("open", r));
await cmd("Runtime.enable");
await sleep(2500); // let the worker + rapier boot

for (const [expr, wait] of SCRIPT) {
  const r = await cmd("Runtime.evaluate", { expression: expr });
  if (r.result?.exceptionDetails)
    console.error("step failed:", expr.slice(0, 60), "→", r.result.exceptionDetails.text);
  else console.log("ok  :", expr.slice(0, 64).replace(/\n/g, " "));
  await sleep(wait);
}

const state = await cmd("Runtime.evaluate", {
  expression: `JSON.stringify({
    money: document.getElementById('moneyDisplay').textContent,
    hands: document.getElementById('handsDisplay').textContent,
    phase: document.getElementById('phaseDisplay').textContent,
    beerInv: document.getElementById('beerInv').textContent,
    flingHint: document.getElementById('flingHint').classList.contains('show'),
    debris: (window.__snap?.debris ?? []).map(d => d.kind + ':' + d.phase + '@' +
      d.pos.x.toFixed(1) + ',' + d.pos.y.toFixed(2) + ',' + d.pos.z.toFixed(1)),
  })`,
});
console.log("HUD state:", state.result?.result?.value);

const shot = await cmd("Page.captureScreenshot", { format: "png" });
const { writeFileSync } = await import("node:fs");
writeFileSync(SHOT, Buffer.from(shot.result.data, "base64"));
console.log("screenshot:", SHOT);
process.exit(0);
