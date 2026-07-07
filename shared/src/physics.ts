/* Rapier world construction + debris body helpers. Runs identically in the
   client web worker and the Node server — that shared config is what makes
   client prediction match server results later. */
import RAPIER from "@dimforge/rapier3d-compat";
import { TABLE, type V3 } from "./constants";
import type { Quat, ViceKind } from "./types";

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

  // table top: felt, deadens bounces
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(0.04, TABLE.radius)
      .setTranslation(0, TABLE.height - 0.04, 0)
      .setFriction(0.9)
      .setRestitution(0.05)
  );

  // wooden rim approximated by 14 cuboid segments around the edge
  const SEGS = 14;
  for (let i = 0; i < SEGS; i++) {
    const a = (i / SEGS) * Math.PI * 2;
    const halfLen = (Math.PI * TABLE.rimRadius) / SEGS + 0.02;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfLen, TABLE.rimTube, TABLE.rimTube)
        .setTranslation(
          Math.sin(a) * TABLE.rimRadius,
          TABLE.height + TABLE.rimTube * 0.6,
          Math.cos(a) * TABLE.rimRadius
        )
        .setRotation({ x: 0, y: Math.sin((a + Math.PI / 2) / 2), z: 0, w: Math.cos((a + Math.PI / 2) / 2) })
        .setFriction(0.6)
        .setRestitution(0.2)
    );
  }

  return world;
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
