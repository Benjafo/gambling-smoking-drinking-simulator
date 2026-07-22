/* Web-worker host for the authoritative simulation. This is the same role
   the Node server plays in multiplayer — 60 Hz fixed steps, 20 Hz snapshots. */
import { Simulation } from "@shared/sim";
import { SNAPSHOT_EVERY_TICKS, TICK_RATE } from "@shared/constants";
import type { Intent } from "@shared/types";

type InMsg =
  | { type: "init"; seed: number; playerId: string }
  | { type: "intent"; playerId: string; intent: Intent };

const post = (m: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);

let sim: Simulation | null = null;
const pending: { playerId: string; intent: Intent }[] = [];

(self as unknown as { onmessage: (e: MessageEvent<InMsg>) => void }).onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    sim = await Simulation.create(msg.seed);
    for (const p of pending) sim.applyIntent(p.playerId, p.intent);
    pending.length = 0;
    post({ type: "welcome", playerId: msg.playerId });
    startLoop();
  } else if (msg.type === "intent") {
    if (sim) sim.applyIntent(msg.playerId, msg.intent);
    else pending.push(msg);
  }
};

function startLoop(): void {
  const stepMs = 1000 / TICK_RATE;
  let last = performance.now();
  let acc = 0;
  let sinceSnap = 0;
  // 0 forces the settled set out before the first snapshot (sim starts at 1)
  let sentDebrisV = 0;
  setInterval(() => {
    const now = performance.now();
    acc += now - last;
    last = now;
    // cap the backlog: a stalled thread must not fast-forward the sim in a
    // burst (an engaged ritual would complete in a blink of catch-up ticks)
    if (acc > 250) acc = 250;
    while (acc >= stepMs) {
      sim!.step();
      acc -= stepMs;
      if (++sinceSnap >= SNAPSHOT_EVERY_TICKS) {
        sinceSnap = 0;
        // same order the server keeps: settled set first when it changed
        if (sim!.settledV !== sentDebrisV) {
          const settled = sim!.settledDebris();
          sentDebrisV = settled.v;
          post({ type: "debris", v: settled.v, items: settled.items });
        }
        post({ type: "snapshot", snap: sim!.snapshot(true) });
      }
    }
  }, 8);
}
