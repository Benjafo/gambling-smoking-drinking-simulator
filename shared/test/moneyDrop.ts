/* Littering rules: an empty flung fresh from a ritual scores litter points
   exactly once, a beat after its first impact; the money payout rolls once
   at settle. Scavenged (picked-up) litter never pays either way. There is
   no auto-drop — the empty stays in hand, blocking the next vice, until the
   player flings it. Deterministic under the fixed seed.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import {
  LITTER_POINTS,
  METER_MAX,
  MONEY_DROP_MIN,
  MONEY_DROP_MAX,
  START_MONEY,
} from "../src/constants";
import type { Snapshot } from "../src/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

const sim = await Simulation.create(777);
const ME = "p1";

/* snapshot() drains the event queue, so every snapshot flows through here */
const drops: { amount: number }[] = [];
const litters: { points: number }[] = [];
function snap(): Snapshot {
  const s = sim.snapshot();
  for (const ev of s.events) {
    if (ev.t === "moneyDrop") drops.push({ amount: ev.amount });
    if (ev.t === "litter") litters.push({ points: ev.points });
  }
  return s;
}

sim.applyIntent(ME, { type: "join", name: "LITTERBUG" });
sim.applyIntent(ME, { type: "startGame" });
for (let i = 0; i < 60 * 11 && sim.snapshot().phase === "lobby"; i++) sim.step(); // ride out the start countdown

let spent = 0;
function me() {
  return snap().players[0];
}

/* life support: tolerance makes a run this long fatal by design — refills
   shrink and drain speeds up with every vice. This suite is about littering,
   so the guinea pig's meters get pinned instead of tuned around. */
function lifeSupport(): void {
  const p = sim.players.get(ME)!;
  p.cigarMeter = METER_MAX;
  p.beerMeter = METER_MAX;
}

/* ritual → hold the empty; returns the held item. Alternates vices the way
   the pre-tolerance meters used to force. */
let nextKind: "cigar" | "beer" = "beer";
function ritualUntilHeld(): { id: number } {
  lifeSupport();
  let m = me();
  const kind = nextKind;
  nextKind = kind === "beer" ? "cigar" : "beer";
  const inv = kind === "cigar" ? m.cigarInv : m.beerInv;
  if (inv < 1) {
    const s = snap();
    spent += (kind === "cigar" ? s.cigarPrice : s.beerPrice) * 5;
    sim.applyIntent(ME, { type: "buy", item: kind, qty: 5 });
  }
  sim.applyIntent(ME, { type: "consumeStart", kind });
  sim.applyIntent(ME, { type: "ritualEngage", on: true });
  for (let i = 0; i < 60 * 5 && !me().held; i++) sim.step();
  m = me();
  assert(m.held !== null, `ritual produced a held ${kind} empty`);
  return m.held!;
}

/* deterministic spread: identical fling vectors pile every empty into one
   pocket, where a new arrival can rattle between its frozen neighbors past
   any settle timeout */
let flingN = 0;
function flingHeld(id: number): void {
  const j = (flingN++ % 7) - 3;
  sim.applyIntent(ME, {
    type: "fling",
    itemId: id,
    origin: { x: 0, y: 1.3, z: 1.6 },
    vel: { x: 1.2 + j * 0.4, y: 2.5, z: -5 + Math.abs(j) * 0.3 },
    angVel: { x: 6, y: 2, z: 4 },
  });
}

function stepUntilAllSettled(): void {
  for (let i = 0; i < 60 * 30; i++) {
    lifeSupport();
    sim.step();
    const s = snap();
    if (!s.debris.some((d) => d.phase === "flying") && !s.players[0].held) return;
  }
  const s = snap();
  console.error(
    "stuck:",
    JSON.stringify({
      held: s.players[0].held,
      flying: s.debris.filter((d) => d.phase === "flying"),
      alive: s.players[0].alive,
    })
  );
  assert(false, "debris settled in time");
}

/* ---- earned flings: the variable-ratio payout fires under this seed ---- */
const CYCLES = 40;
for (let i = 0; i < CYCLES; i++) {
  const held = ritualUntilHeld();
  flingHeld(held.id);
  stepUntilAllSettled();
}
console.log(`     ${drops.length} drops over ${CYCLES} earned flings`);
assert(drops.length >= 1, "at least one money drop over " + CYCLES + " earned flings");
assert(litters.length === CYCLES, "every earned fling scored litter points exactly once");
assert(
  litters.every((l) => l.points === LITTER_POINTS),
  "litter events carry LITTER_POINTS"
);
assert(
  drops.every((d) => d.amount >= MONEY_DROP_MIN && d.amount <= MONEY_DROP_MAX),
  "drop amounts within [MIN, MAX]"
);
const earnedTotal = drops.reduce((n, d) => n + d.amount, 0);
assert(
  me().money === START_MONEY - spent + earnedTotal,
  "money = start - purchases + drops (payout actually credited)"
);

/* ---- scavenged litter never pays: pick up + refling, repeatedly ----
   Each iteration first runs a maintenance ritual (keeps the meters alive;
   its earned empty is flung and fully settled — those may legitimately
   drop), so the scavenged item is the only thing settling in the asserted
   window. */
for (let i = 0; i < 8; i++) {
  const upkeep = ritualUntilHeld();
  flingHeld(upkeep.id);
  stepUntilAllSettled();

  const before = { count: drops.length, litters: litters.length, money: me().money };
  const target = snap().debris.find((d) => d.phase === "settled");
  assert(target !== undefined, "settled litter available to scavenge");
  sim.applyIntent(ME, { type: "pickup", itemId: target!.id });
  sim.step();
  const held = me().held;
  assert(held !== null, "scavenged litter in hand");
  flingHeld(held!.id);
  stepUntilAllSettled();
  assert(drops.length === before.count, "re-flung floor litter never rolls a drop");
  assert(litters.length === before.litters, "re-flung floor litter scores no points");
  assert(me().money === before.money, "no money credited for the scavenged fling");
}

/* ---- no auto-drop: the empty stays in hand until the player deals with it,
   and hands-full blocks the next ritual ---- */
const heldForever = ritualUntilHeld();
for (let i = 0; i < 60 * 10; i++) {
  lifeSupport();
  sim.step(); // 10 simulated seconds
}
assert(
  me().held !== null && me().held!.id === heldForever.id,
  "held empty persists indefinitely — no auto-drop"
);
sim.applyIntent(ME, { type: "buy", item: "cigar", qty: 1 });
spent += snap().cigarPrice;
sim.applyIntent(ME, { type: "consumeStart", kind: "cigar" });
sim.step();
assert(me().ritual === null, "ritual refused while holding an empty");
flingHeld(heldForever.id);
stepUntilAllSettled();
assert(me().held === null, "fling finally clears the hand");

assert(me().alive, "player survived the whole test (assertions weren't vacuous)");

console.log("\nALL MONEY DROP TESTS PASSED");
