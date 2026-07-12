/* Pre-game littering: dispensers hand out free throwables (proximity-gated,
   hands-empty), lobby flings are real physics contained by the room, none of
   it scores or pays, pickup respects walking reach, and the leader's
   clear-litter intent sweeps the floor.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import {
  DISPENSE_RADIUS,
  LOBBY_DISPENSERS,
  LOBBY_REACH,
  LOBBY_ROOM,
} from "../src/lobbyRoom";
import { TICK_RATE } from "../src/constants";
import type { PlayerSnap, Snapshot } from "../src/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

const sim = await Simulation.create(4242);
const P1 = "p1"; // leader
const P2 = "p2";
const snap = (): Snapshot => sim.snapshot();
const player = (id: string): PlayerSnap => snap().players.find((p) => p.id === id)!;

/* the lobby comes pre-seeded with litter and toys; this suite tracks the
   debris IT creates by excluding the ids that existed at boot */
const seededIds = new Set(snap().debris.map((d) => d.id));
const fresh = (s: Snapshot) => s.debris.filter((d) => !seededIds.has(d.id));

sim.applyIntent(P1, { type: "join", name: "LEADER" });
sim.applyIntent(P2, { type: "join", name: "TAGALONG" });

/* ---- dispensing is proximity-gated ---- */
const beerSpot = LOBBY_DISPENSERS.find((d) => d.kind === "beer")!;
sim.applyIntent(P1, { type: "dispense", kind: "beer" });
assert(player(P1).held === null, "dispense from across the room is refused");

/* walk the leader to the beer fridge (aim-and-hold, like a real client) */
let guard = 0;
while (guard++ < TICK_RATE * 20) {
  const at = player(P1).pos;
  if (Math.hypot(at.x - beerSpot.x, at.z - beerSpot.z) <= DISPENSE_RADIUS - 0.15) break;
  sim.applyIntent(P1, {
    type: "move",
    dirX: beerSpot.x - at.x,
    dirZ: beerSpot.z - at.z,
    yaw: 0,
  });
  sim.step();
}
sim.applyIntent(P1, { type: "move", dirX: 0, dirZ: 0, yaw: 0 });
const before = player(P1);
sim.applyIntent(P1, { type: "dispense", kind: "beer" });
let me = player(P1);
assert(me.held !== null && me.held.kind === "beer", "standing at the fridge dispenses a beer");
assert(me.beerInv === before.beerInv, "dispensing is not inventory (free litter, not a vice)");
assert(me.money === before.money, "dispensing costs nothing");
const firstHeldId = me.held!.id;
sim.applyIntent(P1, { type: "dispense", kind: "beer" });
assert(player(P1).held!.id === firstHeldId, "hands full: no second dispense until it's flung");
sim.applyIntent(P1, { type: "dispense", kind: "cigar" });
assert(
  player(P1).held!.kind === "beer",
  "wrong machine anyway — cigars come from the cigarette machine"
);

/* ---- flinging in the lobby: real physics, contained, unscored ---- */
const eye = { x: me.pos.x, y: 1.5, z: me.pos.z };
sim.applyIntent(P1, {
  type: "fling",
  itemId: firstHeldId,
  origin: { x: eye.x, y: eye.y, z: eye.z },
  vel: { x: -1.2, y: 1.8, z: -3.2 }, // into the dead-plant corner, away from the spawns
  angVel: { x: 4, y: 2, z: 4 },
});
me = player(P1);
assert(me.held === null, "the fling emptied the hand");
let s = snap();
assert(fresh(s).length === 1 && fresh(s)[0].room === "lobby", "the empty is lobby debris");

let sawLitterEvent = false;
let sawMoneyEvent = false;
guard = 0;
while (guard++ < TICK_RATE * 12) {
  sim.step();
  s = sim.snapshot();
  for (const ev of s.events) {
    if (ev.t === "litter") sawLitterEvent = true;
    if (ev.t === "moneyDrop") sawMoneyEvent = true;
  }
  if (fresh(s).length && fresh(s)[0].phase === "settled") break;
}
assert(fresh(s).length === 1, "the empty survived its flight (didn't fall out of the world)");
assert(fresh(s)[0].phase === "settled", "lobby debris settles like den debris");
const rest = fresh(s)[0].pos;
assert(
  Math.abs(rest.x) < LOBBY_ROOM.halfW + 0.4 &&
    Math.abs(rest.z) < LOBBY_ROOM.halfD + 0.4 &&
    rest.y > -0.1 &&
    rest.y < LOBBY_ROOM.height,
  `the walls contained the throw (rested at ${rest.x.toFixed(2)}, ${rest.y.toFixed(2)}, ${rest.z.toFixed(2)})`
);
assert(!sawLitterEvent && !sawMoneyEvent, "pre-game littering pays no points and drops no cash");
assert(player(P1).score === 0, "score untouched by lobby littering");
assert(player(P1).stats.litters === 0, "litter stat untouched too");

/* ---- pickup respects walking reach ---- */
const debrisId = fresh(s)[0].id;
const p2 = player(P2);
const p2Dist = Math.hypot(rest.x - p2.pos.x, rest.z - p2.pos.z);
assert(p2Dist > LOBBY_REACH, `sanity: P2 stands ${p2Dist.toFixed(1)}m from the empty`);
sim.applyIntent(P2, { type: "pickup", itemId: debrisId });
assert(player(P2).held === null, "litter beyond walking reach can't be grabbed");
/* the thrower walks over to it and grabs it */
guard = 0;
while (guard++ < TICK_RATE * 20) {
  const at = player(P1).pos;
  if (Math.hypot(at.x - rest.x, at.z - rest.z) <= LOBBY_REACH - 0.6) break;
  sim.applyIntent(P1, { type: "move", dirX: rest.x - at.x, dirZ: rest.z - at.z, yaw: 0 });
  sim.step();
}
sim.applyIntent(P1, { type: "move", dirX: 0, dirZ: 0, yaw: 0 });
sim.applyIntent(P1, { type: "pickup", itemId: debrisId });
assert(player(P1).held !== null, "walk up to the empty and it's grabbable again");
assert(fresh(sim.snapshot()).length === 0, "picked-up litter leaves the floor");

/* refling and leave a second piece via the cigar machine for the clear test */
sim.applyIntent(P1, {
  type: "fling",
  itemId: player(P1).held!.id,
  origin: { x: eye.x, y: eye.y, z: eye.z },
  vel: { x: 1, y: 1, z: -1 },
  angVel: { x: 2, y: 2, z: 2 },
});
for (let i = 0; i < TICK_RATE; i++) sim.step();
assert(fresh(sim.snapshot()).length === 1, "reflung empty is back on the floor");

/* ---- clear litter: leader-only, lobby-only, and the toys survive ---- */
const seededCount = sim.snapshot().debris.length - 1; // everything but the refling
sim.applyIntent(P2, { type: "clearLitter" });
assert(sim.snapshot().debris.length === seededCount + 1, "a non-leader can't clear the litter");
sim.applyIntent(P1, { type: "clearLitter" });
s = sim.snapshot();
assert(
  s.debris.every((d) => d.kind === "plunger" || d.kind === "stick"),
  "the leader's clear-litter sweeps every empty"
);
assert(
  s.debris.length > 0 && fresh(s).length === 0,
  "the toys aren't litter: the plunger and sticks survive the sweep"
);

/* ---- none of it leaks into the game ---- */
sim.applyIntent(P1, { type: "dispense", kind: "beer" });
assert(player(P1).held !== null, "one more in hand before the game starts");
sim.applyIntent(P1, { type: "startGame" });
for (let i = 0; i < TICK_RATE * 11 && sim.snapshot().phase === "lobby"; i++) sim.step(); // ride out the start countdown
assert(sim.snapshot().phase === "betting", "leader started the game");
sim.applyIntent(P1, { type: "dispense", kind: "beer" });
sim.applyIntent(P1, { type: "clearLitter" });
assert(sim.snapshot().phase === "betting", "dispense/clear intents are dead outside the lobby");
// the carried empty flings at the table as den debris, still worthless
sim.applyIntent(P1, {
  type: "fling",
  itemId: player(P1).held!.id,
  origin: { x: 0, y: 1.5, z: 2.2 },
  vel: { x: 0, y: 1, z: -2 },
  angVel: { x: 1, y: 1, z: 1 },
});
let denScored = false;
for (let i = 0; i < TICK_RATE * 8; i++) {
  sim.step();
  const st = sim.snapshot();
  if (st.events.some((e) => e.t === "litter" || e.t === "moneyDrop")) denScored = true;
  if (st.debris.length && st.debris.every((d) => d.phase === "settled")) break;
}
const carried = fresh(sim.snapshot());
assert(carried.length === 1 && carried[0].room === "den", "the carried empty landed in the den");
assert(!denScored, "a dispensed (unearned) empty never scores, even at the table");

console.log("\nALL LOBBY LITTER TESTS PASSED");
