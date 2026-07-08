/* Tuning + world geometry shared by simulation (colliders) and client (meshes).
   Table sits at the origin; dealer on -Z, player seats fanned across +Z. */

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY_TICKS = 3; // 20 Hz

export const START_MONEY = 1000;
export const METER_MAX = 100;
export const BASE_RATE = 2.0;
export const RAMP = 0.3;
export const RATE_CAP = 6.0;
export const JITTER = 0.5;

export const DECKS = 6;
export const RESHUFFLE_AT = 52;
export const MIN_BET = 10;

export const CIGAR_PRICE_0 = 15;
export const BEER_PRICE_0 = 10;
export const INFLATE_EVERY_HANDS = 10;

export const RITUAL_MS: Record<"cigar" | "beer", number> = { cigar: 2500, beer: 2000 };

export const DEAL_STEP_MS = 600;
export const DEALER_DRAW_MS = 850;
export const RESULT_PAUSE_MS = 1500;
export const BETTING_WINDOW_MS = 15000; // after first commit, stragglers sit out
export const ACT_TIMEOUT_MS = 30000; // auto-stand an AFK player

export const MAX_DEBRIS = 200;
export const MAX_FLING_SPEED = 12;
/* littering payout: a fresh empty (straight from a ritual, not scavenged
   off the floor) rolls once when it settles — sometimes the filth pays */
export const MONEY_DROP_CHANCE = 0.06;
/* every earned empty scores points when it settles (the full scoring system
   — round wins, vices, etc. — comes later; the litter hook lands first) */
export const LITTER_POINTS = 25;
export const MONEY_DROP_MIN = 5;
export const MONEY_DROP_MAX = 25;
/* pickup range, from the seat's eye. Effectively room-wide: you're stuck on
   the stool, so debris you can't retrieve is dead content, and multiplayer
   "reach" fairness matters less than keeping the toy alive. */
export const REACH_RADIUS = 10;

/* ---- world geometry ---- */
export const TABLE = { radius: 1.5, height: 0.76, rimRadius: 1.47, rimTube: 0.055 };
export const SEAT_COUNT: number = 5;
export const SEAT_RADIUS = 2.05;
/* eye sits high enough to look DOWN at the felt — flat cards at a grazing
   angle are unreadable */
export const EYE_HEIGHT = 1.5;
export const DEALER_POS = { x: 0, y: 0, z: -1.35 };

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export function seatAngle(i: number): number {
  // angle measured from +Z axis; middle seat dead-on facing the dealer
  const spread = Math.PI * 0.72;
  const t = SEAT_COUNT === 1 ? 0.5 : i / (SEAT_COUNT - 1);
  return -spread / 2 + t * spread;
}
export function seatPosition(i: number): V3 {
  const a = seatAngle(i);
  return { x: Math.sin(a) * SEAT_RADIUS, y: 0, z: Math.cos(a) * SEAT_RADIUS };
}
export function seatEye(i: number): V3 {
  const p = seatPosition(i);
  return { x: p.x, y: EYE_HEIGHT, z: p.z };
}
/* point on the table in front of seat i, at radius r from center */
export function seatTablePoint(i: number, r: number): V3 {
  const a = seatAngle(i);
  return { x: Math.sin(a) * r, y: TABLE.height, z: Math.cos(a) * r };
}
