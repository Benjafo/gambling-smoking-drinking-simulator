/* The waiting room's seeded litter and toys: the floor's bottles and butts
   are real settled debris from tick zero, and the plunger and cue sticks are
   grabbable and flingable — but lobby-only. Nothing dispenses them, the
   janitor's clear-litter spares them, and starting the game empties them out
   of pockets back onto the lobby floor.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import { LOBBY_REACH, LOBBY_SCATTER, LOBBY_TABLE_CLUTTER, LOBBY_TOYS } from "../src/lobbyRoom";
import { TICK_RATE } from "../src/constants";
import { isVice } from "../src/types";
import type { PlayerSnap, Snapshot } from "../src/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

const sim = await Simulation.create(9001);
const P1 = "p1";
const snap = (): Snapshot => sim.snapshot();
const me = (): PlayerSnap => snap().players[0];

sim.applyIntent(P1, { type: "join", name: "TOYCOLLECTOR" });

/* ---- the room comes furnished ---- */
let s = snap();
const expectVice =
  LOBBY_SCATTER.filter((i) => i.kind !== "paper").length + LOBBY_TABLE_CLUTTER.length;
assert(
  s.debris.filter((d) => isVice(d.kind)).length === expectVice,
  `the scatter's and tables' bottles and butts are real debris (${expectVice} seeded)`
);
/* the table-top pieces rest at furniture height, not the floor */
const highSeeds = s.debris.filter((d) => isVice(d.kind) && d.pos.y > 0.3);
assert(
  highSeeds.length === LOBBY_TABLE_CLUTTER.length,
  `${LOBBY_TABLE_CLUTTER.length} pieces sit up on the table tops`
);
const toys = s.debris.filter((d) => !isVice(d.kind));
assert(toys.length === LOBBY_TOYS.length, "the toys are seeded too");
assert(toys.filter((d) => d.kind === "plunger").length === 1, "one plunger");
assert(toys.filter((d) => d.kind === "stick").length === 2, "two cue sticks");
assert(
  s.debris.every((d) => d.room === "lobby" && d.phase === "settled"),
  "everything seeded rests settled in the lobby"
);

/* stand the player at a clear spot near a target — reach rules get their
   own coverage in lobbyLitter; this suite tests what the hands may DO, so
   the commute is skipped the same way moneyDrop pins the meters */
function standNear(x: number, z: number): void {
  const p = sim.players.get(P1)!;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = 0;
  p.vy = 0;
  p.grounded = true;
  sim.step();
  const at = me().pos;
  assert(
    Math.hypot(at.x - x, at.z - z) < 0.2,
    `standing at (${x.toFixed(1)}, ${z.toFixed(1)}) — spot is clear of furniture`
  );
}

/* ---- the plunger: grab it, fling it, nothing scores ---- */
const plunger = toys.find((d) => d.kind === "plunger")!;
standNear(plunger.pos.x - 0.4, plunger.pos.z + 0.35);
assert(
  Math.hypot(0.4, 0.35, 1.5) <= LOBBY_REACH,
  "sanity: the plunger is inside walking reach from here"
);
sim.applyIntent(P1, { type: "pickup", itemId: plunger.id });
assert(me().held?.kind === "plunger", "the plunger sits in the hand");
assert(!snap().debris.some((d) => d.id === plunger.id), "and left the floor");

const eye = { x: me().pos.x, y: me().pos.y + 1.5, z: me().pos.z };
sim.applyIntent(P1, {
  type: "fling",
  itemId: me().held!.id,
  origin: eye,
  vel: { x: -eye.x, y: 2, z: -eye.z }, // toward the middle of the room
  angVel: { x: 4, y: 1, z: 3 },
});
assert(me().held === null, "the fling emptied the hand");
let flungPlunger = snap().debris.find((d) => d.kind === "plunger");
assert(flungPlunger?.phase === "flying", "the plunger flies for real");

let scored = false;
let guard = 0;
while (guard++ < TICK_RATE * 20) {
  sim.step();
  s = sim.snapshot();
  if (s.events.some((e) => e.t === "litter" || e.t === "moneyDrop")) scored = true;
  flungPlunger = s.debris.find((d) => d.kind === "plunger");
  if (flungPlunger?.phase === "settled") break;
}
assert(flungPlunger?.phase === "settled", "the plunger settles like any empty");
assert(flungPlunger!.room === "lobby", "and stays lobby debris");
assert(!scored && me().score === 0, "toy flings score nothing and pay nothing");

/* ---- clear-litter can't take what came with the room ----
   even the re-flung plunger keeps its seeded provenance, while a
   machine-dispensed bottle sweeps like the litter it is */
const census = snap().debris.length;
sim.applyIntent(P1, { type: "clearLitter" });
assert(
  snap().debris.length === census,
  "clear-litter sweeps nothing — everything here came with the room"
);
standNear(-3.0, 0); // at the beer fridge
sim.applyIntent(P1, { type: "dispense", kind: "beer" });
sim.applyIntent(P1, { type: "consumeStart", kind: "beer" });
sim.applyIntent(P1, { type: "ritualEngage", on: true });
for (let i = 0; i < TICK_RATE * 10 && me().held === null; i++) sim.step();
assert(me().held?.kind === "beer", "fridge stocked a fresh one; drinking it left the empty");
sim.applyIntent(P1, {
  type: "fling",
  itemId: me().held!.id,
  origin: { x: -3.0, y: 1.4, z: 0 },
  vel: { x: 2, y: 2, z: 1 },
  angVel: { x: 3, y: 1, z: 2 },
});
sim.step();
assert(snap().debris.length === census + 1, "the drained bottle joined the floor");
sim.applyIntent(P1, { type: "clearLitter" });
assert(
  snap().debris.length === census,
  "clear-litter takes ONLY the machine-spawned bottle"
);

/* ---- a held toy never reaches the den: pockets empty at the door ---- */
const stick = snap().debris.find((d) => d.kind === "stick")!;
standNear(stick.pos.x + 0.5, stick.pos.z - 0.15);
sim.applyIntent(P1, { type: "pickup", itemId: stick.id });
assert(me().held?.kind === "stick", "cue stick in hand");

sim.applyIntent(P1, { type: "startGame" });
for (let i = 0; i < TICK_RATE * 11 && snap().phase === "lobby"; i++) sim.step();
s = snap();
assert(s.phase === "betting", "the game started");
assert(me().held === null, "the stick was emptied out of the pocket at the door");
const sticksNow = s.debris.filter((d) => d.kind === "stick");
assert(
  sticksNow.length === 2 && sticksNow.every((d) => d.room === "lobby"),
  "both sticks are back on the lobby floor — none made it to the den"
);
assert(
  s.debris.filter((d) => !isVice(d.kind)).length === LOBBY_TOYS.length,
  "the toy census is intact"
);

console.log("\nALL LOBBY TOY TESTS PASSED");
