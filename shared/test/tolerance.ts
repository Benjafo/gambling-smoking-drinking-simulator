/* Tolerance: every vice finished builds tolerance for that vice — refills
   shrink toward TOLERANCE_FILL_FLOOR and that meter drains faster, so the
   comfortable early loop tightens as the run goes on. Tolerance starts at 0,
   never decays on its own, and resets only with the run.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import {
  METER_MAX,
  TOLERANCE_MAX,
  TOLERANCE_PER_USE,
  TOLERANCE_FILL_FLOOR,
  TOLERANCE_DRAIN_BONUS,
} from "../src/constants";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

const sim = await Simulation.create(4242);
const ME = "p1";

sim.applyIntent(ME, { type: "join", name: "LUSH" });
sim.applyIntent(ME, { type: "startGame" });

const me = () => sim.snapshot().players[0];
const raw = () => sim.players.get(ME)!;

assert(me().cigarTol === 0 && me().beerTol === 0, "tolerance starts at zero");

/* drink one beer: ritual through, then fling the empty so hands free up */
function drinkBeer(): void {
  const p = raw();
  if (p.beerInv < 1) p.beerInv = 5; // stocked by rig, not by shop — no money noise
  sim.applyIntent(ME, { type: "consumeStart", kind: "beer" });
  sim.applyIntent(ME, { type: "ritualEngage", on: true });
  for (let i = 0; i < 60 * 5 && !me().held; i++) sim.step();
  const held = me().held;
  assert(held !== null, "beer ritual completed");
  sim.applyIntent(ME, {
    type: "fling",
    itemId: held!.id,
    origin: { x: 0, y: 1.3, z: 1.6 },
    vel: { x: 1, y: 2, z: -4 },
    angVel: { x: 3, y: 1, z: 2 },
  });
  sim.step();
}

/* ---- first use: full-strength refill, tolerance ratchets once ---- */
raw().beerMeter = 40;
drinkBeer();
assert(me().beerMeter > 99, "at zero tolerance one beer fills the whole bar");
assert(me().beerTol === TOLERANCE_PER_USE, "one beer = one tolerance step");
assert(me().cigarTol === 0, "cigar tolerance untouched by beer");

/* ---- max it out: refill lands at the floor, never past the cap ---- */
for (let i = 0; me().beerTol < TOLERANCE_MAX && i < 30; i++) drinkBeer();
assert(me().beerTol === TOLERANCE_MAX, "tolerance caps at TOLERANCE_MAX");
raw().beerMeter = 10;
drinkBeer();
const flooredFill = me().beerMeter - 10;
const expected = METER_MAX * TOLERANCE_FILL_FLOOR;
// the meter keeps draining through the ~2s ritual, so the net gain lands a
// touch under the floor — never over it
assert(
  flooredFill > expected - 15 && flooredFill < expected + 1,
  `maxed tolerance fills ~${expected} of the bar (got ${flooredFill.toFixed(1)})`
);

/* ---- drain scales with tolerance: measure both meters over the same
   window (beer tolerance maxed, cigar still zero) ---- */
{
  const p = raw();
  p.beerMeter = METER_MAX;
  p.cigarMeter = METER_MAX;
  for (let i = 0; i < 60 * 5; i++) {
    // pin the random drift each tick so the ratio isolates the tolerance
    // multiplier (the step still adds one tick of wobble, ~5%)
    p.beerDrift = 0;
    p.cigarDrift = 0;
    sim.step();
  }
  const ratio = (METER_MAX - p.beerMeter) / (METER_MAX - p.cigarMeter);
  const want = 1 + TOLERANCE_DRAIN_BONUS;
  assert(
    ratio > want - 0.15 && ratio < want + 0.15,
    `maxed meter drains ~${want.toFixed(2)}x faster (got ${ratio.toFixed(2)}x)`
  );
}

/* ---- tolerance is in the snapshot for the HUD ---- */
assert(
  me().beerTol === TOLERANCE_MAX && me().cigarTol === 0,
  "snapshot carries per-vice tolerance"
);

/* ---- a new run wipes the slate ---- */
raw().cigarMeter = 1e-6; // die of sobriety to reach the over screen
raw().beerMeter = 1e-6;
sim.step();
assert(sim.snapshot().phase === "over", "run over");
sim.applyIntent(ME, { type: "restart" });
assert(
  me().beerTol === 0 && me().cigarTol === 0,
  "restart resets tolerance with everything else"
);

console.log("\nALL TOLERANCE TESTS PASSED");
