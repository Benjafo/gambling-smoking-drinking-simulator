/* Multiplayer host: the exact same authoritative Simulation the client
   worker runs, behind a websocket. Clients connect with
   http://localhost:5173/?server=ws://localhost:8081
   Lobby/matchmaking/persistence layer on later — this is one shared room. */
import { WebSocketServer, WebSocket } from "ws";
import { Simulation } from "../../shared/src/sim";
import { SNAPSHOT_EVERY_TICKS, TICK_RATE } from "../../shared/src/constants";
import type { Intent } from "../../shared/src/types";

const PORT = Number(process.env.PORT ?? 8081);

const sim = await Simulation.create(Date.now() & 0xffffffff);
const clients = new Map<WebSocket, string>();
let nextPlayer = 1;

const wss = new WebSocketServer({ port: PORT });
console.log(`degenerate blackjack room open on ws://localhost:${PORT}`);

wss.on("connection", (ws) => {
  const playerId = "p" + nextPlayer++;
  clients.set(ws, playerId);
  ws.send(JSON.stringify({ type: "welcome", playerId }));
  console.log(`${playerId} connected (${clients.size} at the table)`);

  ws.on("message", (raw) => {
    let msg: { type: string; intent?: Intent };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "intent" && msg.intent) sim.applyIntent(playerId, msg.intent);
  });

  ws.on("close", () => {
    clients.delete(ws);
    sim.applyIntent(playerId, { type: "leave" });
    console.log(`${playerId} left the table`);
  });
});

/* fixed-step loop with snapshot broadcast, same shape as the client worker */
const stepMs = 1000 / TICK_RATE;
let last = performance.now();
let acc = 0;
let sinceSnap = 0;
setInterval(() => {
  const now = performance.now();
  acc += now - last;
  last = now;
  // cap the backlog: a stalled event loop must not fast-forward the sim in a
  // burst (an engaged ritual would complete in a blink of catch-up ticks)
  if (acc > 250) acc = 250;
  while (acc >= stepMs) {
    sim.step();
    acc -= stepMs;
    if (++sinceSnap >= SNAPSHOT_EVERY_TICKS) {
      sinceSnap = 0;
      if (clients.size > 0) {
        const payload = JSON.stringify({ type: "snapshot", snap: sim.snapshot() });
        for (const ws of clients.keys())
          if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      }
    }
  }
}, 8);
