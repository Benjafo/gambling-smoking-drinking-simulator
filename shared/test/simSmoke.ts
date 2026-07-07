/* Headless end-to-end drive of the authoritative sim:
   join → bet → play a full hand → smoke a cigar → fling the butt → settle.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import { handValue } from "../src/blackjack";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

const sim = await Simulation.create(1234);
const ME = "p1";

sim.applyIntent(ME, { type: "join", name: "TESTER" });
let snap = sim.snapshot();
assert(snap.players.length === 1, "player joined");
assert(snap.phase === "betting", "room enters betting");

sim.applyIntent(ME, { type: "setBet", amount: 100 });
sim.applyIntent(ME, { type: "commitBet" });
snap = sim.snapshot();
assert(snap.players[0].money === 900, "bet deducted");
assert(snap.phase === "dealing", "dealing starts when all commit");

// run the deal out
for (let i = 0; i < 60 * 5 && sim.snapshot().phase === "dealing"; i++) sim.step();
snap = sim.snapshot();
assert(snap.players[0].hand.length === 2, "player has 2 cards");
assert(snap.dealerHand.length === 2, "dealer has 2 cards");

// auto-play: stand whenever it's our turn, until the round settles
let settleDealerHand = snap.dealerHand;
for (let i = 0; i < 60 * 20; i++) {
  sim.step();
  const s = sim.snapshot();
  if (s.phase === "acting" && s.turnPlayerId === ME) sim.applyIntent(ME, { type: "stand" });
  if (s.phase === "settle") settleDealerHand = s.dealerHand;
  if (s.phase === "betting" || s.phase === "over") break;
}
snap = sim.snapshot();
assert(snap.handsPlayed === 1, "one hand settled");
assert(snap.phase === "betting" || snap.phase === "over", "round returns to betting");
const dealerTotal = handValue(settleDealerHand).total;
assert(settleDealerHand.length >= 2 && dealerTotal >= 17, "dealer played out to " + dealerTotal);

// smoke a cigar: ritual accrues only while engaged, completes after 2.5s
const meterBefore = snap.players[0].cigarMeter;
sim.applyIntent(ME, { type: "consumeStart", kind: "cigar" });
for (let i = 0; i < 60; i++) sim.step(); // not engaged: no progress
assert(sim.snapshot().players[0].ritual?.progress === 0, "ritual idle until gesture engages");
sim.applyIntent(ME, { type: "ritualEngage", on: true });
for (let i = 0; i < 30; i++) sim.step();
sim.applyIntent(ME, { type: "ritualReset" }); // wobble: flame restarts
const afterReset = sim.snapshot().players[0].ritual?.progress ?? -1;
assert(afterReset >= 0 && afterReset < 0.05, "wobble resets progress");
for (let i = 0; i < 60 * 3; i++) sim.step();
snap = sim.snapshot();
assert(snap.players[0].cigarMeter > meterBefore, "cigar meter refilled");
assert(snap.players[0].cigarInv === 2, "cigar inventory decremented");
assert(snap.players[0].held?.kind === "cigar", "spent cigar is held for flinging");

// fling it across the room
const held = snap.players[0].held!;
sim.applyIntent(ME, {
  type: "fling",
  itemId: held.id,
  origin: { x: 0, y: 1.3, z: 1.6 },
  vel: { x: 1.5, y: 3, z: -6 },
  angVel: { x: 8, y: 2, z: 5 },
});
snap = sim.snapshot();
assert(snap.players[0].held === null, "hand empty after fling");
assert(snap.debris.length === 1 && snap.debris[0].phase === "flying", "debris body flying");

// let physics run until it settles
let settled = false;
for (let i = 0; i < 60 * 20; i++) {
  sim.step();
  const d = sim.snapshot().debris[0];
  if (d && d.phase === "settled") {
    settled = true;
    break;
  }
}
snap = sim.snapshot();
assert(settled, "debris settled and froze");
assert(snap.debris[0].pos.y > -5, "debris rests in-bounds at y=" + snap.debris[0].pos.y.toFixed(2));

// pick the settled butt back up — it landed across the room, still in reach
const settledId = snap.debris[0].id;
sim.applyIntent(ME, { type: "pickup", itemId: settledId });
sim.step();
snap = sim.snapshot();
assert(snap.players[0].held?.kind === "cigar", "settled debris picked back up from afar");
assert(snap.debris.length === 0, "picked-up debris left the world");

// hands-full pickup is DENIED, not swapped: drop the butt, drink a beer
// (now holding the empty bottle), then try to grab the butt
const butt = snap.players[0].held!;
sim.applyIntent(ME, {
  type: "fling",
  itemId: butt.id,
  origin: { x: 0, y: 1.2, z: 1.8 },
  vel: { x: 0, y: 0.5, z: -2 },
  angVel: { x: 1, y: 0, z: 1 },
});
for (let i = 0; i < 60 * 6; i++) sim.step();
snap = sim.snapshot();
const buttOnFloor = snap.debris.find((d) => d.kind === "cigar" && d.phase === "settled");
assert(buttOnFloor !== undefined, "butt settled again");
sim.applyIntent(ME, { type: "consumeStart", kind: "beer" });
sim.applyIntent(ME, { type: "ritualEngage", on: true });
for (let i = 0; i < 60 * 3; i++) sim.step();
assert(sim.snapshot().players[0].held?.kind === "beer", "holding the beer empty");
sim.applyIntent(ME, { type: "pickup", itemId: buttOnFloor!.id });
sim.step();
snap = sim.snapshot();
assert(snap.players[0].held?.kind === "beer", "hands-full pickup denied: still holding beer");
assert(
  snap.debris.some((d) => d.id === buttOnFloor!.id),
  "denied pickup left the butt on the floor"
);

// a rolling/flying item can be snatched mid-air
const bottleInHand = snap.players[0].held!;
sim.applyIntent(ME, {
  type: "fling",
  itemId: bottleInHand.id,
  origin: { x: 0, y: 1.3, z: 1.6 },
  vel: { x: 0.5, y: 2.5, z: -3 },
  angVel: { x: 3, y: 1, z: 2 },
});
for (let i = 0; i < 12; i++) sim.step(); // ~0.2s: definitely still airborne
snap = sim.snapshot();
const flying = snap.debris.find((d) => d.kind === "beer" && d.phase === "flying");
assert(flying !== undefined, "bottle airborne");
sim.applyIntent(ME, { type: "pickup", itemId: flying!.id });
sim.step();
snap = sim.snapshot();
assert(snap.players[0].held?.kind === "beer", "snatched the bottle mid-flight");
assert(!snap.debris.some((d) => d.id === flying!.id), "mid-flight body removed from the world");

// fling speed clamp: absurd velocity must be capped server-side
sim.applyIntent(ME, { type: "consumeStart", kind: "beer" });
sim.applyIntent(ME, { type: "ritualEngage", on: true });
for (let i = 0; i < 60 * 3; i++) sim.step();
snap = sim.snapshot();
assert(snap.players[0].held?.kind === "beer", "beer bottle held");
sim.applyIntent(ME, {
  type: "fling",
  itemId: snap.players[0].held!.id,
  origin: { x: 0, y: 1.3, z: 1.6 },
  vel: { x: 0, y: 0, z: -9999 },
  angVel: { x: 0, y: 0, z: 0 },
});
sim.step();
snap = sim.snapshot();
const bottle = snap.debris.find((d) => d.kind === "beer");
assert(bottle !== undefined, "bottle spawned");

console.log("\nALL SIM SMOKE TESTS PASSED");
