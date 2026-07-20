/* Direct-hit rules: a flung empty that beans another player before touching
   anything pays the flinger SCORE_PLAYER_HIT exactly once, on top of the
   normal litter payout; misses and self-flings pay nothing extra. An EARNED
   empty (fresh off the thrower's ritual) also burns HIT_METER_LOSS off the
   victim's matching meter; scavenged floor trash hits score but don't burn.
   Deterministic under the fixed seed.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import {
  SCORE_PLAYER_HIT,
  LITTER_POINTS,
  HIT_METER_LOSS,
  seatEye,
  seatPosition,
} from "../src/constants";
import type { Snapshot, SimEvent } from "../src/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

const sim = await Simulation.create(4242);
const FLINGER = "p1";
const VICTIM = "p2";

/* snapshot() drains the event queue, so every snapshot flows through here */
const hits: Extract<SimEvent, { t: "playerHit" }>[] = [];
const litters: { points: number }[] = [];
function snap(): Snapshot {
  const s = sim.snapshot();
  for (const ev of s.events) {
    if (ev.t === "playerHit") hits.push(ev);
    if (ev.t === "litter") litters.push({ points: ev.points });
  }
  return s;
}

sim.applyIntent(FLINGER, { type: "join", name: "PITCHER" });
sim.applyIntent(VICTIM, { type: "join", name: "TARGET" });
sim.applyIntent(FLINGER, { type: "startGame" });
for (let i = 0; i < 60 * 11 && sim.snapshot().phase === "lobby"; i++) sim.step(); // ride out the start countdown

function me(): Snapshot["players"][number] {
  return snap().players.find((q) => q.id === FLINGER)!;
}

function victim(): Snapshot["players"][number] {
  return snap().players.find((q) => q.id === VICTIM)!;
}

/* run the flight only — stop the moment the hit registers, so meter reads
   aren't polluted by long settle-time passive drain */
function stepUntilHit(prevHits: number): void {
  for (let i = 0; i < 60 * 3 && hits.length === prevHits; i++) {
    sim.step();
    snap(); // drains the event queue into `hits`
  }
  assert(hits.length === prevHits + 1, "the fling connected mid-flight");
}

/* both meters drain passively (with independent drift) while the empty
   flies; the beer meter alone additionally eats the hit, so the drop
   DIFFERENCE isolates the hit's effect to within drift slop */
function hitBurn(before: { cigar: number; beer: number }): number {
  const v = victim();
  return before.beer - v.beerMeter - (before.cigar - v.cigarMeter);
}

const mySeat = me().seat;
const victimSeat = snap().players.find((q) => q.id === VICTIM)!.seat;

/* ritual → hold the empty; returns the held item */
function ritualUntilHeld(): { id: number } {
  let m = me();
  if (m.beerInv < 1) sim.applyIntent(FLINGER, { type: "buy", item: "beer", qty: 1 });
  sim.applyIntent(FLINGER, { type: "consumeStart", kind: "beer" });
  sim.applyIntent(FLINGER, { type: "ritualEngage", on: true });
  for (let i = 0; i < 60 * 5 && !me().held; i++) sim.step();
  m = me();
  assert(m.held !== null, "ritual produced a held beer empty");
  return m.held!;
}

function fling(id: number, vel: { x: number; y: number; z: number }): void {
  sim.applyIntent(FLINGER, {
    type: "fling",
    itemId: id,
    origin: seatEye(mySeat),
    vel,
    angVel: { x: 6, y: 2, z: 4 },
  });
}

function stepUntilAllSettled(): void {
  for (let i = 0; i < 60 * 30; i++) {
    sim.step();
    const s = snap();
    if (!s.debris.some((d) => d.phase === "flying") && !me().held) return;
  }
  assert(false, "debris settled in time");
}

/* aim from the flinger's eye at the victim's torso/head */
function aimAtVictim(speed: number): { x: number; y: number; z: number } {
  const eye = seatEye(mySeat);
  const base = seatPosition(victimSeat);
  const d = { x: base.x - eye.x, y: 1.3 - eye.y, z: base.z - eye.z };
  const len = Math.hypot(d.x, d.y, d.z);
  return { x: (d.x / len) * speed, y: (d.y / len) * speed, z: (d.z / len) * speed };
}

/* ---- direct hit: bonus fires once, litter still pays independently,
   and the earned empty burns the victim's matching (beer) meter ---- */
{
  const held = ritualUntilHeld();
  const scoreBefore = me().score;
  const littersBefore = litters.length;
  const v = victim();
  const metersBefore = { cigar: v.cigarMeter, beer: v.beerMeter };
  fling(held.id, aimAtVictim(8));
  stepUntilHit(0);
  assert(
    Math.abs(hitBurn(metersBefore) - HIT_METER_LOSS) < 1,
    "an earned hit burns HIT_METER_LOSS off the victim's beer meter"
  );
  stepUntilAllSettled();

  assert(hits.length === 1, "exactly one playerHit event for a direct hit");
  assert(hits[0].flingerId === FLINGER, "playerHit credits the flinger");
  assert(hits[0].victimId === VICTIM, "playerHit names the victim");
  assert(hits[0].points === SCORE_PLAYER_HIT, "playerHit carries SCORE_PLAYER_HIT");
  assert(
    litters.length === littersBefore + 1,
    "litter payout still fires after a direct hit (independent bonuses)"
  );
  assert(
    me().score === scoreBefore + SCORE_PLAYER_HIT + LITTER_POINTS,
    "flinger scored hit bonus + litter points"
  );
}

/* ---- scavenged re-fling: the hit still scores, but settling laundered
   `earned` away, so the victim's meter is untouched ---- */
{
  // the beer empty from the last block is on the floor — latest-spawned wins
  const trash = snap()
    .debris.filter((d) => d.kind === "beer" && d.phase === "settled")
    .sort((a, b) => b.id - a.id)[0];
  assert(trash !== undefined, "the settled beer empty is on the floor");
  sim.applyIntent(FLINGER, { type: "pickup", itemId: trash.id });
  const held = me().held;
  assert(held !== null, "scavenged the settled empty off the floor");

  const scoreBefore = me().score;
  const v = victim();
  const metersBefore = { cigar: v.cigarMeter, beer: v.beerMeter };
  fling(held!.id, aimAtVictim(8));
  stepUntilHit(1);
  assert(
    Math.abs(hitBurn(metersBefore)) < 1,
    "a scavenged hit burns nothing off the victim's meters"
  );
  stepUntilAllSettled();
  assert(
    me().score === scoreBefore + SCORE_PLAYER_HIT,
    "a scavenged hit still pays the hit bonus, but no litter points"
  );
}

/* ---- miss: fling away from everyone, no bonus ---- */
{
  const held = ritualUntilHeld();
  const before = { hits: hits.length, score: me().score };
  // victim sits at -x; hurl toward the empty +x seats
  fling(held.id, { x: 5, y: 1.5, z: -2 });
  stepUntilAllSettled();
  assert(hits.length === before.hits, "a miss produces no playerHit event");
  assert(
    me().score === before.score + LITTER_POINTS,
    "a miss only earns the ordinary litter points"
  );
}

/* ---- self-hit impossible: straight up and back down onto your own head ---- */
{
  const held = ritualUntilHeld();
  const before = hits.length;
  fling(held.id, { x: 0, y: 3, z: 0 });
  stepUntilAllSettled();
  assert(hits.length === before, "a fling can never hit its own flinger");
}

assert(me().alive, "flinger survived the whole test (assertions weren't vacuous)");

console.log("\nALL PLAYER HIT TESTS PASSED");
