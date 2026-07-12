/* Multiplayer game flow: lobby + leader gate, mid-run joins spectate,
   last-player-standing wins, scores rank the leaderboard, leader-only
   restart returns to the lobby, leadership passes on leave.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import {
  METER_MAX,
  SCORE_HAND_PLAYED,
  SCORE_HAND_WON,
} from "../src/constants";
import type { PlayerSnap, ViceKind } from "../src/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

const sim = await Simulation.create(4242);
const P1 = "p1";
const P2 = "p2";
const P3 = "p3";

const player = (id: string): PlayerSnap => sim.snapshot().players.find((p) => p.id === id)!;

/* ---- lobby + leader gate ---- */
sim.applyIntent(P1, { type: "join", name: "LEADER" });
sim.applyIntent(P2, { type: "join", name: "FOLLOWER" });
let snap = sim.snapshot();
assert(snap.players.length === 2, "two players seated");
assert(snap.phase === "lobby", "joins accumulate in the lobby, no auto-start");
assert(snap.leaderId === P1, "first joiner is the leader");

sim.applyIntent(P2, { type: "startGame" });
snap = sim.snapshot();
assert(snap.phase === "lobby", "non-leader cannot start the game");
assert(snap.startsIn === null, "non-leader cannot queue the countdown either");

/* ---- leader's start queues a countdown, not an instant start ---- */
sim.applyIntent(P1, { type: "startGame" });
snap = sim.snapshot();
assert(snap.phase === "lobby" && snap.startsIn !== null, "leader's start opens the countdown");
assert(Math.ceil(snap.startsIn!) === 10, "countdown opens at 10 seconds");
sim.applyIntent(P1, { type: "startGame" });
assert(Math.ceil(sim.snapshot().startsIn!) === 10, "a second press doesn't reset the clock");
for (let i = 0; i < 60 * 11 && sim.snapshot().phase === "lobby"; i++) sim.step();
snap = sim.snapshot();
assert(snap.phase === "betting", "countdown expires and the game starts for everyone");
assert(snap.startsIn === null, "countdown clears once the run begins");
assert(snap.players.every((p) => !p.waiting), "all lobby players are dealt in");

/* ---- one full hand: both bet, both stand; scores accrue ---- */
for (const id of [P1, P2]) {
  sim.applyIntent(id, { type: "setBet", amount: 50 });
  sim.applyIntent(id, { type: "commitBet" });
}
for (let i = 0; i < 60 * 30; i++) {
  sim.step();
  const s = sim.snapshot();
  if (s.phase === "acting" && s.turnPlayerId) sim.applyIntent(s.turnPlayerId, { type: "stand" });
  if (s.phase === "betting" && s.handsPlayed === 1) break;
}
snap = sim.snapshot();
assert(snap.handsPlayed === 1 && snap.phase === "betting", "hand settled, table back to betting");
for (const p of snap.players) {
  const expected = SCORE_HAND_PLAYED + p.stats.handsWon * SCORE_HAND_WON;
  assert(
    p.score === expected,
    `${p.name} scored the hand: ${p.score} (won=${p.stats.handsWon})`
  );
}

/* ---- mid-run join spectates, untouched by meters and intents ---- */
sim.applyIntent(P3, { type: "join", name: "LATECOMER" });
assert(player(P3).waiting, "mid-run join waits for the next game");
sim.applyIntent(P3, { type: "consumeStart", kind: "beer" });
for (let i = 0; i < 60 * 2; i++) sim.step();
const late = player(P3);
assert(late.ritual === null, "spectator intents are ignored");
assert(late.cigarMeter === METER_MAX && late.beerMeter === METER_MAX, "spectator meters frozen");

/* ---- last player standing: P1 keeps the rituals up, P2 goes dry ---- */
const flingHeld = (id: string, itemId: number) =>
  sim.applyIntent(id, {
    type: "fling",
    itemId,
    origin: { x: 0, y: 1.3, z: 1.6 },
    vel: { x: 1.2, y: 2.5, z: -5 },
    angVel: { x: 6, y: 2, z: 4 },
  });

let ticks = 0;
while (sim.snapshot().phase !== "over" && ticks < 60 * 120) {
  const me = player(P1);
  if (me.held) flingHeld(P1, me.held.id);
  else if (!me.ritual && Math.min(me.cigarMeter, me.beerMeter) < 60) {
    const kind: ViceKind = me.cigarMeter < me.beerMeter ? "cigar" : "beer";
    if ((kind === "cigar" ? me.cigarInv : me.beerInv) < 1)
      sim.applyIntent(P1, { type: "buy", item: kind, qty: 5 });
    sim.applyIntent(P1, { type: "consumeStart", kind });
    sim.applyIntent(P1, { type: "ritualEngage", on: true });
  }
  sim.step();
  ticks++;
}
snap = sim.snapshot();
assert(snap.phase === "over", "run ended (a meter hit zero)");
const winner = player(P1);
const corpse = player(P2);
assert(winner.alive, "the ritual-keeper survived");
assert(!corpse.alive && corpse.causeOfDeath !== null, "the idle player died of sobriety");
assert(snap.winnerId === P1, "last degenerate standing is the winner");
assert(winner.stats.cigarsSmoked + winner.stats.beersDrunk > 0, "winner consumed vices");
assert(winner.score > corpse.score, "vices + litter outrank a corpse on the leaderboard");

/* ---- restart is leader-only and returns to the lobby ---- */
sim.applyIntent(P2, { type: "restart" });
assert(sim.snapshot().phase === "over", "non-leader cannot restart");
sim.applyIntent(P1, { type: "restart" });
snap = sim.snapshot();
assert(snap.phase === "lobby", "leader restart returns everyone to the lobby");
assert(
  snap.players.every((p) => p.alive && !p.waiting && p.score === 0),
  "all three reset and seated for the next run"
);
assert(snap.winnerId === null, "winner cleared for the next run");

/* ---- leadership passes on leave ---- */
sim.applyIntent(P1, { type: "leave" });
snap = sim.snapshot();
assert(snap.leaderId === P2, "leadership passes down the join order");
assert(snap.players.length === 2, "seat freed");

console.log("\nALL LOBBY TESTS PASSED");
