/* Instanced rendering of dropped bottles / cigar butts / lobby toys.
   Flying items interpolate toward 20 Hz snapshot transforms; settled items
   pin exactly. One draw call per kind no matter how filthy the floor gets. */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MAX_DEBRIS, type V3 } from "@shared/constants";
import type { DebrisSnap, PropKind, Quat } from "@shared/types";

const PROP_KINDS: PropKind[] = ["beer", "cigar", "plunger", "stick", "paper", "can", "ashtray"];

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

/* Matches makePlungerMesh; capsule half-length 0.245, cup down. */
function plungerGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.045, 0.07, 0.11, 14), 0x7a2417, -0.19),
    colored(new THREE.CylinderGeometry(0.016, 0.016, 0.38, 10), 0xb08a4a, 0.055),
    colored(new THREE.CylinderGeometry(0.024, 0.024, 0.025, 10), 0xb08a4a, 0.235),
  ])!;
}

/* Matches makeStickMesh; a bar-room cue, capsule half-length 0.448. */
function stickGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.012, 0.017, 0.87, 8), 0x9a7742, -0.005),
    colored(new THREE.CylinderGeometry(0.0145, 0.017, 0.12, 8), 0x2a1c10, -0.38),
    colored(new THREE.CylinderGeometry(0.0125, 0.0125, 0.03, 8), 0xd9c69a, 0.415),
    colored(new THREE.CylinderGeometry(0.0115, 0.0125, 0.014, 8), 0x4a3d22, 0.437),
  ])!;
}

/* Matches the old buildTrash décor: a crumpled ball, squashed a little. */
function paperGeometry(): THREE.BufferGeometry {
  return colored(new THREE.IcosahedronGeometry(0.045, 0).scale(1, 0.7, 1), 0xcfc3a4, 0);
}

/* Matches makeCanMesh; a crushed can, kinked at the shoulder. */
function canGeometry(): THREE.BufferGeometry {
  const alu = 0xb6ad9c;
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.031, 0.033, 0.05, 12).rotateZ(0.1), alu, -0.016),
    colored(new THREE.CylinderGeometry(0.0335, 0.0335, 0.022, 12).rotateZ(0.1), 0x7a2417, -0.012),
    colored(new THREE.CylinderGeometry(0.028, 0.031, 0.026, 12).rotateZ(-0.24), alu, 0.02),
    colored(new THREE.CylinderGeometry(0.026, 0.028, 0.006, 12).rotateZ(-0.24), 0x847d6e, 0.034),
  ])!;
}

/* Matches makeAshtrayMesh; heavy glass, ash and a dead butt baked in.
   Sits at the bottom of its capsule like the bottle does. */
function ashtrayGeometry(): THREE.BufferGeometry {
  const g = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.055, 0.045, 0.04, 14), 0x2e2417, 0.02),
    colored(new THREE.CylinderGeometry(0.048, 0.048, 0.01, 14), 0x9a958a, 0.036),
    colored(new THREE.CylinderGeometry(0.008, 0.008, 0.036, 6).rotateZ(1.35), 0x5a2f14, 0.046),
  ])!;
  g.translate(0, -0.05, 0);
  return g;
}

interface Tracked {
  kind: PropKind;
  phase: "flying" | "settled";
  pos: THREE.Vector3;
  rot: THREE.Quaternion;
  targetPos: THREE.Vector3;
  targetRot: THREE.Quaternion;
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);
const _plainColor = new THREE.Color(1, 1, 1);
const _hotColor = new THREE.Color(1.9, 1.5, 0.9); // >1 brightens: amber glow

export class DebrisView {
  private meshes: Record<PropKind, THREE.InstancedMesh>;
  /* instanceId -> debris id, per mesh, rebuilt every frame for pick-raycasts */
  private ids: Record<PropKind, number[]> = {
    beer: [],
    cigar: [],
    plunger: [],
    stick: [],
    paper: [],
    can: [],
    ashtray: [],
  };
  private tracked = new Map<number, Tracked>();
  private highlighted: number | null = null;

  constructor(scene: THREE.Scene) {
    const make = (
      geo: THREE.BufferGeometry,
      mat: THREE.MeshStandardMaterial
    ): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(geo, mat, MAX_DEBRIS);
      mesh.castShadow = true;
      // instances scatter across the room but the geometry's bounding sphere
      // sits at the origin — default culling makes debris blink out whenever
      // the table center leaves the frustum
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      return mesh;
    };
    this.meshes = {
      beer: make(
        bottleGeometry(),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1 })
      ),
      cigar: make(
        cigarGeometry(),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
      ),
      plunger: make(
        plungerGeometry(),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })
      ),
      stick: make(
        stickGeometry(),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })
      ),
      paper: make(
        paperGeometry(),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })
      ),
      can: make(
        canGeometry(),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6 })
      ),
      ashtray: make(
        ashtrayGeometry(),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3 })
      ),
    };
  }

  get pickables(): THREE.Object3D[] {
    return PROP_KINDS.map((k) => this.meshes[k]);
  }
  debrisIdFor(mesh: THREE.Object3D, instanceId: number): number | null {
    for (const k of PROP_KINDS) if (mesh === this.meshes[k]) return this.ids[k][instanceId] ?? null;
    return null;
  }

  info(id: number): { id: number; kind: PropKind; phase: string; pos: THREE.Vector3 } | null {
    const t = this.tracked.get(id);
    return t ? { id, kind: t.kind, phase: t.phase, pos: t.pos.clone() } : null;
  }

  /* fat-pick fallback: nearest item (settled OR rolling/flying) to the
     pointer ray, so clicking "near" a 2cm cigar — or a tumbling bottle —
     still grabs it */
  nearestToRay(
    ray: THREE.Ray,
    threshold: number
  ): { id: number; kind: PropKind; pos: THREE.Vector3 } | null {
    let best: { id: number; kind: PropKind; pos: THREE.Vector3 } | null = null;
    let bestD = threshold;
    for (const [id, t] of this.tracked) {
      const d = ray.distanceToPoint(t.pos);
      if (d < bestD) {
        bestD = d;
        best = { id, kind: t.kind, pos: t.pos.clone() };
      }
    }
    return best;
  }

  setHighlight(id: number | null): void {
    this.highlighted = id;
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
    for (const kind of PROP_KINDS) this.ids[kind].length = 0;
    for (const [id, t] of this.tracked) {
      if (t.phase === "flying") {
        t.pos.lerp(t.targetPos, k);
        t.rot.slerp(t.targetRot, k);
      } else {
        t.pos.copy(t.targetPos);
        t.rot.copy(t.targetRot);
      }
      const ids = this.ids[t.kind];
      if (ids.length >= MAX_DEBRIS) continue;
      _m.compose(t.pos, t.rot, _s);
      const mesh = this.meshes[t.kind];
      mesh.setMatrixAt(ids.length, _m);
      mesh.setColorAt(ids.length, id === this.highlighted ? _hotColor : _plainColor);
      ids.push(id);
    }
    for (const kind of PROP_KINDS) {
      const mesh = this.meshes[kind];
      mesh.count = this.ids[kind].length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

function toV(v: V3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}
function toQ(q: Quat): THREE.Quaternion {
  return new THREE.Quaternion(q.x, q.y, q.z, q.w);
}
