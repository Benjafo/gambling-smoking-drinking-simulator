import type { Card, ResultKind } from "./blackjack";
import type { V3 } from "./constants";

export type ViceKind = "cigar" | "beer";
export type RoomPhase = "lobby" | "betting" | "dealing" | "acting" | "dealer" | "settle" | "over";
export type DebrisPhase = "flying" | "settled";

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface PlayerStats {
  handsPlayed: number;
  cigarsSmoked: number;
  beersDrunk: number;
  peakMoney: number;
}

export interface PlayerSnap {
  id: string;
  name: string;
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
  cigarInv: number;
  beerInv: number;
  ritual: { kind: ViceKind; progress: number } | null;
  held: { id: number; kind: ViceKind } | null;
  alive: boolean;
  causeOfDeath: string | null;
  stats: PlayerStats;
}

export interface DebrisSnap {
  id: number;
  kind: ViceKind;
  phase: DebrisPhase;
  pos: V3;
  rot: Quat;
}

export type SimEvent =
  | { t: "result"; playerId: string; label: string; kind: ResultKind; delta: number }
  | { t: "impact"; speed: number; pos: V3 }
  | { t: "fling"; playerId: string; id: number }
  | { t: "eliminated"; playerId: string; cause: string };

export interface Snapshot {
  tick: number;
  phase: RoomPhase;
  dealerHand: Card[];
  holeHidden: boolean;
  turnPlayerId: string | null;
  cigarPrice: number;
  beerPrice: number;
  handsPlayed: number;
  elapsed: number; // seconds since run start
  players: PlayerSnap[];
  debris: DebrisSnap[];
  events: SimEvent[];
}

export type Intent =
  | { type: "join"; name: string }
  | { type: "leave" }
  | { type: "setBet"; amount: number }
  | { type: "commitBet" }
  | { type: "hit" }
  | { type: "stand" }
  | { type: "double" }
  | { type: "buy"; item: ViceKind; qty: number }
  | { type: "consumeStart"; kind: ViceKind }
  | { type: "ritualEngage"; on: boolean }
  | { type: "ritualReset" }
  | { type: "consumeCancel" }
  | { type: "fling"; itemId: number; origin: V3; vel: V3; angVel: V3 }
  | { type: "pickup"; itemId: number }
  | { type: "restart" };

/* transport-level messages (worker postMessage and websocket share these) */
export type ClientMsg = { type: "intent"; intent: Intent };
export type ServerMsg =
  | { type: "welcome"; playerId: string }
  | { type: "snapshot"; snap: Snapshot };
