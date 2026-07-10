/* The waiting room: a small back room off the bar where players mill around
   until the leader starts the game. This module is the single source of
   truth for its geometry — the sim collides against it, the client renders
   furniture at these exact coordinates AND predicts local movement with the
   same stepLobbyMove(), so prediction never diverges from the server.

   Coordinate space is room-local (origin at room center, y=0 floor) and
   entirely separate from the table world — the client renders it as its own
   scene. Movement is kinematic: no Rapier, just walls + circle push-outs,
   deterministic and cheap. */
import type { V3 } from "./constants";

export const LOBBY_WALK_SPEED = 2.1; // m/s — a saunter, not a sprint
export const LOBBY_PLAYER_R = 0.28;
export const LOBBY_EYE_HEIGHT = 1.5; // matches the table's seated eye
/* inner walkable half-extents (walls sit just outside) */
export const LOBBY_ROOM = { halfW: 4.2, halfD: 3.2, height: 2.75 };

/* circle colliders for the furniture the client builds at these spots.
   Small clutter (bottles, butts, papers) is client-only decoration and
   deliberately absent — you wade through trash, you don't trip on it. */
export interface LobbyObstacle {
  x: number;
  z: number;
  r: number;
}
export const LOBBY_OBSTACLES: LobbyObstacle[] = [
  { x: -2.4, z: -2.75, r: 0.62 }, // couch, left cushion (against -Z wall)
  { x: -1.3, z: -2.75, r: 0.62 }, // couch, right cushion
  { x: -1.85, z: -1.45, r: 0.62 }, // coffee table in front of it
  { x: 1.7, z: -1.5, r: 0.4 }, // round bar table A
  { x: 2.9, z: 0.6, r: 0.4 }, // round bar table B
  { x: -3.55, z: 2.35, r: 0.62 }, // jukebox in the far corner
  { x: 3.6, z: 2.3, r: 0.5 }, // cigarette machine by the door
  { x: -3.75, z: -2.7, r: 0.3 }, // dead potted plant, corner
  { x: 0.62, z: -2.9, r: 0.22 }, // standing ashtray by the couch
];

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

/* one kinematic step: pos += dir · speed · dt, then resolve walls and
   furniture. dir is a world-space input direction (client already rotated
   keys by camera yaw); anything over unit length is normalized down so a
   doctored client can't speed-hack. Mutates and returns pos. */
export function stepLobbyMove(pos: V3, dirX: number, dirZ: number, dt: number): V3 {
  const len = Math.hypot(dirX, dirZ);
  if (len > 1e-6) {
    const s = (len > 1 ? 1 / len : 1) * LOBBY_WALK_SPEED * dt;
    pos.x += dirX * s;
    pos.z += dirZ * s;
  }
  // furniture: push out of each circle (one pass is plenty at walk speed)
  for (const o of LOBBY_OBSTACLES) {
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
  pos.y = 0;
  return pos;
}
