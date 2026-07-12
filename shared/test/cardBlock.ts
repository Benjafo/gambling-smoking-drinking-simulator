/* Card colliders: dealt hands exist physically. Litter settled where the
   deal lands gets popped on top of the cards instead of the cards clipping
   through it, and a cleared hand un-freezes whatever was resting on it so
   it drops back to the felt. Deterministic under the fixed seed.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import {
  TABLE,
  HAND_ANCHOR_R,
  PLAYER_CARD_SCALE,
  PLAYER_CARD_LEAN,
  CARD_LIFT,
  cardSlot,
  seatAngle,
  seatEye,
  seatTablePoint,
} from "../src/constants";
import type { Snapshot } from "../src/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

const sim = await Simulation.create(1337);
const A = "p1";
const B = "p2";

sim.applyIntent(A, { type: "join", name: "LITTERBUG" });
sim.applyIntent(B, { type: "join", name: "BYSTANDER" });
sim.applyIntent(A, { type: "startGame" }); // -> betting (after the countdown), hands still empty
for (let i = 0; i < 60 * 11 && sim.snapshot().phase === "lobby"; i++) sim.step(); // ride out the start countdown

const snap = (): Snapshot => sim.snapshot();
const me = () => snap().players.find((q) => q.id === A)!;
const mySeat = me().seat;

/* where A's first two cards will land once dealt */
const a = seatTablePoint(mySeat, HAND_ANCHOR_R);
const anchor = { x: a.x, y: a.y + CARD_LIFT, z: a.z };
const slots = [0, 1].map(
  (i) => cardSlot(anchor, seatAngle(mySeat), i, PLAYER_CARD_SCALE, PLAYER_CARD_LEAN).pos
);
const nearSlot = (p: { x: number; y: number; z: number }) =>
  slots.some((s) => Math.hypot(p.x - s.x, p.z - s.z) < 0.13 && Math.abs(p.y - s.y) < 0.25);

function ritualUntilHeld(): { id: number } {
  if (me().beerInv < 1) sim.applyIntent(A, { type: "buy", item: "beer", qty: 1 });
  sim.applyIntent(A, { type: "consumeStart", kind: "beer" });
  sim.applyIntent(A, { type: "ritualEngage", on: true });
  for (let i = 0; i < 60 * 5 && !me().held; i++) sim.step();
  const held = me().held;
  assert(held !== null, "ritual produced a held beer empty");
  return held!;
}

function stepUntilAllSettled(): void {
  for (let i = 0; i < 60 * 30; i++) {
    sim.step();
    const s = snap();
    if (!s.debris.some((d) => d.phase === "flying") && !me().held) return;
  }
  assert(false, "debris settled in time");
}

/* drop an empty gently onto a point on the felt: reach toward a spot above
   the target (fling clamps the origin to arm's length anyway) and solve the
   short ballistic hop — thrown flat and hard it skids off the zone */
function lobOnto(target: { x: number; y: number; z: number }): void {
  const held = ritualUntilHeld();
  const eye = seatEye(mySeat);
  const above = { x: target.x, y: target.y + 0.9, z: target.z };
  const dir = { x: above.x - eye.x, y: above.y - eye.y, z: above.z - eye.z };
  const len = Math.hypot(dir.x, dir.y, dir.z);
  const o = { x: eye.x + dir.x / len, y: eye.y + dir.y / len, z: eye.z + dir.z / len };
  const T = 0.5;
  sim.applyIntent(A, {
    type: "fling",
    itemId: held.id,
    origin: o,
    vel: {
      x: (target.x - o.x) / T,
      y: (target.y - o.y) / T + 4.905 * T,
      z: (target.z - o.z) / T,
    },
    angVel: { x: 0.5, y: 0, z: 0.5 },
  });
  stepUntilAllSettled();
}

/* ---- litter the landing zone while the felt is still bare ---- */
for (const s of slots) lobOnto(s);
const inZone = snap()
  .debris.filter((d) => d.phase === "settled" && nearSlot(d.pos))
  .map((d) => d.id);
assert(inZone.length > 0, "at least one settled empty rests where the deal will land");

/* ---- deal: cards appearing under settled litter pop it on top ---- */
sim.applyIntent(A, { type: "setBet", amount: 10 });
sim.applyIntent(A, { type: "commitBet" });
sim.applyIntent(B, { type: "setBet", amount: 10 });
sim.applyIntent(B, { type: "commitBet" }); // all committed -> dealing starts

let lifted = false;
let maxY = 0;
for (let i = 0; i < 60 * 10 && snap().phase === "dealing"; i++) {
  sim.step();
  for (const d of snap().debris)
    if (inZone.includes(d.id) && d.phase === "flying") {
      lifted = true;
      maxY = Math.max(maxY, d.pos.y);
    }
}
assert(lifted, "a card dealt under settled litter un-freezes it");
assert(maxY >= TABLE.height + 0.14, "the deal pops the litter up on top of the cards");
stepUntilAllSettled();
assert(
  snap().debris.every((d) => !inZone.includes(d.id) || d.phase === "settled"),
  "the popped litter comes back to rest"
);

/* ---- bury the dealt hand: a fresh lob grips the cards it lands on ---- */
const before = new Set(snap().debris.map((d) => d.id));
lobOnto(slots[1]);
const onCard = snap().debris.find(
  (d) => !before.has(d.id) && d.phase === "settled" && nearSlot(d.pos)
);
assert(onCard !== undefined, "an empty lobbed at a dealt hand comes to rest on it");
assert(
  onCard!.pos.y >= slots[0].y + 0.01,
  "it rests ON the cards, above felt height — not clipped through them"
);

/* ---- play the round out, then clear the hand: litter drops back ---- */
for (let i = 0; i < 60 * 60 && snap().phase !== "betting"; i++) {
  const s = snap();
  if (s.phase === "acting" && s.turnPlayerId) sim.applyIntent(s.turnPlayerId, { type: "stand" });
  sim.step();
}
assert(snap().phase === "betting", "round played out back to betting");

sim.applyIntent(A, { type: "setBet", amount: 10 });
sim.applyIntent(A, { type: "commitBet" }); // clears A's hand -> colliders gone
let dropped = false;
for (let i = 0; i < 60 * 2 && !dropped; i++) {
  sim.step();
  dropped = snap().debris.some((d) => d.id === onCard!.id && d.phase === "flying");
}
assert(dropped, "clearing the hand un-freezes litter that rested on it");
stepUntilAllSettled();
const after = snap().debris.find((d) => d.id === onCard!.id);
assert(
  after !== undefined && after.pos.y < onCard!.pos.y - 0.005,
  "dropped litter comes to rest lower, back on the felt"
);

assert(me().alive, "litterbug survived the whole test (assertions weren't vacuous)");

console.log("\nALL CARD BLOCK TESTS PASSED");
