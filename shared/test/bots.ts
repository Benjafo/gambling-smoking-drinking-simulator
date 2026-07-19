/* Dev bots: leader-seated sim opponents that bet, play, smoke, drink, fling
   litter, and eventually fizzle so the human ends up last standing. All of
   it flows through applyIntent — the same door a remote client uses.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import { SEAT_COUNT } from "../src/constants";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

const sim = await Simulation.create(20260719);
const ME = "p1";
sim.applyIntent(ME, { type: "join", name: "HUMAN" });

/* ---- who gets to seat bots ---- */
sim.applyIntent("ghost", { type: "addBot", difficulty: "easy" }); // not seated at all
assert(sim.players.size === 1 && sim.bots.size === 0, "a stranger can't seat bots");

sim.applyIntent("p2", { type: "join", name: "SECOND" });
sim.applyIntent("p2", { type: "addBot", difficulty: "easy" });
assert(sim.bots.size === 0, "only the leader seats bots");
sim.applyIntent("p2", { type: "leave" });

sim.applyIntent(ME, { type: "addBot", difficulty: "hard" });
sim.applyIntent(ME, { type: "addBot", difficulty: "autonomous" });
assert(sim.players.size === 3 && sim.bots.size === 2, "leader seated a hard and an autonomous bot");
const [HARD, AUTO] = [...sim.bots.keys()];

{
  const snap = sim.snapshot();
  const bots = snap.players.filter((p) => p.bot);
  assert(bots.length === 2, "snapshot flags bots");
  assert(!snap.players.find((p) => p.id === ME)!.bot, "the human is not flagged");
  assert(
    bots.some((p) => p.name.endsWith("HARD")) && bots.some((p) => p.name.endsWith("AUTO")),
    "bot names carry their difficulty tag"
  );
}

/* ---- the stools are the cap ---- */
for (let i = 0; i < 4; i++) sim.applyIntent(ME, { type: "addBot", difficulty: "easy" });
assert(sim.players.size === SEAT_COUNT, "bots stop at the last stool");

/* ---- clear and reseat the test roster ---- */
sim.applyIntent(ME, { type: "clearBots" });
assert(sim.players.size === 1 && sim.bots.size === 0, "clearBots empties the table");
sim.applyIntent(ME, { type: "addBot", difficulty: "hard" });
sim.applyIntent(ME, { type: "addBot", difficulty: "autonomous" });
const [HARD2, AUTO2] = [...sim.bots.keys()];
assert(HARD2 !== HARD && AUTO2 !== AUTO, "bot ids never recycle");

/* ---- into the run: bots survive the lobby wandering and the countdown ---- */
sim.applyIntent(ME, { type: "startGame" });
for (let i = 0; i < 60 * 12 && sim.phase === "lobby"; i++) sim.step();
assert(sim.phase === "betting", "run started with bots seated");

/* ---- a full hand plays out; bots ante, act, and fling on their own ---- */
const human = sim.players.get(ME)!;
let botFlung = false;
for (let i = 0; i < 60 * 120 && sim.handsPlayed < 1; i++) {
  if (sim.phase === "betting" && !human.committed && !human.sittingOut && human.money > 0) {
    sim.applyIntent(ME, { type: "setBet", amount: 10 });
    sim.applyIntent(ME, { type: "commitBet" });
  }
  if (sim.turnPlayerId === ME) sim.applyIntent(ME, { type: "stand" });
  sim.step();
  for (const ev of sim.snapshot().events)
    if (ev.t === "fling" && sim.bots.has(ev.playerId)) botFlung = true;
}
assert(sim.handsPlayed >= 1, "a hand completed with bots at the table");
const hard = sim.players.get(HARD2)!;
const auto = sim.players.get(AUTO2)!;
assert(hard.stats.handsPlayed >= 1, "the hard bot played the hand");
assert(auto.stats.handsPlayed >= 1, "the autonomous bot played the hand");

/* ---- a low meter sends a bot for its vice, then the empty flies ---- */
hard.beerMeter = 30;
hard.beerInv = 3;
const beersBefore = hard.stats.beersDrunk;
for (let i = 0; i < 60 * 20 && (hard.stats.beersDrunk === beersBefore || hard.held); i++) {
  if (sim.turnPlayerId === ME) sim.applyIntent(ME, { type: "stand" });
  sim.step();
  for (const ev of sim.snapshot().events)
    if (ev.t === "fling" && sim.bots.has(ev.playerId)) botFlung = true;
}
assert(hard.stats.beersDrunk > beersBefore, "hard bot refilled its low beer meter");
assert(hard.beerMeter > 50, "the refill actually landed");
assert(botFlung, "bots fling their empties");

/* ---- autonomous: never consumes, dies when the meter runs out ---- */
assert(
  auto.stats.beersDrunk + auto.stats.cigarsSmoked === 0,
  "autonomous bot never touched a vice"
);
auto.cigarMeter = 1;
for (let i = 0; i < 60 * 5 && auto.alive; i++) sim.step();
assert(!auto.alive && /SOBRIETY/.test(auto.causeOfDeath ?? ""), "autonomous bot died of sobriety");

/* ---- a doomed bot quietly stops feeding the habit ---- */
const brain = sim.bots.get(HARD2)!;
brain.doomed = true;
hard.beerMeter = 30;
hard.cigarMeter = 80;
const beersDoomed = hard.stats.beersDrunk;
for (let i = 0; i < 60 * 6; i++) sim.step();
assert(hard.stats.beersDrunk === beersDoomed, "doomed bot stopped consuming");

/* ---- the fizzle plays out: human is last standing and takes the win ---- */
hard.cigarMeter = 0.5;
hard.beerMeter = 0.5;
for (let i = 0; i < 60 * 3 && sim.phase !== "over"; i++) sim.step();
assert(sim.phase === "over", "run ended when the last bot fell");
assert(sim.winnerId === ME, "the human is last standing");
assert(sim.snapshot().standings[0] === ME, "standings crown the human");

/* ---- run it back: brains reset with everyone else ---- */
sim.applyIntent(ME, { type: "restart" });
sim.step();
sim.step();
assert(sim.phase === "lobby", "restart returns to the lobby");
assert(!brain.doomed, "restart lifts the doom");
assert(hard.alive && auto.alive, "bots stand back up for the next run");

console.log("\nALL BOT TESTS PASSED");
