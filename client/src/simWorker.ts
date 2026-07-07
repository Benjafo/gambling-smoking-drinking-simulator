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
  setInterval(() => {
    const now = performance.now();
    acc += now - last;
    last = now;
    let guard = 0;
    while (acc >= stepMs && guard < 12) {
      sim!.step();
      acc -= stepMs;
      guard++;
      if (++sinceSnap >= SNAPSHOT_EVERY_TICKS) {
        sinceSnap = 0;
        post({ type: "snapshot", snap: sim!.snapshot() });
      }
    }
    if (guard >= 12) acc = 0; // tab was asleep: drop the backlog, don't spiral
  }, 8);
}
