/* Instanced rendering of dropped bottles / cigar butts.
   Flying items interpolate toward 20 Hz snapshot transforms; settled items
   pin exactly. Two draw calls total no matter how filthy the floor gets. */
import * as THREE from "three";
import { MAX_DEBRIS, type V3 } from "@shared/constants";
import { DEBRIS_SHAPE } from "@shared/physics";
import type { DebrisSnap, Quat, ViceKind } from "@shared/types";

interface Tracked {
  kind: ViceKind;
  phase: "flying" | "settled";
  pos: THREE.Vector3;
  rot: THREE.Quaternion;
  targetPos: THREE.Vector3;
  targetRot: THREE.Quaternion;
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);

export class DebrisView {
  private bottles: THREE.InstancedMesh;
  private cigars: THREE.InstancedMesh;
  private tracked = new Map<number, Tracked>();
  /* instanceId -> debris id, per mesh, rebuilt every frame for pick-raycasts */
  bottleIds: number[] = [];
  cigarIds: number[] = [];

  constructor(scene: THREE.Scene) {
    const b = DEBRIS_SHAPE.beer;
    const bottleGeo = new THREE.CapsuleGeometry(b.radius, b.halfHeight * 2, 6, 12);
    const bottleMat = new THREE.MeshStandardMaterial({
      color: 0x6e401a,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.92,
    });
    this.bottles = new THREE.InstancedMesh(bottleGeo, bottleMat, MAX_DEBRIS);
    this.bottles.castShadow = true;

    const c = DEBRIS_SHAPE.cigar;
    const cigarGeo = new THREE.CylinderGeometry(c.radius, c.radius, c.halfHeight * 2 + c.radius, 8);
    const cigarMat = new THREE.MeshStandardMaterial({ color: 0x5a2f14, roughness: 0.85 });
    this.cigars = new THREE.InstancedMesh(cigarGeo, cigarMat, MAX_DEBRIS);
    this.cigars.castShadow = true;

    this.bottles.count = 0;
    this.cigars.count = 0;
    scene.add(this.bottles, this.cigars);
  }

  get pickables(): THREE.Object3D[] {
    return [this.bottles, this.cigars];
  }
  debrisIdFor(mesh: THREE.Object3D, instanceId: number): number | null {
    if (mesh === this.bottles) return this.bottleIds[instanceId] ?? null;
    if (mesh === this.cigars) return this.cigarIds[instanceId] ?? null;
    return null;
  }

  apply(debris: DebrisSnap[]): void {
    const seen = new Set<number>();
    for (const d of debris) {
      seen.add(d.id);
      const t = this.tracked.get(d.id);
      const tp = toV(d.pos);
      const tr = toQ(d.rot);
      if (!t) {
        this.tracked.set(d.id, {
          kind: d.kind,
          phase: d.phase,
          pos: tp.clone(),
          rot: tr.clone(),
          targetPos: tp,
          targetRot: tr,
        });
      } else {
        t.phase = d.phase;
        t.targetPos = tp;
        t.targetRot = tr;
      }
    }
    for (const id of [...this.tracked.keys()]) if (!seen.has(id)) this.tracked.delete(id);
  }

  frame(dt: number): void {
    const k = 1 - Math.exp(-dt * 14);
    let bi = 0,
      ci = 0;
    this.bottleIds.length = 0;
    this.cigarIds.length = 0;
    for (const [id, t] of this.tracked) {
      if (t.phase === "flying") {
        t.pos.lerp(t.targetPos, k);
        t.rot.slerp(t.targetRot, k);
      } else {
        t.pos.copy(t.targetPos);
        t.rot.copy(t.targetRot);
      }
      _m.compose(t.pos, t.rot, _s);
      if (t.kind === "beer") {
        if (bi < MAX_DEBRIS) {
          this.bottles.setMatrixAt(bi, _m);
          this.bottleIds[bi++] = id;
        }
      } else if (ci < MAX_DEBRIS) {
        this.cigars.setMatrixAt(ci, _m);
        this.cigarIds[ci++] = id;
      }
    }
    this.bottles.count = bi;
    this.cigars.count = ci;
    this.bottles.instanceMatrix.needsUpdate = true;
    this.cigars.instanceMatrix.needsUpdate = true;
  }
}

function toV(v: V3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}
function toQ(q: Quat): THREE.Quaternion {
  return new THREE.Quaternion(q.x, q.y, q.z, q.w);
}
