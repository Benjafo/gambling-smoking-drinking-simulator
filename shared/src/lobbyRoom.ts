/* The waiting room: a small back room off the bar where players mill around
   until the leader starts the game. This module is the single source of
   truth for its geometry — the sim collides against it, the client renders
   furniture at these exact coordinates AND predicts local movement with the
   same stepLobbyMove(), so prediction never diverges from the server.

   Coordinate space is room-local (origin at room center, y=0 floor) and
   entirely separate from the table world — the client renders it as its own
   scene. Movement is kinematic: no Rapier, just walls + circle push-outs,
   deterministic and cheap. (Flung debris IS Rapier — physics.ts rebuilds
   this same geometry as colliders, parked far from the table.) */
import type { V3 } from "./constants";
import type { ViceKind } from "./types";

export const LOBBY_WALK_SPEED = 2.1; // m/s — a saunter, not a sprint
export const LOBBY_PLAYER_R = 0.28;
export const LOBBY_EYE_HEIGHT = 1.5; // matches the table's seated eye
/* inner walkable half-extents (walls sit just outside) */
export const LOBBY_ROOM = { halfW: 4.2, halfD: 3.2, height: 2.75 };

/* hopping around the furniture: a beer-fueled 0.72m apex clears the couch,
   the coffee table and (barely) a stool from the floor, while the bar
   tables stay a two-step climb — stool first, then up. Tuned pair: apex =
   JUMP² / (2·G). */
export const LOBBY_GRAVITY = 18;
export const LOBBY_JUMP_SPEED = 5.1;
/* landing forgiveness: feet may be this far below a top and still mantle
   onto it (also the gap that keeps floor→bar-table out of reach: 1.03 −
   0.15 = 0.88 needed, 0.72 available) */
export const LOBBY_MANTLE = 0.15;
/* the ceiling is real: feet stop where a standing head grazes plaster */
export const LOBBY_MAX_FEET_Y = LOBBY_ROOM.height - 1.7;

/* circle colliders for the furniture the client builds at these spots.
   `h` is the collider height flung debris bounces off; `stand` is where a
   jumping player's feet rest, when that differs (the couch blocks at
   backrest height but you stand on the cushions). Small clutter (bottles,
   butts, papers) is client-only decoration and deliberately absent — you
   wade through trash, you don't trip on it. */
export interface LobbyObstacle {
  x: number;
  z: number;
  r: number;
  h: number;
  stand?: number;
}
export const LOBBY_OBSTACLES: LobbyObstacle[] = [
  { x: -2.4, z: -2.75, r: 0.62, h: 0.85, stand: 0.45 }, // couch, left cushion (against -Z wall)
  { x: -1.3, z: -2.75, r: 0.62, h: 0.85, stand: 0.45 }, // couch, right cushion
  { x: -1.85, z: -1.45, r: 0.62, h: 0.43 }, // coffee table in front of it
  { x: 1.7, z: -1.5, r: 0.4, h: 1.03 }, // round bar table A
  { x: 2.9, z: 0.6, r: 0.4, h: 1.03 }, // round bar table B
  { x: 1.15, z: -1.9, r: 0.2, h: 0.63 }, // stool at table A, door side
  { x: 2.25, z: -1.15, r: 0.2, h: 0.63 }, // stool at table A, room side
  { x: 3.3, z: 1.25, r: 0.2, h: 0.63 }, // stool at table B
  { x: -3.55, z: 2.35, r: 0.62, h: 1.55 }, // jukebox in the far corner
  { x: 3.6, z: 2.3, r: 0.5, h: 1.5 }, // cigarette machine by the door
  { x: -3.75, z: -2.7, r: 0.3, h: 0.3 }, // dead potted plant, corner
  { x: 0.62, z: -2.9, r: 0.22, h: 0.8 }, // standing ashtray by the couch
  { x: -3.75, z: 0.0, r: 0.45, h: 1.4 }, // beer fridge, -X wall (a dispenser)
];

/* pre-game dispensers: stand within DISPENSE_RADIUS of one with empty hands
   and the dispense intent hands you a free throwable of its kind. Cigars
   come from the cigarette machine, beers from the fridge. */
export const LOBBY_DISPENSERS: { kind: ViceKind; x: number; z: number }[] = [
  { kind: "cigar", x: 3.6, z: 2.3 },
  { kind: "beer", x: -3.75, z: 0.0 },
];
export const DISPENSE_RADIUS = 1.35;
/* the door back to the table, +Z wall — the leader starts the game from
   here: stand within DOOR_RADIUS and press E. Purely a client-side
   interaction anchor; the sim gates startGame on leadership, not position. */
export const LOBBY_DOOR = { x: 0.6, z: LOBBY_ROOM.halfD };
export const DOOR_RADIUS = 1.2;
/* on your feet you can walk to litter — no need for the table's room-wide
   seated reach */
export const LOBBY_REACH = 2.2;

/* where joiners appear (indexed by seat, so re-seats reuse spots), facing
   the door on the +Z wall. yaw convention matches seatAngle: 0 faces +Z,
   facing dir = (sin yaw, cos yaw). */
export const LOBBY_SPAWNS: { x: number; z: number; yaw: number }[] = [
  { x: 0, z: 0.2, yaw: 0 },
  { x: -1.0, z: -0.3, yaw: 0.3 },
  { x: 1.0, z: -0.3, yaw: -0.3 },
  { x: -1.9, z: 0.5, yaw: 0.5 },
  { x: 1.9, z: 0.5, yaw: -0.5 },
];

/* the moving parts of one walker: position plus the vertical state the
   step integrates. Player (sim) and the client's local predictor both
   satisfy this shape and share the exact same step. */
export interface LobbyMotion {
  pos: V3;
  vy: number;
  grounded: boolean;
}

/* one kinematic step: pos += dir · speed · dt, resolve walls and furniture,
   then integrate gravity and land on whatever is underfoot. dir is a
   world-space input direction (client already rotated keys by camera yaw);
   anything over unit length is normalized down so a doctored client can't
   speed-hack. Mutates m. */
export function stepLobbyMove(m: LobbyMotion, dirX: number, dirZ: number, dt: number): void {
  const pos = m.pos;
  const len = Math.hypot(dirX, dirZ);
  if (len > 1e-6) {
    const s = (len > 1 ? 1 / len : 1) * LOBBY_WALK_SPEED * dt;
    pos.x += dirX * s;
    pos.z += dirZ * s;
  }
  // furniture: push out of each circle whose top the feet can't clear
  // (one pass is plenty at walk speed)
  for (const o of LOBBY_OBSTACLES) {
    if (pos.y >= (o.stand ?? o.h) - LOBBY_MANTLE) continue; // high enough to be ON it
    const dx = pos.x - o.x;
    const dz = pos.z - o.z;
    const min = o.r + LOBBY_PLAYER_R;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    if (d < 1e-6) {
      pos.x = o.x + min; // dead center: eject along +X, deterministically
    } else {
      pos.x = o.x + (dx / d) * min;
      pos.z = o.z + (dz / d) * min;
    }
  }
  // walls last: a push-out from wall-hugging furniture must not eject
  // anyone through the drywall
  const maxX = LOBBY_ROOM.halfW - LOBBY_PLAYER_R;
  const maxZ = LOBBY_ROOM.halfD - LOBBY_PLAYER_R;
  pos.x = Math.max(-maxX, Math.min(maxX, pos.x));
  pos.z = Math.max(-maxZ, Math.min(maxZ, pos.z));

  // vertical: gravity, headroom, then land on the tallest top underfoot.
  // Overlapping a circle at all means the feet cleared its top (the
  // horizontal pass above enforces it), so any overlap is standable.
  m.vy -= LOBBY_GRAVITY * dt;
  pos.y += m.vy * dt;
  if (pos.y > LOBBY_MAX_FEET_Y) {
    pos.y = LOBBY_MAX_FEET_Y;
    m.vy = Math.min(m.vy, 0);
  }
  let ground = 0;
  for (const o of LOBBY_OBSTACLES) {
    const top = o.stand ?? o.h;
    if (top <= ground || pos.y < top - LOBBY_MANTLE) continue;
    const dx = pos.x - o.x;
    const dz = pos.z - o.z;
    const min = o.r + LOBBY_PLAYER_R;
    if (dx * dx + dz * dz < min * min) ground = top;
  }
  // land only on the way down — clipping a stool's rim mid-ascent must
  // not vacuum the jumper onto it
  if (m.vy <= 0 && pos.y <= ground) {
    pos.y = ground;
    m.vy = 0;
    m.grounded = true;
  } else if (pos.y < 0) {
    pos.y = 0; // safety net; unreachable while the maths above holds
    m.vy = 0;
    m.grounded = true;
  } else {
    m.grounded = false; // airborne — including the way up past a rim
  }
}
