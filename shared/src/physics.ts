/* Rapier world construction + debris body helpers. Runs identically in the
   client web worker and the Node server — that shared config is what makes
   client prediction match server results later. */
import RAPIER from "@dimforge/rapier3d-compat";
import { CARD_H, CARD_W, DEN_ROOM, TABLE, type V3 } from "./constants";
import { LOBBY_OBSTACLES, LOBBY_ROOM } from "./lobbyRoom";
import type { PropKind, Quat } from "./types";

/* The waiting room's physics lives in the SAME world as the table, parked
  100m away so nothing ever collides across rooms. The sim adds/strips this
   offset at the room boundary; everything outside physics.ts speaks
   room-local coordinates. */
export const LOBBY_WORLD_OFFSET: V3 = { x: 100, y: 0, z: 0 };

let rapierReady: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}
export { RAPIER };

export const DEBRIS_SHAPE: Record<
  PropKind,
  { halfHeight: number; radius: number; density: number; restitution: number }
> = {
  beer: { halfHeight: 0.09, radius: 0.035, density: 400, restitution: 0.35 },
  cigar: { halfHeight: 0.055, radius: 0.012, density: 300, restitution: 0.15 },
  /* the toys: a rubber cup bounces, a wooden cue mostly doesn't */
  plunger: { halfHeight: 0.175, radius: 0.07, density: 250, restitution: 0.45 },
  stick: { halfHeight: 0.43, radius: 0.018, density: 500, restitution: 0.25 },
  /* the trash: paper barely has mass and flies like an apology, a crushed
     can skitters, the glass ashtray lands like a verdict */
  paper: { halfHeight: 0.002, radius: 0.033, density: 30, restitution: 0.3 },
  can: { halfHeight: 0.022, radius: 0.032, density: 120, restitution: 0.5 },
  ashtray: { halfHeight: 0.005, radius: 0.045, density: 850, restitution: 0.08 },
};

/* capsules have no rolling resistance and would roll forever; damping
   stands in for it and lets bodies actually reach sleep */
export const DEBRIS_LIN_DAMPING = 0.25;
export const DEBRIS_ANG_DAMPING = 1.2;
/* litter touching a dealt card below this speed grips hard (the sim swaps
   in the damping below): every card leans at least a little, and a cylinder
   rolls off ANY slope — without the grip, burying a rival's hand in trash
   never sticks. Restored to the defaults when the cards go away. */
export const CARD_STICK_SPEED = 2.0;
export const CARD_STICK_LIN_DAMPING = 6;
export const CARD_STICK_ANG_DAMPING = 12;

export function createWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;

  // floor: top surface at y=0
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(12, 0.1, 12)
      .setTranslation(0, -0.1, 0)
      .setFriction(0.85)
      .setRestitution(0.3)
  );

  // table top: felt, deadens bounces. NOT a cylinder collider — Rapier's
  // analytic cylinder generates single-point contact manifolds against thin
  // capsules, which let resting debris embed and slowly sink through the
  // slab (measured: 4.5% of hard flings fell through). Eight overlapping
  // rotated planks give polygon-clipped cuboid contacts with coplanar tops.
  const PLANKS = 8;
  const feltHalfThick = 0.35;
  for (let i = 0; i < PLANKS; i++) {
    const rot = (i / PLANKS) * Math.PI;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(TABLE.radius, feltHalfThick, 0.34)
        .setTranslation(0, TABLE.height - feltHalfThick, 0)
        .setRotation({ x: 0, y: Math.sin(rot / 2), z: 0, w: Math.cos(rot / 2) })
        .setFriction(0.9)
        .setRestitution(0.05)
    );
  }

  // wooden rim approximated by 14 cuboid segments around the edge
  const SEGS = 14;
  for (let i = 0; i < SEGS; i++) {
    const a = (i / SEGS) * Math.PI * 2;
    const halfLen = (Math.PI * TABLE.rimRadius) / SEGS + 0.02;
    // long axis rotated to the tangent at angle a (from +z toward +x)
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfLen, TABLE.rimTube, TABLE.rimTube)
        .setTranslation(
          Math.sin(a) * TABLE.rimRadius,
          TABLE.height + TABLE.rimTube * 0.6,
          Math.cos(a) * TABLE.rimRadius
        )
        .setRotation({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) })
        .setFriction(0.6)
        .setRestitution(0.2)
    );
  }

  addDenRoomColliders(world);
  addLobbyRoomColliders(world);
  return world;
}

/* the den's shell: four walls and a ceiling matching the room the client
   draws, so a hard fling clatters off the drywall instead of sailing into
   the void and resting outside the visible room. Cuboids, per the tabletop
   plank rule — cuboid-vs-capsule contacts are the stable kind. */
function addDenRoomColliders(world: RAPIER.World): void {
  const { halfW, halfD, height, centerZ } = DEN_ROOM;
  // ceiling — skyward flings come back down into the room
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfW + 0.3, 0.1, halfD + 0.3)
      .setTranslation(0, height + 0.1, centerZ)
      .setFriction(0.6)
      .setRestitution(0.2)
  );
  // walls: inner faces exactly at the visual wall planes
  const wallSpecs: [number, number, number, number][] = [
    // [hx, hz, x, z]
    [halfW + 0.3, 0.15, 0, centerZ - halfD - 0.15],
    [halfW + 0.3, 0.15, 0, centerZ + halfD + 0.15],
    [0.15, halfD + 0.3, -halfW - 0.15, centerZ],
    [0.15, halfD + 0.3, halfW + 0.15, centerZ],
  ];
  for (const [hx, hz, x, z] of wallSpecs) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, height / 2 + 0.2, hz)
        .setTranslation(x, height / 2, z)
        .setFriction(0.5)
        .setRestitution(0.3)
    );
  }
}

/* the waiting room, rebuilt as static colliders at LOBBY_WORLD_OFFSET so
   pre-game litter has something to clatter against: carpet, four walls, a
   ceiling, and the furniture circles as cuboids (cuboid-vs-capsule contacts
   are the stable kind — see the tabletop plank comment above) */
function addLobbyRoomColliders(world: RAPIER.World): void {
  const { x: OX, z: OZ } = LOBBY_WORLD_OFFSET;
  const { halfW, halfD, height } = LOBBY_ROOM;

  // carpet: top surface at y=0, softer bounce than the den's floor
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfW + 0.3, 0.1, halfD + 0.3)
      .setTranslation(OX, -0.1, OZ)
      .setFriction(0.9)
      .setRestitution(0.2)
  );
  // ceiling — hard skyward flings come back down where they belong
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfW + 0.3, 0.1, halfD + 0.3)
      .setTranslation(OX, height + 0.1, OZ)
      .setFriction(0.6)
      .setRestitution(0.2)
  );
  // walls sit just outside the walkable half-extents, like the drywall does
  const wallSpecs: [number, number, number, number][] = [
    // [hx, hz, x, z] half-extents and center, in room-local terms
    [halfW + 0.3, 0.15, 0, -halfD - 0.15],
    [halfW + 0.3, 0.15, 0, halfD + 0.15],
    [0.15, halfD + 0.3, -halfW - 0.15, 0],
    [0.15, halfD + 0.3, halfW + 0.15, 0],
  ];
  for (const [hx, hz, x, z] of wallSpecs) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, height / 2 + 0.2, hz)
        .setTranslation(OX + x, height / 2, OZ + z)
        .setFriction(0.5)
        .setRestitution(0.3)
    );
  }
  // furniture: each collision circle becomes a box of its height. The
  // square-in-circle mismatch is invisible under the clutter.
  for (const o of LOBBY_OBSTACLES) {
    const half = o.r * 0.8;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half, o.h / 2, half)
        .setTranslation(OX + o.x, o.h / 2, OZ + o.z)
        .setFriction(0.7)
        .setRestitution(0.25)
    );
  }
}

/* a dealt card as physics: a thin static plate matching the mesh the
   renderer places via the same cardSlot() math. Grippy and dead so litter
   stays put on a covered hand instead of sliding off. */
export function cardColliderDesc(pos: V3, rot: Quat, scale: number): RAPIER.ColliderDesc {
  return RAPIER.ColliderDesc.cuboid((CARD_W * scale) / 2, (CARD_H * scale) / 2, 0.004)
    .setTranslation(pos.x, pos.y, pos.z)
    .setRotation(rot)
    .setFriction(0.85)
    .setRestitution(0.05);
}

export function spawnDebrisBody(
  world: RAPIER.World,
  kind: PropKind,
  origin: V3,
  vel: V3,
  angVel: V3,
  rot?: Quat
): RAPIER.RigidBody {
  const shape = DEBRIS_SHAPE[kind];
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(origin.x, origin.y, origin.z)
    .setLinvel(vel.x, vel.y, vel.z)
    .setAngvel(angVel)
    .setCcdEnabled(true)
    .setLinearDamping(DEBRIS_LIN_DAMPING)
    .setAngularDamping(DEBRIS_ANG_DAMPING);
  if (rot) desc.setRotation(rot);
  const body = world.createRigidBody(desc);
  world.createCollider(
    RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius)
      .setDensity(shape.density)
      .setFriction(0.7)
      .setRestitution(shape.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body
  );
  return body;
}
