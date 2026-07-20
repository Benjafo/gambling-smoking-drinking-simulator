/* Sit-out flow: the deal fires the moment everyone alive has anted or opted
   out, the flag is sticky across rounds, an all-out table idles safely, the
   betting window still force-deals around stragglers, and mid-run spectators
   never hold up the cards.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import { METER_MAX, BETTING_WINDOW_MS, TICK_RATE } from "../src/constants";
import type { PlayerSnap } from "../src/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

const sim = await Simulation.create(1337);
const P1 = "p1";
const P2 = "p2";
const P3 = "p3";

const player = (id: string): PlayerSnap => sim.snapshot().players.find((p) => p.id === id)!;
/* the test spans minutes of sim time — keep sobriety from ending it early */
const topUp = (): void => {
  for (const p of sim.players.values()) {
    p.cigarMeter = METER_MAX;
    p.beerMeter = METER_MAX;
  }
};
/* step until the current hand settles and betting reopens */
const finishRound = (hands: number): void => {
  for (let i = 0; i < 60 * 30; i++) {
    sim.step();
    const s = sim.snapshot();
    if (s.phase === "acting" && s.turnPlayerId) sim.applyIntent(s.turnPlayerId, { type: "stand" });
    if (s.phase === "betting" && s.handsPlayed === hands) return;
  }
  assert(false, `round ${hands} never settled`);
};

/* ---- into the run ---- */
sim.applyIntent(P1, { type: "join", name: "GRINDER" });
sim.applyIntent(P2, { type: "join", name: "LITTERBUG" });
sim.applyIntent(P1, { type: "startGame" });
for (let i = 0; i < 60 * 11 && sim.snapshot().phase === "lobby"; i++) sim.step();
let snap = sim.snapshot();
assert(snap.phase === "betting", "run starts into betting");
assert(
  snap.bettingEndsIn !== null && Math.ceil(snap.bettingEndsIn) === BETTING_WINDOW_MS / 1000,
  "betting window arms the moment betting opens"
);

/* ---- round 1: opt-out first, then the ante deals instantly ---- */
sim.applyIntent(P2, { type: "sitOut", on: true });
assert(player(P2).sittingOut, "sitOut flags the player");
sim.applyIntent(P1, { type: "setBet", amount: 50 });
sim.applyIntent(P1, { type: "commitBet" });
assert(sim.snapshot().phase === "dealing", "everyone answered: cards fly with no window wait");
finishRound(1);
assert(player(P2).stats.handsPlayed === 0, "sitting out means no hand");
assert(player(P2).score === 0, "sitting out means no score");
assert(player(P2).sittingOut, "sit-out is sticky into the next round");

/* ---- round 2: opt-out can be the LAST answer the deal waited on ---- */
topUp();
sim.applyIntent(P2, { type: "sitOut", on: false });
assert(!player(P2).sittingOut, "deal-me-in clears the flag");
sim.applyIntent(P1, { type: "setBet", amount: 50 });
sim.applyIntent(P1, { type: "commitBet" });
assert(sim.snapshot().phase === "betting", "an undecided player holds the deal");
sim.applyIntent(P2, { type: "sitOut", on: true });
assert(sim.snapshot().phase === "dealing", "their opt-out was the last answer — cards fly");
finishRound(2);

/* ---- an all-out table idles in betting, even past the window ---- */
topUp();
sim.applyIntent(P1, { type: "sitOut", on: true });
for (let i = 0; i < Math.floor((BETTING_WINDOW_MS / 1000) * 1.5 * TICK_RATE); i++) {
  sim.step();
  if (i % 300 === 0) topUp();
}
snap = sim.snapshot();
assert(snap.phase === "betting", "zero bettors: the deal never fires on an empty table");
assert(snap.bettingEndsIn === null, "an all-out table idles with no clock to nowhere");

/* ---- ante beats the flag; the window closes on true stragglers ---- */
topUp();
sim.applyIntent(P1, { type: "setBet", amount: 50 });
sim.applyIntent(P1, { type: "commitBet" });
assert(!player(P1).sittingOut, "anteing up IS opting back in");
assert(sim.snapshot().phase === "dealing", "the only non-sitting player anted: instant deal");
finishRound(3);
topUp();
sim.applyIntent(P2, { type: "sitOut", on: false }); // back in, but never answers
sim.applyIntent(P1, { type: "setBet", amount: 50 });
sim.applyIntent(P1, { type: "commitBet" });
assert(sim.snapshot().phase === "betting", "the straggler holds the deal at first");
for (let i = 0; i < Math.floor((BETTING_WINDOW_MS / 1000 + 1) * TICK_RATE); i++) {
  sim.step();
  if (sim.snapshot().phase !== "betting") break;
}
assert(sim.snapshot().phase !== "betting", "window closes: the table deals around the straggler");
assert(player(P2).hand.length === 0, "the straggler is out of the hand, not in it");
finishRound(4);

/* ---- a mid-run spectator never holds up the instant deal ---- */
topUp();
sim.applyIntent(P3, { type: "join", name: "LATECOMER" });
assert(player(P3).waiting, "mid-run join spectates");
for (const id of [P1, P2]) {
  sim.applyIntent(id, { type: "setBet", amount: 50 });
  sim.applyIntent(id, { type: "commitBet" });
}
assert(sim.snapshot().phase === "dealing", "spectators aren't waited on — instant deal");
finishRound(5);

/* ---- one of two sitting out pre-ante disarms the clock ---- */
topUp();
snap = sim.snapshot();
assert(snap.bettingEndsIn !== null, "two eligible players: the window arms at open");
sim.applyIntent(P2, { type: "sitOut", on: true });
snap = sim.snapshot();
assert(snap.phase === "betting", "the lone survivor still has a table");
assert(snap.bettingEndsIn === null, "a lone would-be bettor isn't kept on the clock");
sim.applyIntent(P2, { type: "sitOut", on: false });
assert(sim.snapshot().bettingEndsIn === null, "opting back in doesn't start the clock — only an ante does");

/* ---- a lapsed window goes idle; the next ante arms a fresh one ---- */
for (const id of [P1, P2]) {
  sim.applyIntent(id, { type: "setBet", amount: 50 });
  sim.applyIntent(id, { type: "commitBet" });
}
finishRound(6);
topUp();
assert(sim.snapshot().bettingEndsIn !== null, "round over: the get-your-bets-in clock is running");
for (let i = 0; i < Math.floor((BETTING_WINDOW_MS / 1000) * 1.5 * TICK_RATE); i++) {
  sim.step();
  if (i % 300 === 0) topUp();
}
snap = sim.snapshot();
assert(snap.phase === "betting", "nobody anted: betting stays open");
assert(snap.bettingEndsIn === null, "the lapsed window idles instead of re-arming");
sim.applyIntent(P1, { type: "setBet", amount: 50 });
sim.applyIntent(P1, { type: "commitBet" });
snap = sim.snapshot();
assert(snap.phase === "betting", "an undecided player still holds the deal");
assert(
  snap.bettingEndsIn !== null && Math.ceil(snap.bettingEndsIn) === BETTING_WINDOW_MS / 1000,
  "the first ante wakes the idle table with a fresh full window"
);

/* ---- a solo table never gets a clock at all ---- */
const solo = await Simulation.create(4242);
solo.applyIntent(P1, { type: "join", name: "LONER" });
solo.applyIntent(P1, { type: "startGame" });
for (let i = 0; i < 60 * 11 && solo.snapshot().phase === "lobby"; i++) solo.step();
snap = solo.snapshot();
assert(snap.phase === "betting", "solo run starts into betting");
assert(snap.bettingEndsIn === null, "a solo table gets no clock — bet whenever");
for (let i = 0; i < Math.floor((BETTING_WINDOW_MS / 1000) * 1.5 * TICK_RATE); i++) {
  for (const p of solo.players.values()) {
    p.cigarMeter = METER_MAX;
    p.beerMeter = METER_MAX;
  }
  solo.step();
}
snap = solo.snapshot();
assert(snap.phase === "betting" && snap.bettingEndsIn === null, "still no rush, however long they stall");
solo.applyIntent(P1, { type: "setBet", amount: 50 });
solo.applyIntent(P1, { type: "commitBet" });
assert(solo.snapshot().phase === "dealing", "the solo ante deals instantly");

console.log("sitOut: all good");
