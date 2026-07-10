/* Final standings rules: the survivor is #1 no matter what the scoreboard
   says; everyone else follows the run-quality cascade (score, then hands
   won, peak money, direct hits, litter, hands played, vices, longevity,
   seat). A dead heat — the last players falling on the same tick — goes to
   the better run by the same cascade, never to iteration order or chance.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import { seatEye, seatPosition } from "../src/constants";
import type { Snapshot } from "../src/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

/* ---- the survivor outranks a richer corpse ----
   KEEPER nurses both meters with the occasional vice; SPRAYER chain-drinks
   and beans KEEPER with every empty, racking a far higher score — but never
   smokes, and dies of cigar withdrawal. Survival must still win. */
{
  const sim = await Simulation.create(2026);
  const KEEPER = "p1";
  const SPRAYER = "p2";
  sim.applyIntent(KEEPER, { type: "join", name: "KEEPER" });
  sim.applyIntent(SPRAYER, { type: "join", name: "SPRAYER" });
  sim.applyIntent(KEEPER, { type: "startGame" });

  let snap: Snapshot = sim.snapshot();
  const player = (id: string) => snap.players.find((p) => p.id === id)!;
  const aimAt = (fromSeat: number, toSeat: number) => {
    const eye = seatEye(fromSeat);
    const t = seatPosition(toSeat);
    const d = { x: t.x - eye.x, y: 1.3 - eye.y, z: t.z - eye.z };
    const len = Math.hypot(d.x, d.y, d.z);
    return { x: (d.x / len) * 8, y: (d.y / len) * 8, z: (d.z / len) * 8 };
  };

  for (let i = 0; i < 60 * 120 && snap.phase !== "over"; i++) {
    sim.step();
    if (i % 10 !== 0) continue;
    snap = sim.snapshot();

    const k = player(KEEPER);
    if (k.alive) {
      if (k.held) {
        // harmless litter: hurled at the empty seats, away from SPRAYER
        sim.applyIntent(KEEPER, {
          type: "fling",
          itemId: k.held.id,
          origin: seatEye(k.seat),
          vel: { x: 4, y: 1.5, z: -2 },
          angVel: { x: 4, y: 1, z: 2 },
        });
      } else if (!k.ritual && (k.cigarMeter < 55 || k.beerMeter < 55)) {
        const kind = k.cigarMeter < k.beerMeter ? "cigar" : "beer";
        sim.applyIntent(KEEPER, { type: "buy", item: kind, qty: 1 });
        sim.applyIntent(KEEPER, { type: "consumeStart", kind });
        sim.applyIntent(KEEPER, { type: "ritualEngage", on: true });
      }
    }

    const s = player(SPRAYER);
    if (s.alive) {
      if (s.held) {
        sim.applyIntent(SPRAYER, {
          type: "fling",
          itemId: s.held.id,
          origin: seatEye(s.seat),
          vel: aimAt(s.seat, k.seat),
          angVel: { x: 4, y: 1, z: 2 },
        });
      } else if (!s.ritual) {
        sim.applyIntent(SPRAYER, { type: "buy", item: "beer", qty: 1 });
        sim.applyIntent(SPRAYER, { type: "consumeStart", kind: "beer" });
        sim.applyIntent(SPRAYER, { type: "ritualEngage", on: true });
      }
    }
  }
  snap = sim.snapshot();

  assert(snap.phase === "over", "run ended (the sprayer drank itself to death)");
  const keeper = player(KEEPER);
  const sprayer = player(SPRAYER);
  assert(keeper.alive && !sprayer.alive, "keeper survived, sprayer did not");
  assert(sprayer.score > keeper.score, "the corpse out-scored the survivor");
  assert(snap.winnerId === KEEPER, "survivor takes the crown");
  assert(snap.standings[0] === KEEPER, "winner is #1 in standings despite the lower score");
  assert(snap.standings[1] === SPRAYER, "runner-up follows");
  assert(sprayer.stats.directHits >= 3, "sprayer's direct hits counted (stat tracked)");
  assert(sprayer.stats.litters >= 3, "sprayer's litter counted (stat tracked)");
  assert(keeper.stats.directHits === 0, "keeper threw at nobody");
}

/* ---- dead heats: organic same-tick deaths are seed-luck (per-player meter
   drift), so force the clock — zero both cigar meters on the same tick ---- */
async function deadHeat(
  rig: (a: any, b: any) => void
): Promise<{ winnerId: string | null; standings: string[]; phase: string }> {
  const sim = await Simulation.create(31337);
  sim.applyIntent("a", { type: "join", name: "A" });
  sim.applyIntent("b", { type: "join", name: "B" });
  sim.applyIntent("a", { type: "startGame" });
  const A = sim.players.get("a")!;
  const B = sim.players.get("b")!;
  rig(A, B);
  A.cigarMeter = 1e-6;
  B.cigarMeter = 1e-6;
  sim.step();
  const snap = sim.snapshot();
  if (A.alive || B.alive) {
    console.error("FAIL: dead heat rig did not kill both on one tick");
    process.exit(1);
  }
  return { winnerId: sim.winnerId, standings: snap.standings, phase: sim.phase };
}

{
  // A sits first in map-iteration order; the old mid-loop crowning would have
  // handed the win to B (last corpse standing for one iteration). Give A the
  // better run: the cascade, not the iteration accident, must decide.
  const r = await deadHeat((A) => {
    A.score += 35;
    A.stats.handsPlayed++;
    A.stats.handsWon++;
  });
  assert(r.phase === "over", "dead heat ends the run");
  assert(r.winnerId === "a", "dead heat goes to the better score");
  assert(r.standings[0] === "a" && r.standings[1] === "b", "standings match the tie ruling");
}

{
  // equal scores: peak money breaks the tie (money earned matters)
  const r = await deadHeat((A, B) => {
    B.stats.peakMoney += 500;
  });
  assert(r.winnerId === "b", "equal scores: deeper peak pockets win the dead heat");
}

{
  // all equal: seat index is the total-order backstop — never a null winner
  const r = await deadHeat(() => {});
  assert(r.winnerId !== null, "a dead heat always crowns someone");
  assert(r.winnerId === "b", "identical runs fall back to seat order (b holds seat 1)");
}

console.log("\nALL STANDINGS TESTS PASSED");
