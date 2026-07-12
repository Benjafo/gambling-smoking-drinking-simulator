/* The held empty (bottle/butt) after a ritual, and the grab-and-fling
   gesture. Throw velocity comes from a short ring buffer of hand positions —
   release speed and direction are the player's. */
import * as THREE from "three";
import { MAX_FLING_SPEED, type V3 } from "@shared/constants";
import type { Intent, PlayerSnap, ViceKind } from "@shared/types";
import { pickupSound } from "./effects";

export function makeBottleMesh(): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({
    color: 0x6e401a,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.92,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.036, 0.13, 14), glass);
  body.position.y = 0.0;
  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.034, 0.045, 14), glass);
  shoulder.position.y = 0.088;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.05, 10), glass);
  neck.position.y = 0.133;
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0365, 0.0375, 0.05, 14),
    new THREE.MeshStandardMaterial({ color: 0xd9c69a, roughness: 0.8 })
  );
  label.position.y = 0.005;
  g.add(body, shoulder, neck, label);
  return g;
}

export function makeCigarMesh(spent: boolean): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.11, 10),
    new THREE.MeshStandardMaterial({ color: 0x5a2f14, roughness: 0.85 })
  );
  const ash = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0122, 0.0122, 0.02, 10),
    new THREE.MeshStandardMaterial({ color: 0x9a958a, roughness: 1 })
  );
  ash.position.y = 0.062;
  const ember = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0121, 0.0121, 0.006, 10),
    new THREE.MeshStandardMaterial({
      color: 0xff7a30,
      emissive: 0xe0522b,
      emissiveIntensity: spent ? 0.4 : 2.2,
    })
  );
  ember.position.y = 0.051;
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0125, 0.0125, 0.012, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8c469, metalness: 0.5, roughness: 0.35 })
  );
  band.position.y = -0.03;
  g.add(body, ash, ember, band);
  return g;
}

const HAND_OFFSET = new THREE.Vector3(0.3, -0.26, -0.72);

export class HeldItemControl {
  private heldId: number | null = null;
  private mesh: THREE.Group | null = null;
  private grabbing = false;
  private grabPoint = new THREE.Vector3();
  private samples: { p: THREE.Vector3; t: number }[] = [];
  private raycaster = new THREE.Raycaster();
  /* optimistic floor-grab: mesh exists before the sim confirms the pickup */
  private pendingKind: ViceKind | null = null;
  private pendingTtl = 0;
  /* how the current grab started — a ritual-finish release drops in place
     instead of tucking back to the hand */
  private grabSource: "hand" | "floor" | "ritual" = "hand";
  private pendingFling: { origin: THREE.Vector3; vel: THREE.Vector3; angVel: THREE.Vector3 } | null =
    null;
  private denyUntil = 0;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private send: (intent: Intent) => void
  ) {}

  get isGrabbing(): boolean {
    return this.grabbing;
  }
  get hasHeld(): boolean {
    return this.heldId !== null;
  }
  /* world position of a confirmed held item mid-drag — streamed to the sim
     so other players watch the wind-up */
  grabWorldPos(): THREE.Vector3 | null {
    return this.grabbing && this.heldId !== null && this.mesh ? this.mesh.position : null;
  }

  apply(me: PlayerSnap | undefined): void {
    const held = me?.held ?? null;
    if (held && held.id !== this.heldId) {
      if (this.pendingKind === held.kind && this.mesh) {
        // sim confirmed our optimistic floor-grab: adopt the id, keep the
        // mesh and whatever drag is in progress
        this.heldId = held.id;
        this.pendingKind = null;
        if (this.pendingFling) {
          const f = this.pendingFling;
          this.pendingFling = null;
          this.send({
            type: "fling",
            itemId: held.id,
            origin: v3(f.origin),
            vel: v3(f.vel),
            angVel: v3(f.angVel),
          });
          this.dropMesh();
        }
        return;
      }
      this.dropMesh();
      this.heldId = held.id;
      this.mesh = held.kind === "beer" ? makeBottleMesh() : makeCigarMesh(true);
      this.mesh.add(hitProxy());
      this.scene.add(this.mesh);
    } else if (!held && this.heldId !== null) {
      this.dropMesh();
    } else if (!held && this.pendingKind) {
      // grab not confirmed yet (or rejected — e.g. another player took it)
      if (--this.pendingTtl <= 0) this.dropMesh();
    }
  }

  /* pointerdown landed on settled debris: enter the drag state immediately;
     the pickup intent is in flight and apply() reconciles the answer */
  beginFloorGrab(kind: ViceKind, worldPos: THREE.Vector3): void {
    this.dropMesh();
    this.pendingKind = kind;
    this.pendingTtl = 20; // snapshots (~1s) before we give up on the sim
    this.mesh = kind === "beer" ? makeBottleMesh() : makeCigarMesh(true);
    this.mesh.add(hitProxy());
    this.mesh.position.copy(worldPos);
    this.scene.add(this.mesh);
    this.grabbing = true;
    this.grabSource = "floor";
    this.samples = [];
    this.grabPoint.copy(worldPos);
    pickupSound();
  }

  /* a ritual just finished with the pointer still down: the fresh empty
     (created by apply() this same snapshot) is grabbed in place — the
     player flings or drops it from right there, no second click */
  grabAt(worldPos: THREE.Vector3): void {
    if (!this.mesh) return;
    this.mesh.position.copy(worldPos);
    this.grabbing = true;
    this.grabSource = "ritual";
    this.samples = [];
    this.grabPoint.copy(worldPos);
  }

  /* returns true if the pointer event was consumed (grabbed the held item) */
  pointerDown(ndc: THREE.Vector2): boolean {
    if (!this.mesh || this.heldId === null) return false;
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.mesh, true);
    if (hit.length === 0) return false;
    this.grabbing = true;
    this.grabSource = "hand";
    this.samples = [];
    return true;
  }

  /* the pointer-locked entry to the wind-up: the crosshair can never point
     at your own hand (the empty rides the camera, always off-center), so a
     click while holding grabs it sight unseen */
  grabHeld(): boolean {
    if (!this.mesh || this.heldId === null || this.grabbing) return false;
    this.grabbing = true;
    this.grabSource = "hand";
    this.samples = [];
    return true;
  }

  pointerMove(ndc: THREE.Vector2): void {
    if (!this.grabbing || !this.mesh) return;
    this.raycaster.setFromCamera(ndc, this.camera);
    this.grabPoint
      .copy(this.raycaster.ray.origin)
      .addScaledVector(this.raycaster.ray.direction, 0.75);
    const now = performance.now();
    this.samples.push({ p: this.grabPoint.clone(), t: now });
    while (this.samples.length && now - this.samples[0].t > 130) this.samples.shift();
  }

  pointerUp(): void {
    if (!this.grabbing || !this.mesh) {
      this.grabbing = false;
      return;
    }
    this.grabbing = false;

    // barely moved: for hand/floor grabs that's "take it into the hand" —
    // but releasing a just-finished ritual means "drop it right here"
    const travel =
      this.samples.length >= 2
        ? this.samples[this.samples.length - 1].p.distanceTo(this.samples[0].p)
        : 0;
    if (travel < 0.03 && this.grabSource !== "ritual") return;

    let vel = new THREE.Vector3();
    if (this.samples.length >= 2) {
      const first = this.samples[0];
      const last = this.samples[this.samples.length - 1];
      const dt = Math.max(0.016, (last.t - first.t) / 1000);
      vel = last.p.clone().sub(first.p).divideScalar(dt).multiplyScalar(1.15);
    }
    // a flick carries forward momentum, not just sideways
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    vel.addScaledVector(fwd, vel.length() * 0.4);
    if (vel.length() > MAX_FLING_SPEED) vel.setLength(MAX_FLING_SPEED);
    if (vel.length() < 0.7) {
      // limp release: just let it fall out of the hand
      vel.set(fwd.x * 0.6, 0.2, fwd.z * 0.6);
    }
    const speed = vel.length();
    const angVel = new THREE.Vector3(
      (Math.random() - 0.5) * speed * 3,
      (Math.random() - 0.5) * speed * 1.5,
      (Math.random() - 0.5) * speed * 3
    );
    const origin = this.mesh.position.clone();

    if (this.heldId === null) {
      // floor-grab not confirmed yet: queue the throw, apply() fires it
      this.pendingFling = { origin, vel, angVel };
      return;
    }
    this.send({
      type: "fling",
      itemId: this.heldId,
      origin: v3(origin),
      vel: v3(vel),
      angVel: v3(angVel),
    });
    // optimistic: hand empties now; the sim's debris body appears next snapshot
    this.dropMesh();
  }

  /* keyboard fling: the empty sails along the gaze — aimed with the
     crosshair, no wind-up. Same intent the whip release sends, so the sim
     can't tell the difference. */
  quickFling(): boolean {
    if (!this.mesh || (this.heldId === null && this.pendingKind === null)) return false;
    this.grabbing = false;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const vel = fwd.multiplyScalar(MAX_FLING_SPEED * 0.75);
    vel.y += 1.2; // a touch of arc — a throw, not a laser
    if (vel.length() > MAX_FLING_SPEED) vel.setLength(MAX_FLING_SPEED);
    const speed = vel.length();
    const angVel = new THREE.Vector3(
      (Math.random() - 0.5) * speed * 3,
      (Math.random() - 0.5) * speed * 1.5,
      (Math.random() - 0.5) * speed * 3
    );
    const origin = this.mesh.position.clone();
    if (this.heldId === null) {
      // floor-grab not confirmed yet: queue the throw, apply() fires it
      this.pendingFling = { origin, vel, angVel };
      return true;
    }
    this.send({
      type: "fling",
      itemId: this.heldId,
      origin: v3(origin),
      vel: v3(vel),
      angVel: v3(angVel),
    });
    this.dropMesh();
    return true;
  }

  /* session teardown: retire the mesh, confirmed or optimistic alike */
  reset(): void {
    this.dropMesh();
  }

  /* hands-full pickup denied: pulse the held item red twice */
  flashDeny(): void {
    if (!this.mesh || this.denyUntil > performance.now()) return;
    this.denyUntil = performance.now() + 450;
    this.mesh.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mat?.emissive) {
        const orig = mat.emissive.clone();
        const origIntensity = mat.emissiveIntensity;
        mat.emissive.setHex(0xd02010);
        mat.emissiveIntensity = 1.6;
        setTimeout(() => {
          mat.emissive.copy(orig);
          mat.emissiveIntensity = origIntensity;
          setTimeout(() => {
            mat.emissive.setHex(0xd02010);
            mat.emissiveIntensity = 1.6;
            setTimeout(() => {
              mat.emissive.copy(orig);
              mat.emissiveIntensity = origIntensity;
            }, 130);
          }, 90);
        }, 130);
      }
    });
  }

  frame(dt: number): void {
    if (!this.mesh) return;
    if (this.grabbing) {
      this.mesh.position.lerp(this.grabPoint, 1 - Math.exp(-dt * 30));
    } else if (this.pendingFling) {
      // released mid-air, waiting for the sim to confirm — hold the pose
    } else {
      this.mesh.position.copy(this.camAnchor(HAND_OFFSET));
      this.mesh.position.y += Math.sin(performance.now() / 600) * 0.006; // idle bob
    }
    this.mesh.quaternion.copy(this.camera.quaternion);
    this.mesh.rotateZ(0.35);
  }

  private camAnchor(offset: THREE.Vector3): THREE.Vector3 {
    return offset.clone().applyQuaternion(this.camera.quaternion).add(this.camera.position);
  }

  private dropMesh(): void {
    if (this.mesh) this.scene.remove(this.mesh);
    this.mesh = null;
    this.heldId = null;
    this.grabbing = false;
    this.pendingKind = null;
    this.pendingFling = null;
  }
}

/* invisible sphere that fattens the held item's raycast target — grabbing a
   2cm cigar with a naked mesh raycast is pixel hunting */
function hitProxy(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 6),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  m.name = "hitProxy";
  return m;
}

function v3(v: THREE.Vector3): V3 {
  return { x: v.x, y: v.y, z: v.z };
}
