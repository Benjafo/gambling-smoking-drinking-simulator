/* Headless end-to-end drive of the authoritative sim:
   join → bet → play a full hand → smoke a cigar → fling the butt → settle.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import { handValue } from "../src/blackjack";
import { seatEye, LOOK_PITCH_MIN, LOOK_YAW_LIMIT, MAX_FLING_SPEED } from "../src/constants";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

const sim = await Simulation.create(1234);
const ME = "p1";

/* the waiting room comes pre-seeded with litter and toys — den-side
   assertions must not count them */
type Snap = ReturnType<typeof sim.snapshot>;
const denDebris = (s: Snap) => s.debris.filter((d) => d.room === "den");

sim.applyIntent(ME, { type: "join", name: "TESTER" });
let snap = sim.snapshot();
assert(snap.players.length === 1, "player joined");
assert(snap.phase === "lobby", "room waits in the lobby");
assert(snap.leaderId === ME, "first joiner leads the lobby");

sim.applyIntent(ME, { type: "startGame" });
for (let i = 0; i < 60 * 11 && sim.snapshot().phase === "lobby"; i++) sim.step(); // ride out the start countdown
snap = sim.snapshot();
assert(snap.phase === "betting", "leader start enters betting");

// look direction: mirrored to snapshots, clamped server-side
sim.applyIntent(ME, { type: "look", yaw: 9, pitch: -9 });
snap = sim.snapshot();
assert(
  snap.players[0].look.yaw === LOOK_YAW_LIMIT && snap.players[0].look.pitch === LOOK_PITCH_MIN,
  "look intent mirrored and clamped"
);
sim.applyIntent(ME, { type: "look", yaw: 0.4, pitch: 0.1 });
assert(sim.snapshot().players[0].look.yaw === 0.4, "look tracks in real time");

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

// drag wind-up is networked: the sim mirrors the held position for other
// players, clamped to arm's reach of the seat
sim.applyIntent(ME, { type: "heldMove", pos: { x: 9, y: 9, z: 9 } });
const dragPos = sim.snapshot().players[0].held!.pos!;
const eye = seatEye(2); // first joiner takes the middle seat
assert(
  Math.hypot(dragPos.x - eye.x, dragPos.y - eye.y, dragPos.z - eye.z) <= 1.21,
  "dragged empty clamped to arm's reach"
);
sim.applyIntent(ME, { type: "heldMove", pos: null });
assert(sim.snapshot().players[0].held!.pos === null, "drag release resets the held pos");

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
const flingEv = snap.events.find((e) => e.t === "fling");
assert(
  flingEv?.t === "fling" &&
    Math.hypot(flingEv.vel.x, flingEv.vel.y, flingEv.vel.z) > 0.5 &&
    Math.hypot(flingEv.vel.x, flingEv.vel.y, flingEv.vel.z) <= MAX_FLING_SPEED + 1e-6,
  "fling event carries the clamped throw velocity"
);
const denAfterFling = denDebris(snap);
assert(denAfterFling.length === 1 && denAfterFling[0].phase === "flying", "debris body flying");

// let physics run until it settles; the litter payout must land mid-clatter
// (a beat after first impact), NOT at settle
let settled = false;
let litterWhileFlying = false;
let litterSeen = false;
for (let i = 0; i < 60 * 20; i++) {
  sim.step();
  const s = sim.snapshot();
  const d = denDebris(s)[0];
  if (s.events.some((e) => e.t === "litter")) {
    litterSeen = true;
    litterWhileFlying = !!d && d.phase === "flying";
  }
  if (d && d.phase === "settled") {
    settled = true;
    break;
  }
}
snap = sim.snapshot();
assert(settled, "debris settled and froze");
assert(litterSeen, "earned fling scored litter points");
assert(litterWhileFlying, "litter fires shortly after first impact, before settling");
const rested = denDebris(snap)[0];
assert(rested.pos.y > -5, "debris rests in-bounds at y=" + rested.pos.y.toFixed(2));

// pick the settled butt back up — it landed across the room, still in reach
sim.applyIntent(ME, { type: "pickup", itemId: rested.id });
sim.step();
snap = sim.snapshot();
assert(snap.players[0].held?.kind === "cigar", "settled debris picked back up from afar");
assert(denDebris(snap).length === 0, "picked-up debris left the world");

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
// a gentle lob rolls on clean felt contacts for a good while before the
// settle policy trips — give it room
for (let i = 0; i < 60 * 10; i++) sim.step();
snap = sim.snapshot();
const buttOnFloor = denDebris(snap).find((d) => d.kind === "cigar" && d.phase === "settled");
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
const flying = denDebris(snap).find((d) => d.kind === "beer" && d.phase === "flying");
assert(flying !== undefined, "bottle airborne");
sim.applyIntent(ME, { type: "pickup", itemId: flying!.id });
sim.step();
snap = sim.snapshot();
assert(snap.players[0].held?.kind === "beer", "snatched the bottle mid-flight");
assert(!snap.debris.some((d) => d.id === flying!.id), "mid-flight body removed from the world");

// hands full blocks the next ritual — no auto-drop, fling it yourself
sim.applyIntent(ME, { type: "consumeStart", kind: "beer" });
sim.step();
assert(sim.snapshot().players[0].ritual === null, "ritual refused while hands are full");
const snatched = sim.snapshot().players[0].held!;
sim.applyIntent(ME, {
  type: "fling",
  itemId: snatched.id,
  origin: { x: 0, y: 1.3, z: 1.6 },
  vel: { x: -1, y: 2, z: -4 },
  angVel: { x: 2, y: 1, z: 2 },
});
sim.step();
assert(sim.snapshot().players[0].held === null, "hand cleared by the fling");

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
const bottle = denDebris(snap).find((d) => d.kind === "beer");
assert(bottle !== undefined, "bottle spawned");

console.log("\nALL SIM SMOKE TESTS PASSED");
