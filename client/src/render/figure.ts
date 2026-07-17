/* The clay-figure regulars, shared by the table scene (seated, posed arms)
   and the lobby room (standing, walk-cycle legs). Split out of scene.ts so
   both scenes can build the same people without importing each other.

   Players arrive as an Appearance (palette indices, sanitized by the sim);
   lookOf() resolves it to hexes. Non-player figures (the dealer, the
   mirror's preview) can hand-build a FigureLook with colors outside the
   player palettes. */
import * as THREE from "three";
import {
  ACC_CHAIN,
  ACC_EAR_CIGAR,
  ACC_MUSTACHE,
  ACC_NONE,
  ACC_SHADES,
  HAT_BARE,
  HAT_COLORS,
  HAT_COWBOY,
  HAT_FLATCAP,
  HAT_VISOR,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  type Appearance,
} from "@shared/appearance";

const UP = new THREE.Vector3(0, 1, 0);
const _seg = new THREE.Vector3();

/* a figure's resolved wardrobe: raw hexes + silhouette picks */
export interface FigureLook {
  shirt: number;
  skin: number;
  pants: number;
  hat: { style: number; color: number } | null;
  accessory: number;
}

export function lookOf(a: Appearance): FigureLook {
  return {
    shirt: SHIRT_COLORS[a.shirt],
    skin: SKIN_TONES[a.skin],
    pants: PANTS_COLORS[a.pants],
    hat: a.hat === HAT_BARE ? null : { style: a.hat, color: HAT_COLORS[a.hatColor] },
    accessory: a.accessory,
  };
}

/* one arm: shoulder-anchored capsule aimed at the hand sphere; poseArm()
   glues the hand to a target and stretches the arm to it */
export interface ArmRig {
  arm: THREE.Mesh;
  hand: THREE.Mesh;
  shoulder: THREE.Vector3;
  rest: THREE.Vector3;
}

/* natural capsule length of an arm (0.24 shaft + two 0.048 caps) */
const ARM_LEN = 0.336;

/* Single-segment stretchy IK, true to the clay-figure look: the hand sits
   exactly on `target`, and the arm capsule spans shoulder→hand, aimed and
   length-scaled to fit. All positions are avatar-group-local. */
export function poseArm(rig: ArmRig, target: THREE.Vector3): void {
  rig.hand.position.copy(target);
  _seg.subVectors(target, rig.shoulder);
  const len = Math.max(0.1, _seg.length());
  rig.arm.position.copy(rig.shoulder).addScaledVector(_seg, 0.5);
  rig.arm.quaternion.setFromUnitVectors(UP, _seg.normalize());
  rig.arm.scale.set(1, len / ARM_LEN, 1);
}

/* hat silhouettes, built at the head's local origin (skull radius 0.115).
   Each one leans on the same tipped-brim language as the original fedora. */
function buildHat(style: number, mat: THREE.MeshStandardMaterial): THREE.Group {
  const hat = new THREE.Group();
  const add = (m: THREE.Mesh): THREE.Mesh => {
    m.castShadow = true;
    hat.add(m);
    return m;
  };
  // hat bands stay cabinet-dark whatever the felt color
  const darkBand = () => new THREE.MeshStandardMaterial({ color: 0x17130d, roughness: 0.8 });
  switch (style) {
    case HAT_FLATCAP: {
      // low dome hugging the skull, a stubby bill out front
      const dome = add(new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 10), mat));
      dome.scale.y = 0.45;
      dome.position.set(0, 0.068, -0.012);
      const bill = add(new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.012, 0.07), mat));
      bill.position.set(0, 0.052, 0.115);
      break;
    }
    case HAT_COWBOY: {
      // oval brim, longer front-to-back, with the signature rolled-up sides
      const brim = add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.014, 20), mat));
      brim.scale.set(0.88, 1, 1.15);
      brim.position.y = 0.075;
      for (const s of [-1, 1]) {
        const curl = add(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.3, 10), mat));
        curl.rotation.x = Math.PI / 2;
        curl.position.set(s * 0.15, 0.092, 0);
      }
      // tall crown with a cattleman's crease pinched down the middle
      const crown = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.098, 0.13, 14), mat));
      crown.position.y = 0.145;
      const crease = add(new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.024, 0.15), darkBand()));
      crease.position.y = 0.208;
      const band = add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.102, 0.026, 14), darkBand()));
      band.position.y = 0.096;
      break;
    }
    case HAT_VISOR: {
      // bare skull above — the band and bill do all the silhouette work
      const band = add(new THREE.Mesh(new THREE.TorusGeometry(0.116, 0.013, 8, 20), mat));
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.052;
      const bill = add(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.01, 0.085), mat));
      bill.position.set(0, 0.052, 0.145);
      break;
    }
    default: {
      // fedora: wide brim snapped down at the front, squat crown that fills
      // out over the skull, grosgrain band — the house style
      const brim = add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.012, 20), mat));
      brim.position.y = 0.072;
      brim.rotation.x = 0.1; // front dipped, back kicked up
      const crown = add(new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.106, 0.092, 16), mat));
      crown.position.y = 0.122;
      // pinched top: a barely-domed cap, narrower than the crown walls —
      // any rounder and the whole thing reads bowler
      const pinch = add(new THREE.Mesh(new THREE.SphereGeometry(0.082, 14, 8), mat));
      pinch.scale.y = 0.24;
      pinch.position.y = 0.165;
      const band = add(new THREE.Mesh(new THREE.CylinderGeometry(0.108, 0.11, 0.03, 16), darkBand()));
      band.position.y = 0.093;
    }
  }
  hat.position.y = 0.01;
  hat.rotation.z = 0.09; // tipped a touch — silhouette does the work
  return hat;
}

/* accessories ride the head group (they turn with the stare) except the
   chain, which lies on the chest and is parented to the body instead */
function buildAccessory(kind: number): { mesh: THREE.Object3D; onHead: boolean } | null {
  switch (kind) {
    case ACC_SHADES: {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0b0b0e,
        roughness: 0.25,
        metalness: 0.3,
      });
      for (const s of [-1, 1]) {
        const lens = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.036, 0.012), mat);
        lens.position.set(s * 0.042, 0.015, 0.104);
        g.add(lens);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.008, 0.01), mat);
      bridge.position.set(0, 0.02, 0.104);
      g.add(bridge);
      return { mesh: g, onHead: true };
    }
    case ACC_MUSTACHE: {
      const m = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.013, 0.045, 3, 8),
        new THREE.MeshStandardMaterial({ color: 0x241708, roughness: 0.9 })
      );
      m.rotation.z = Math.PI / 2;
      m.position.set(0, -0.03, 0.102);
      return { mesh: m, onHead: true };
    }
    case ACC_EAR_CIGAR: {
      const c = new THREE.Mesh(
        new THREE.CylinderGeometry(0.011, 0.011, 0.075, 8),
        new THREE.MeshStandardMaterial({ color: 0xa87f4f, roughness: 0.85 })
      );
      c.rotation.x = Math.PI / 2;
      c.position.set(0.108, 0.035, 0.01);
      return { mesh: c, onHead: true };
    }
    case ACC_CHAIN: {
      const chain = new THREE.Mesh(
        new THREE.TorusGeometry(0.1, 0.012, 8, 22),
        new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.3, metalness: 0.75 })
      );
      // draped against the slumped chest, pivoting from the neck
      chain.position.set(0, 1.12, 0.1);
      chain.rotation.x = 1.12;
      return { mesh: chain, onHead: false };
    }
    default:
      return null;
  }
}

/* A regular, built from primitives: slumped torso, arms, hat, and just
   enough face to read a stare. The group's +Z is the front. Everything
   above the shoulders lives in `head`, pivoted at the neck, so a remote
   player's look direction turns the whole face, eyes, and hat together.
   `seated` adds thighs on a stool; `standing` adds full hip-pivoted legs
   for the lobby room, returned so the walk cycle can swing them. */
export function makeFigure(
  look: FigureLook,
  opts: { seated?: boolean; standing?: boolean } = {}
): {
  group: THREE.Group;
  head: THREE.Group;
  armR: ArmRig;
  armL: ArmRig;
  legs?: [THREE.Group, THREE.Group];
} {
  const g = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: look.shirt, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.75 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: look.pants, roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.36, 4, 12), shirtMat);
  body.position.y = 0.85;
  body.rotation.x = 0.08; // a slump — nobody here sits up straight
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Group();
  head.position.y = 1.26;
  g.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skinMat);
  skull.castShadow = true;
  head.add(skull);

  // eyes: fixed on the table like everything else in their life
  const eyeGeo = new THREE.SphereGeometry(0.014, 6, 6);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14100a, roughness: 0.35 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(s * 0.042, 0.015, 0.1);
    head.add(eye);
  }

  if (look.hat) {
    const hatMat = new THREE.MeshStandardMaterial({ color: look.hat.color, roughness: 0.8 });
    head.add(buildHat(look.hat.style, hatMat));
  }
  if (look.accessory !== ACC_NONE) {
    const acc = buildAccessory(look.accessory);
    if (acc) (acc.onHead ? head : g).add(acc.mesh);
  }

  // arms as poseable rigs: shoulder-anchored capsules aimed at the hand
  // spheres, so a raised bottle raises the arm with it
  const armGeo = new THREE.CapsuleGeometry(0.048, 0.24, 3, 8);
  const mkArm = (s: number): ArmRig => {
    const arm = new THREE.Mesh(armGeo, shirtMat);
    arm.castShadow = true;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skinMat);
    hand.castShadow = true;
    g.add(arm, hand);
    const rig: ArmRig = {
      arm,
      hand,
      shoulder: new THREE.Vector3(s * 0.175, 1.04, 0.05),
      rest: new THREE.Vector3(s * 0.14, 0.85, 0.33),
    };
    poseArm(rig, rig.rest);
    return rig;
  };
  const armR = mkArm(1);
  const armL = mkArm(-1);

  if (opts.standing) {
    // hip-pivoted so the walk cycle can swing them; capsule hangs below
    const legGeo = new THREE.CapsuleGeometry(0.065, 0.42, 3, 8);
    const legs: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.085, 0.62, 0);
      const leg = new THREE.Mesh(legGeo, pantsMat);
      leg.position.y = -0.29;
      leg.castShadow = true;
      hip.add(leg);
      g.add(hip);
      legs.push(hip);
    }
    return { group: g, head, armR, armL, legs: legs as [THREE.Group, THREE.Group] };
  }
  if (opts.seated !== false) {
    const legGeo = new THREE.CapsuleGeometry(0.065, 0.2, 3, 8);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, pantsMat);
      leg.position.set(s * 0.085, 0.47, 0.14);
      leg.rotation.x = 1.35;
      leg.castShadow = true;
      g.add(leg);
    }
  }
  return { group: g, head, armR, armL };
}
