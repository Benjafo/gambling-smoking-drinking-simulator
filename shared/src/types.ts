import type { Appearance } from "./appearance";
import type { Card, ResultKind } from "./blackjack";
import type { V3 } from "./constants";

export type ViceKind = "cigar" | "beer";
/* everything that can lie on a floor, be picked up, and be flung: the vice
   empties plus the waiting room's toys. Only vices go through dispensers,
   rituals, and the shop — the toys exist solely as seeded lobby debris. */
export type PropKind = ViceKind | "plunger" | "stick";
export const isVice = (k: PropKind): k is ViceKind => k === "cigar" || k === "beer";
export type RoomPhase = "lobby" | "betting" | "dealing" | "acting" | "dealer" | "settle" | "over";
export type DebrisPhase = "flying" | "settled";
/* which space a piece of litter lives in: the table den, or the waiting
   room (each renders as its own scene with its own local coordinates) */
export type DebrisRoom = "den" | "lobby";

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface PlayerStats {
  handsPlayed: number;
  handsWon: number;
  cigarsSmoked: number;
  beersDrunk: number;
  peakMoney: number;
  litters: number;
  directHits: number;
}

export interface PlayerSnap {
  id: string;
  name: string;
  /* mirror-picked look, sanitized at join — palette indices, see appearance.ts */
  appearance: Appearance;
  seat: number;
  money: number;
  pendingBet: number;
  lastBet: number;
  committed: boolean;
  bet: number;
  doubled: boolean;
  stood: boolean;
  hand: Card[];
  cigarMeter: number;
  beerMeter: number;
  /* per-vice tolerance 0..TOLERANCE_MAX: refills shrink and drain speeds up
     as it climbs. HUD shows it as pips of TOLERANCE_PER_USE each. */
  cigarTol: number;
  beerTol: number;
  cigarInv: number;
  beerInv: number;
  ritual: { kind: ViceKind; progress: number } | null;
  /* pos is set while the owner is dragging the empty (wind-up before a
     fling) — remote clients mirror it so the throw telegraphs */
  held: { id: number; kind: PropKind; pos: V3 | null } | null;
  /* where this player's camera is pointed, relative to facing the table
     center — drives the avatar's head on everyone else's screen */
  look: { yaw: number; pitch: number };
  /* lobby-room presence (meaningful while phase === "lobby"): where they
     stand, which way they face, and whether they're mid-stride */
  pos: V3;
  moveYaw: number;
  moving: boolean;
  alive: boolean;
  /* joined mid-run: spectates until the next game starts */
  waiting: boolean;
  /* opted out of betting rounds: still at the table (meters run, vices and
     littering live), just never waited on for the deal */
  sittingOut: boolean;
  causeOfDeath: string | null;
  score: number;
  stats: PlayerStats;
}

export interface DebrisSnap {
  id: number;
  kind: PropKind;
  phase: DebrisPhase;
  room: DebrisRoom;
  /* room-local coordinates (lobby debris is NOT in table space) */
  pos: V3;
  rot: Quat;
}

export type SimEvent =
  | { t: "result"; playerId: string; label: string; kind: ResultKind; delta: number }
  | { t: "impact"; speed: number; pos: V3 }
  | { t: "fling"; playerId: string; id: number; vel: V3 }
  | { t: "moneyDrop"; playerId: string; pos: V3; amount: number }
  | { t: "litter"; playerId: string; pos: V3; points: number }
  /* score gains with no world anchor (hands settled, vices finished) —
     the client picks a spot in the earner's own view */
  | { t: "score"; playerId: string; points: number }
  | { t: "playerHit"; flingerId: string; victimId: string; pos: V3; points: number }
  | { t: "eliminated"; playerId: string; cause: string };

export interface Snapshot {
  tick: number;
  phase: RoomPhase;
  leaderId: string | null;
  winnerId: string | null;
  dealerHand: Card[];
  holeHidden: boolean;
  turnPlayerId: string | null;
  cigarPrice: number;
  beerPrice: number;
  handsPlayed: number;
  elapsed: number; // seconds since run start
  /* lobby countdown: seconds until the run begins, null when no start is
     queued. Set the moment the leader starts the game; the phase stays
     "lobby" until it hits zero. */
  startsIn: number | null;
  /* seconds until the betting window closes and the cards fly without the
     stragglers, null outside the betting phase */
  bettingEndsIn: number | null;
  players: PlayerSnap[];
  debris: DebrisSnap[];
  events: SimEvent[];
  /* authoritative final rankings, best first — winner pinned to the top,
     the rest by the run-quality cascade. Empty until phase === "over". */
  standings: string[];
}

export type Intent =
  | { type: "join"; name: string; appearance?: Appearance }
  | { type: "leave" }
  | { type: "startGame" }
  | { type: "setBet"; amount: number }
  | { type: "commitBet" }
  /* skip betting rounds without holding up the table: on sticks until the
     player opts back in (or the next run starts) */
  | { type: "sitOut"; on: boolean }
  | { type: "hit" }
  | { type: "stand" }
  | { type: "double" }
  | { type: "buy"; item: ViceKind; qty: number }
  /* lobby-room toy: pull a free bottle/cigar from a wall dispenser (hands
     empty, standing at it) — it exists only to be flung around pre-game */
  | { type: "dispense"; kind: ViceKind }
  /* leader-only, lobby-only: the janitor option — every empty in the den
     and the waiting room vanishes */
  | { type: "clearLitter" }
  | { type: "consumeStart"; kind: ViceKind }
  | { type: "ritualEngage"; on: boolean }
  | { type: "ritualReset" }
  | { type: "consumeCancel" }
  | { type: "fling"; itemId: number; origin: V3; vel: V3; angVel: V3 }
  | { type: "heldMove"; pos: V3 | null }
  | { type: "pickup"; itemId: number }
  | { type: "look"; yaw: number; pitch: number }
  /* lobby-room walking: a held input direction (world-space, unit or less)
     plus facing; the sim integrates it every tick until it changes. `run`
     (SHIFT held) picks the faster of two fixed speeds — never a free scalar */
  | { type: "move"; dirX: number; dirZ: number; yaw: number; run?: boolean }
  /* lobby-room hop: an impulse, honored only with feet on something */
  | { type: "jump" }
  | { type: "restart" };

/* what the server tells browsers about each lobby — never the password */
export interface LobbyInfo {
  id: string;
  name: string;
  players: number;
  maxPlayers: number;
  locked: boolean;
  phase: RoomPhase;
}

/* transport-level messages (worker postMessage and websocket share the
   intent/welcome/snapshot core; the lobby-browse messages are ws-only —
   the local worker is its own private table) */
export type ClientMsg =
  | { type: "intent"; intent: Intent }
  | {
      type: "createLobby";
      name: string;
      password: string | null;
      playerName: string;
      appearance?: Appearance;
    }
  | {
      type: "joinLobby";
      lobbyId: string;
      password: string | null;
      playerName: string;
      appearance?: Appearance;
    }
  | { type: "leaveLobby" };
export type ServerMsg =
  | { type: "welcome"; playerId: string }
  | { type: "snapshot"; snap: Snapshot }
  | { type: "lobbies"; lobbies: LobbyInfo[] }
  | { type: "joined"; lobbyId: string; lobbyName: string; playerId: string }
  | { type: "joinError"; reason: string }
  | { type: "left" };
