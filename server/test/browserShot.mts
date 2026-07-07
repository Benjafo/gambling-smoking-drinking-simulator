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
  // the beer ritual, as the real gesture: drag bottle to the target ring,
  // swipe up past the pour threshold, hold until the sim finishes the pour
  [
    `{const item=document.getElementById('beerItem');
      const cx=innerWidth/2, cy=innerHeight*0.45;
      const r=item.getBoundingClientRect();
      const fire=(t,x,y)=>item.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:x,clientY:y,pointerId:9}));
      fire('pointerdown', r.left+40, r.top+40);
      setTimeout(()=>fire('pointermove', cx, cy), 120);
      setTimeout(()=>fire('pointermove', cx, cy-85), 300);
      setTimeout(()=>fire('pointerup', cx, cy-85), 3200);}`,
    4000,
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
  // grab the settled bottle off the table and re-fling it, one motion:
  // pointerdown on its screen position, drag, release
  [
    `{const d=(window.__snap?.debris||[]).find(d=>d.phase==='settled');
      if(!d) throw new Error('no settled debris to grab');
      const s=window.__scene.screenPos(d.pos.x,d.pos.y,d.pos.z);
      const c=document.querySelector('#stage canvas');
      const fire=(t,x,y)=>c.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:x,clientY:y,pointerId:11}));
      let x=s.x,y=s.y; fire('pointerdown',x,y);
      let i=0;const iv=setInterval(()=>{i++;x+=9;y-=26;fire('pointermove',x,y);
        if(i>=6){clearInterval(iv);fire('pointerup',x,y);}},16);}`,
    2500,
  ],
  // cigar via keyboard fallback (auto ritual, same time cost)
  [
    `document.getElementById('cigarItem').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
    3800,
  ],
  // hands full (holding the butt): clicking the settled bottle must be DENIED
  [
    `{const d=(window.__snap?.debris||[]).find(d=>d.phase==='settled');
      if(!d) throw new Error('no settled debris for deny test');
      const s=window.__scene.screenPos(d.pos.x,d.pos.y,d.pos.z);
      const c=document.querySelector('#stage canvas');
      c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:s.x,clientY:s.y,pointerId:13}));
      c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:s.x,clientY:s.y,pointerId:13}));}`,
    800,
  ],
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
    cigarInv: document.getElementById('cigarInv').textContent,
    flingHint: document.getElementById('flingHint').classList.contains('show'),
    held: window.__snap?.players?.[0]?.held?.kind ?? null,
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
