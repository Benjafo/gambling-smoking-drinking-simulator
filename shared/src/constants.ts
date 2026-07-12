/* Tuning + world geometry shared by simulation (colliders) and client (meshes).
   Table sits at the origin; dealer on -Z, player seats fanned across +Z. */

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY_TICKS = 3; // 20 Hz
/* default room port: the server binds it, ?server=auto dials it */
export const WS_PORT_DEFAULT = 8081;
/* lobby browsing: shared limits so client validation matches the server's */
export const MAX_LOBBIES = 50;
export const LOBBY_NAME_MAX = 32;
export const PLAYER_NAME_MAX = 24;
export const LOBBY_PASSWORD_MAX = 32;

export const START_MONEY = 1000;
export const METER_MAX = 100;
export const BASE_RATE = 1.2;
export const RAMP = 0.3;
export const RATE_CAP = 6.0;
export const JITTER = 0.5;

/* ---- tolerance: the body adapts and the loop tightens. Each vice finished
   builds tolerance for that vice; it never fades on its own — planned shop
   items will trade levels between the two, and they must stay the ONLY way
   down. One "level" = TOLERANCE_PER_USE, so item effects should move
   tolerance in those units (one pip on the HUD). */
export const TOLERANCE_MAX = 100;
export const TOLERANCE_PER_USE = 10;
/* at max tolerance the habit barely works: a vice refills only this fraction
   of the bar, and that meter drains this much faster */
export const TOLERANCE_FILL_FLOOR = 0.35;
export const TOLERANCE_DRAIN_BONUS = 0.75;

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
export const BETTING_WINDOW_MS = 15000; // betting closes on stragglers; first ante refreshes it
export const GAME_START_COUNTDOWN_MS = 10000; // leader hit the door → banner counts down
export const ACT_TIMEOUT_MS = 30000; // auto-stand an AFK player

export const MAX_DEBRIS = 200;
export const MAX_FLING_SPEED = 12;
/* littering payout: a fresh empty (straight from a ritual, not scavenged
   off the floor) rolls once when it settles — sometimes the filth pays */
export const MONEY_DROP_CHANCE = 0.06;
/* every earned empty scores points, landing a beat after its first impact —
   mid-clatter, not when it finally stops rolling */
export const LITTER_POINTS = 25;
export const LITTER_IMPACT_DELAY_MS = 250;
/* beaning another player mid-flight — before the empty touches anything —
   pays more than mere littering */
export const SCORE_PLAYER_HIT = 40;
/* seated player approximated as a vertical capsule for the direct-hit test:
   torso spans ~0.72-1.34, head center ~1.39 (see client makeFigure and
   AVATAR_SCALE in scene.ts — keep in sync). Max still covers the local eye. */
export const PLAYER_HIT_Y_MIN = 0.72;
export const PLAYER_HIT_Y_MAX = 1.5;
export const PLAYER_HIT_RADIUS = 0.3; // includes debris-size slop

/* head-tracking limits: the camera clamps here and the sim re-clamps
   whatever clients report. Yaw reaches well past the shoulder — checking
   the room behind you is allowed; avatars cap the SHOWN neck turn in
   scene.ts so heads stay anatomical. */
export const LOOK_YAW_LIMIT = 2.6;
export const LOOK_PITCH_MIN = -0.65;
export const LOOK_PITCH_MAX = 0.55;

/* ---- scoring: the leaderboard currency. Rounds gambled pay, winning pays
   more, vices and littering pay — dying just stops the meter running. */
export const SCORE_HAND_PLAYED = 10;
export const SCORE_HAND_WON = 25; // on top of SCORE_HAND_PLAYED
export const SCORE_VICE = 15; // per cigar smoked / beer drunk
export const MONEY_DROP_MIN = 5;
export const MONEY_DROP_MAX = 25;
/* pickup range, from the seat's eye. Effectively room-wide: you're stuck on
   the stool, so debris you can't retrieve is dead content, and multiplayer
   "reach" fairness matters less than keeping the toy alive. */
export const REACH_RADIUS = 10;

/* ---- world geometry ---- */
export const TABLE = { radius: 1.5, height: 0.76, rimRadius: 1.47, rimTube: 0.055 };
/* the small back room the table lives in. The client's walls and the
   debris colliders in physics.ts both read these — a bottle must ricochet
   off exactly the drywall the player sees. z runs from centerZ - halfD
   (behind the dealer) to centerZ + halfD (behind the players). */
export const DEN_ROOM = { halfW: 4.4, halfD: 4.2, height: 3.3, centerZ: 0.5 };
export const SEAT_COUNT: number = 5;
/* pushed out from 2.05: with smaller avatars this keeps a direct hit a
   skill shot instead of a gimme (adjacent seats ~1.23m apart) */
export const SEAT_RADIUS = 2.2;
/* eye sits high enough to look DOWN at the felt — flat cards at a grazing
   angle are unreadable */
export const EYE_HEIGHT = 1.5;
export const DEALER_POS = { x: 0, y: 0, z: -1.35 };

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/* ---- cards on the felt: geometry + layout shared by the renderer (meshes)
   and the sim (colliders) — a flung empty must land on exactly the cards
   the players see. One layout for every viewer: your hand looks the same on
   your screen and your neighbor's, so one set of colliders can match both. */
export const CARD_W = 0.1;
export const CARD_H = 0.145;
export const CARD_SLOT_PITCH = 0.125; // center-to-center fan spacing, pre-scale
export const CARD_LIFT = 0.004; // rest height above the felt
export const HAND_ANCHOR_R = 0.86; // player hands sit at this table radius
export const PLAYER_CARD_SCALE = 1.25;
/* shallow on purpose: flat-ish cards read from every seat, and litter
   dropped on a hand STAYS on it (a steeper ramp rolls bottles off, which
   guts the bury-their-cards play) */
export const PLAYER_CARD_LEAN = 0.2; // radians tipped back toward the owner
export const DEALER_CARD_SCALE = 1.3;
export const DEALER_CARD_LEAN = 0.3;
export const DEALER_HAND_Z = -0.52;

/* center + orientation of card slot i in a hand fanned at `yaw` around
   `anchor`. The rotation is the renderer's euler (x: -π/2+lean, y: yaw,
   order YXZ — yaw about world-up first, then lean about the card's own
   width axis) written out as a quaternion so the sim needs no three.js.
   Leaned cards pivot at their center: the y lift keeps the bottom edge on
   the felt. */
export function cardSlot(
  anchor: V3,
  yaw: number,
  i: number,
  scale: number,
  lean: number
): { pos: V3; rot: { x: number; y: number; z: number; w: number } } {
  const off = (i - 1) * CARD_SLOT_PITCH * scale;
  const pos = {
    x: anchor.x + Math.cos(yaw) * off,
    y: anchor.y + ((CARD_H * scale) / 2) * Math.sin(lean) * 0.95,
    z: anchor.z - Math.sin(yaw) * off,
  };
  const hx = (-Math.PI / 2 + lean) / 2;
  const hy = yaw / 2;
  const rot = {
    x: Math.sin(hx) * Math.cos(hy),
    y: Math.cos(hx) * Math.sin(hy),
    z: -Math.sin(hx) * Math.sin(hy),
    w: Math.cos(hx) * Math.cos(hy),
  };
  return { pos, rot };
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
