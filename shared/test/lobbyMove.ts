/* Lobby-room movement: spawn placement, walking, wall/furniture collision,
   speed-hack clamping, phase gating (no walking mid-game), and restart
   putting everyone back on their spawn spots.
   Run with: npm run test:sim */
import { Simulation } from "../src/sim";
import {
  LOBBY_OBSTACLES,
  LOBBY_PLAYER_R,
  LOBBY_ROOM,
  LOBBY_SPAWNS,
  LOBBY_WALK_SPEED,
} from "../src/lobbyRoom";
import { TICK_RATE } from "../src/constants";
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
const player = (id: string): PlayerSnap => sim.snapshot().players.find((p) => p.id === id)!;

/* ---- spawns ---- */
sim.applyIntent(P1, { type: "join", name: "WALKER" });
sim.applyIntent(P2, { type: "join", name: "STATUE" });
let me = player(P1);
const spawn = LOBBY_SPAWNS[me.seat];
assert(me.pos.x === spawn.x && me.pos.z === spawn.z, "joiner appears on their seat's spawn spot");
assert(me.moveYaw === spawn.yaw, "spawned facing the door");
assert(!me.moving, "spawned standing still");

/* ---- walking: one second of held input covers walk-speed distance ---- */
sim.applyIntent(P1, { type: "move", dirX: 1, dirZ: 0, yaw: 1.2 });
for (let i = 0; i < TICK_RATE; i++) sim.step();
me = player(P1);
const walked = me.pos.x - spawn.x;
assert(
  Math.abs(walked - LOBBY_WALK_SPEED) < 0.05,
  `held input walks at LOBBY_WALK_SPEED (${walked.toFixed(2)}m in 1s)`
);
assert(me.moving, "snapshot reports them mid-stride");
assert(me.moveYaw === 1.2, "facing follows the reported yaw");
assert(player(P2).pos.x === LOBBY_SPAWNS[player(P2).seat].x, "the idle player hasn't drifted");

/* ---- a doctored oversized direction moves no faster ---- */
const beforeCheat = player(P1).pos.x;
sim.applyIntent(P1, { type: "move", dirX: 900, dirZ: 0, yaw: 0 });
for (let i = 0; i < TICK_RATE; i++) sim.step();
const cheatWalked = player(P1).pos.x - beforeCheat;
assert(cheatWalked < LOBBY_WALK_SPEED + 0.05, "oversized input direction is clamped to walk speed");

/* ---- walls contain the room ---- */
for (let i = 0; i < TICK_RATE * 10; i++) sim.step();
me = player(P1);
assert(
  Math.abs(me.pos.x - (LOBBY_ROOM.halfW - LOBBY_PLAYER_R)) < 1e-6,
  "ten more seconds of walking east parks them against the east wall"
);

/* ---- furniture blocks: march at the jukebox, never reach its center ---- */
const juke = LOBBY_OBSTACLES[5];
sim.applyIntent(P1, { type: "move", dirX: 0, dirZ: 0, yaw: 0 });
for (let i = 0; i < 5; i++) sim.step();
// aim from current spot toward the jukebox and hold it for 8 seconds
for (let i = 0; i < TICK_RATE * 8; i++) {
  const at = player(P1).pos;
  sim.applyIntent(P1, {
    type: "move",
    dirX: juke.x - at.x,
    dirZ: juke.z - at.z,
    yaw: 0,
  });
  sim.step();
}
me = player(P1);
const dist = Math.hypot(me.pos.x - juke.x, me.pos.z - juke.z);
assert(
  dist >= juke.r + LOBBY_PLAYER_R - 1e-6,
  `furniture holds its ground (stopped ${dist.toFixed(2)}m from the jukebox center)`
);

/* ---- NaN input is ignored, not propagated ---- */
sim.applyIntent(P1, { type: "move", dirX: NaN, dirZ: NaN, yaw: NaN });
for (let i = 0; i < 10; i++) sim.step();
me = player(P1);
assert(Number.isFinite(me.pos.x) && Number.isFinite(me.pos.z), "NaN input can't poison a position");
assert(!me.moving, "NaN input reads as standing still");

/* ---- the game starts: everyone freezes, movement intents go dead ---- */
sim.applyIntent(P1, { type: "move", dirX: 0, dirZ: 1, yaw: 0 });
sim.applyIntent(P1, { type: "startGame" });
assert(sim.snapshot().phase === "lobby", "start queues a countdown; the room keeps walking");
for (let i = 0; i < TICK_RATE * 11 && sim.snapshot().phase === "lobby"; i++) sim.step();
assert(sim.snapshot().phase === "betting", "leader started the game (countdown expired)");
me = player(P1);
const frozen = { x: me.pos.x, z: me.pos.z };
assert(!me.moving, "starting the game stops everyone mid-stride");
sim.applyIntent(P1, { type: "move", dirX: 0, dirZ: 1, yaw: 0 });
for (let i = 0; i < TICK_RATE; i++) sim.step();
me = player(P1);
assert(
  me.pos.x === frozen.x && me.pos.z === frozen.z,
  "no walking during the game — the sim ignores move outside the lobby"
);

/* ---- back to the lobby: everyone returns to their spawn ---- */
// drain both players to elimination is slow; leave-based path: P2 leaves,
// P1 wins by default → over → restart
sim.applyIntent(P2, { type: "leave" });
let guard = 0;
while (sim.snapshot().phase !== "over" && guard++ < TICK_RATE * 120) sim.step();
assert(sim.snapshot().phase === "over", "run ended after the other player left");
sim.applyIntent(P1, { type: "restart" });
me = player(P1);
assert(sim.snapshot().phase === "lobby", "restart returns to the lobby");
assert(
  me.pos.x === LOBBY_SPAWNS[me.seat].x && me.pos.z === LOBBY_SPAWNS[me.seat].z && !me.moving,
  "restart puts survivors back on their spawn spots, standing still"
);

console.log("\nALL LOBBY MOVEMENT TESTS PASSED");
