/* Lobby player hits: a flung empty that beans another walker pre-game emits
   the playerHit event (the client yelps and stings off it) but pays nothing —
   no score, no directHits stat. The den's paying version lives in
   test/playerHit.ts.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import { TICK_RATE, LOBBY_HIT_Y_MIN, LOBBY_HIT_Y_MAX } from "../src/constants";
import type { PlayerSnap, SimEvent, Snapshot } from "../src/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

const sim = await Simulation.create(777);
const P1 = "p1";
const P2 = "p2";
const snap = (): Snapshot => sim.snapshot();
const player = (id: string): PlayerSnap => snap().players.find((p) => p.id === id)!;

sim.applyIntent(P1, { type: "join", name: "SNIPER" });
sim.applyIntent(P2, { type: "join", name: "TARGET" });

/* the pocket's table stock is NOT lobby-drinkable — machines only */
sim.applyIntent(P1, { type: "consumeStart", kind: "beer" });
assert(player(P1).ritual === null, "empty-handed lobby drinking is refused — machines first");

/* scavenge a throwable: stand P1 over the nearest seeded bottle */
const scrap = snap()
  .debris.filter((d) => d.room === "lobby" && d.kind !== "paper")
  .sort(
    (a, b) =>
      Math.hypot(a.pos.x - player(P1).pos.x, a.pos.z - player(P1).pos.z) -
      Math.hypot(b.pos.x - player(P1).pos.x, b.pos.z - player(P1).pos.z)
  )[0];
const p1Body = sim.players.get(P1)!;
p1Body.pos.x = scrap.pos.x + 0.4;
p1Body.pos.z = scrap.pos.z;
p1Body.pos.y = 0;
sim.step();
sim.applyIntent(P1, { type: "pickup", itemId: scrap.id });
assert(player(P1).held !== null, "scavenged an empty to throw");
/* floor litter is litter, not a drink */
if (player(P1).held!.kind === "beer" || player(P1).held!.kind === "cigar") {
  sim.applyIntent(P1, { type: "consumeStart", kind: player(P1).held!.kind as "beer" | "cigar" });
  assert(player(P1).ritual === null, "scavenged litter isn't drinkable — only a fresh freebie is");
}
let guard = 0;

/* line up the shot: step to clear ground near the target, then straight at
   the standing capsule (the scavenge spot could have furniture in the way) */
const target = player(P2);
p1Body.pos.x = target.pos.x + 1.2;
p1Body.pos.z = target.pos.z;
p1Body.pos.y = 0;
sim.step();
const me = player(P1);
const eye = { x: me.pos.x, y: me.pos.y + 1.5, z: me.pos.z };
const chestY = target.pos.y + (LOBBY_HIT_Y_MIN + LOBBY_HIT_Y_MAX) / 2;
const dir = { x: target.pos.x - eye.x, y: chestY - eye.y, z: target.pos.z - eye.z };
const len = Math.hypot(dir.x, dir.y, dir.z);
const speed = 7;
sim.applyIntent(P1, {
  type: "fling",
  itemId: player(P1).held!.id,
  origin: eye,
  vel: { x: (dir.x / len) * speed, y: (dir.y / len) * speed, z: (dir.z / len) * speed },
  angVel: { x: 3, y: 1, z: 3 },
});

let hit: (SimEvent & { t: "playerHit" }) | null = null;
guard = 0;
while (guard++ < TICK_RATE * 3 && !hit) {
  sim.step();
  for (const ev of sim.snapshot().events)
    if (ev.t === "playerHit") hit = ev;
}
assert(hit !== null, "the lobby throw connected — playerHit fired");
assert(hit!.flingerId === P1 && hit!.victimId === P2, "right sniper, right victim");
assert(hit!.points === 0, "pre-game hits pay no points");
assert(player(P1).score === 0, "sniper's score untouched");
assert(player(P1).stats.directHits === 0, "directHits stat untouched too");

console.log("\nALL LOBBY VICE TESTS PASSED");
