/* Wire-format debris split: snapshot(wire) carries only flying pieces,
   settledDebris() carries the versioned settled set, and settledV bumps
   exactly when the settled floor changes — settle, pickup, janitor sweep.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import { DISPENSE_RADIUS, LOBBY_DISPENSERS } from "../src/lobbyRoom";
import { TICK_RATE } from "../src/constants";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

const sim = await Simulation.create(777);
const P1 = "p1";
sim.applyIntent(P1, { type: "join", name: "WIREBOT" });

/* ---- boot state: the seeded room is settled, versioned, and absent from
   wire snapshots ---- */
const full = sim.snapshot();
const wire = sim.snapshot(true);
const settled0 = sim.settledDebris();
assert(sim.settledV === 1, "the seeded room litter is version 1");
assert(wire.settledV === 1, "wire snapshots carry the version");
assert(full.debris.length > 0, "full snapshots still list the seeded floor (tests, solo)");
assert(wire.debris.length === 0, "nothing airborne at boot — the wire snapshot ships no debris");
assert(
  settled0.items.length === full.debris.filter((d) => d.phase === "settled").length,
  "settledDebris() is exactly the settled slice of the full list"
);
assert(
  settled0.items.every((d) => d.phase === "settled"),
  "no flying pieces leak into the settled set"
);

/* ---- mint a real empty: walk to the fridge, dispense, drink ---- */
const beerSpot = LOBBY_DISPENSERS.find((d) => d.kind === "beer")!;
let guard = 0;
while (guard++ < TICK_RATE * 20) {
  const at = sim.snapshot().players[0].pos;
  if (Math.hypot(at.x - beerSpot.x, at.z - beerSpot.z) <= DISPENSE_RADIUS - 0.15) break;
  sim.applyIntent(P1, { type: "move", dirX: beerSpot.x - at.x, dirZ: beerSpot.z - at.z, yaw: 0 });
  sim.step();
}
sim.applyIntent(P1, { type: "move", dirX: 0, dirZ: 0, yaw: 0 });
sim.applyIntent(P1, { type: "dispense", kind: "beer" });
sim.applyIntent(P1, { type: "consumeStart", kind: "beer" });
sim.applyIntent(P1, { type: "ritualEngage", on: true });
guard = 0;
while (guard++ < TICK_RATE * 10 && !sim.snapshot().players[0].held) sim.step();
const heldId = sim.snapshot().players[0].held!.id;
assert(heldId > 0, "ritual done: empty in hand");

/* ---- fling it: airborne piece lives in the wire snapshot, version holds ---- */
const vBeforeFling = sim.settledV;
const me = sim.snapshot().players[0];
sim.applyIntent(P1, {
  type: "fling",
  itemId: heldId,
  origin: { x: me.pos.x, y: 1.5, z: me.pos.z },
  vel: { x: 1.1, y: 1.6, z: -2.6 },
  angVel: { x: 3, y: 1, z: 2 },
});
sim.step();
let w = sim.snapshot(true);
assert(w.debris.length === 1 && w.debris[0].phase === "flying", "the flung empty streams as flying debris");
assert(sim.settledV === vBeforeFling, "flying changes nothing about the settled set");

/* ---- it lands: version bumps, piece crosses from stream to settled set ---- */
guard = 0;
while (guard++ < TICK_RATE * 12 && sim.snapshot(true).debris.length > 0) sim.step();
w = sim.snapshot(true);
assert(w.debris.length === 0, "settled: gone from the wire snapshot stream");
assert(sim.settledV === vBeforeFling + 1, "settling bumped the version once");
const settled1 = sim.settledDebris();
assert(
  settled1.items.some((d) => !d.seeded),
  "the new empty is in the settled set"
);
assert(settled1.v === sim.settledV, "settledDebris() reports the live version");

/* ---- pickup pulls it back off the floor: version bumps again ---- */
const target = settled1.items.find((d) => !d.seeded)!;
guard = 0;
while (guard++ < TICK_RATE * 20) {
  const at = sim.snapshot().players[0].pos;
  if (Math.hypot(at.x - target.pos.x, at.z - target.pos.z) <= 1.4) break;
  sim.applyIntent(P1, {
    type: "move",
    dirX: target.pos.x - at.x,
    dirZ: target.pos.z - at.z,
    yaw: 0,
  });
  sim.step();
}
sim.applyIntent(P1, { type: "move", dirX: 0, dirZ: 0, yaw: 0 });
const vBeforePickup = sim.settledV;
sim.applyIntent(P1, { type: "pickup", itemId: target.id });
assert(sim.snapshot().players[0].held !== null, "picked the settled empty back up");
assert(sim.settledV === vBeforePickup + 1, "removing a settled piece bumped the version");
assert(
  sim.settledDebris().items.every((d) => d.id !== target.id),
  "the picked-up piece left the settled set"
);

/* ---- janitor sweep: refling, settle, clear — version moves, seeded stays ---- */
sim.applyIntent(P1, {
  type: "fling",
  itemId: sim.snapshot().players[0].held!.id,
  origin: { x: 0, y: 1.5, z: 0 },
  vel: { x: -1, y: 1.5, z: 1.5 },
  angVel: { x: 2, y: 2, z: 2 },
});
guard = 0;
while (guard++ < TICK_RATE * 12 && sim.snapshot(true).debris.length > 0) sim.step();
const vBeforeSweep = sim.settledV;
const seededCount = sim.settledDebris().items.filter((d) => d.seeded).length;
sim.applyIntent(P1, { type: "clearLitter" });
assert(sim.settledV > vBeforeSweep, "the sweep bumped the version");
const after = sim.settledDebris();
assert(
  after.items.every((d) => d.seeded) && after.items.length === seededCount,
  "only the seeded floor survives the sweep, and none of it was lost"
);

/* ---- wire hygiene: rounded numbers, no sub-millimeter JSON ---- */
const digits = (n: number): number => (String(n).split(".")[1] ?? "").length;
for (const d of after.items) {
  assert(
    [d.pos.x, d.pos.y, d.pos.z, d.rot.x, d.rot.y, d.rot.z, d.rot.w].every((n) => digits(n) <= 3),
    `debris ${d.id} is wire-rounded (≤3 decimals)`
  );
  break; // one spot check keeps the log readable
}

console.log("\nALL DEBRIS WIRE TESTS PASSED");
