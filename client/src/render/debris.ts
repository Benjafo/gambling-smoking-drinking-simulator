/* Instanced rendering of dropped bottles / cigar butts.
   Flying items interpolate toward 20 Hz snapshot transforms; settled items
   pin exactly. Two draw calls total no matter how filthy the floor gets. */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MAX_DEBRIS, type V3 } from "@shared/constants";
import type { DebrisSnap, Quat, ViceKind } from "@shared/types";

/* Paint a whole sub-geometry one color so merged parts can share a single
   vertex-colored material — keeps debris at one draw call per kind. */
function colored(geo: THREE.BufferGeometry, color: number, y: number): THREE.BufferGeometry {
  geo.translate(0, y, 0);
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/* Matches makeBottleMesh proportions; centered on the physics capsule. */
function bottleGeometry(): THREE.BufferGeometry {
  const glass = 0x6e401a;
  const g = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.034, 0.036, 0.13, 14), glass, 0),
    colored(new THREE.CylinderGeometry(0.014, 0.034, 0.045, 14), glass, 0.088),
    colored(new THREE.CylinderGeometry(0.013, 0.013, 0.05, 10), glass, 0.133),
    colored(new THREE.CylinderGeometry(0.0365, 0.0375, 0.05, 14), 0xd9c69a, 0.005),
    colored(new THREE.CylinderGeometry(0.0135, 0.0135, 0.008, 10), 0xe6c34a, 0.161),
  ])!;
  g.translate(0, -0.047, 0);
  return g;
}

function cigarGeometry(): THREE.BufferGeometry {
  const g = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.012, 0.012, 0.11, 10), 0x5a2f14, 0),
    colored(new THREE.CylinderGeometry(0.0122, 0.0122, 0.02, 10), 0x9a958a, 0.062),
    colored(new THREE.CylinderGeometry(0.0121, 0.0121, 0.006, 10), 0xc25a2a, 0.051),
    colored(new THREE.CylinderGeometry(0.0125, 0.0125, 0.012, 10), 0xe8c469, -0.03),
  ])!;
  g.translate(0, -0.009, 0);
  return g;
}

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
    const bottleMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.25,
      metalness: 0.1,
    });
    this.bottles = new THREE.InstancedMesh(bottleGeometry(), bottleMat, MAX_DEBRIS);
    this.bottles.castShadow = true;

    const cigarMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.cigars = new THREE.InstancedMesh(cigarGeometry(), cigarMat, MAX_DEBRIS);
    this.cigars.castShadow = true;

    // instances scatter across the room but the geometry's bounding sphere
    // sits at the origin — default culling makes debris blink out whenever
    // the table center leaves the frustum
    this.bottles.frustumCulled = false;
    this.cigars.frustumCulled = false;

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
