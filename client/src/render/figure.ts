/* The clay-figure regulars, shared by the table scene (seated, posed arms)
   and the lobby room (standing, walk-cycle legs). Split out of scene.ts so
   both scenes can build the same people without importing each other. */
import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);
const _seg = new THREE.Vector3();

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

/* A regular, built from primitives: slumped torso, arms, hat, and just
   enough face to read a stare. The group's +Z is the front. Everything
   above the shoulders lives in `head`, pivoted at the neck, so a remote
   player's look direction turns the whole face, eyes, and hat together.
   `seated` adds thighs on a stool; `standing` adds full hip-pivoted legs
   for the lobby room, returned so the walk cycle can swing them. */
export function makeFigure(
  shirt: number,
  skin: number,
  opts: { hat?: number; seated?: boolean; standing?: boolean } = {}
): {
  group: THREE.Group;
  head: THREE.Group;
  armR: ArmRig;
  armL: ArmRig;
  legs?: [THREE.Group, THREE.Group];
} {
  const g = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.75 });
  const darkMat = new THREE.MeshStandardMaterial({ color: opts.hat ?? 0x17130d, roughness: 0.8 });

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

  // hat: brim + tapered crown, tipped a touch — silhouette does the work
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.014, 18), darkMat);
  brim.position.y = 0.075;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.098, 0.1, 14), darkMat);
  crown.position.y = 0.13;
  brim.castShadow = crown.castShadow = true;
  const hat = new THREE.Group();
  hat.add(brim, crown);
  hat.position.y = 0.01;
  hat.rotation.z = 0.09;
  head.add(hat);

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
      const leg = new THREE.Mesh(legGeo, darkMat);
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
      const leg = new THREE.Mesh(legGeo, darkMat);
      leg.position.set(s * 0.085, 0.47, 0.14);
      leg.rotation.x = 1.35;
      leg.castShadow = true;
      g.add(leg);
    }
  }
  return { group: g, head, armR, armL };
}
