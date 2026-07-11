/* Rapier world construction + debris body helpers. Runs identically in the
   client web worker and the Node server — that shared config is what makes
   client prediction match server results later. */
import RAPIER from "@dimforge/rapier3d-compat";
import { DEN_ROOM, TABLE, type V3 } from "./constants";
import { LOBBY_OBSTACLES, LOBBY_ROOM } from "./lobbyRoom";
import type { Quat, ViceKind } from "./types";

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

export const DEBRIS_SHAPE: Record<ViceKind, { halfHeight: number; radius: number; density: number }> = {
  beer: { halfHeight: 0.09, radius: 0.035, density: 400 },
  cigar: { halfHeight: 0.055, radius: 0.012, density: 300 },
};

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

export function spawnDebrisBody(
  world: RAPIER.World,
  kind: ViceKind,
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
    // capsules have no rolling resistance and would roll forever; damping
    // stands in for it and lets bodies actually reach sleep
    .setLinearDamping(0.25)
    .setAngularDamping(1.2);
  if (rot) desc.setRotation(rot);
  const body = world.createRigidBody(desc);
  world.createCollider(
    RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius)
      .setDensity(shape.density)
      .setFriction(0.7)
      .setRestitution(kind === "beer" ? 0.35 : 0.15)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body
  );
  return body;
}
