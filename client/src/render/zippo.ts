/* The first-person zippo: a chrome flip-top lighter that rises to the ghost
   cigar's tip, clinks open, strikes with a spark burst, and burns a
   shader-driven flame until the ritual ends. Replaces the old 2D DOM
   overlay — this one lives in the scene, so the flame actually lights the
   cigar, the hand, and the felt. */
import * as THREE from "three";
import { zippoClinkSound, zippoStrikeSound } from "./effects";

/* real zippo proportions in meters, ×1.35 to match the ghost cigar's
   foreshortening boost */
const SCALE = 1.35;
const LID_OPEN = 2.05; // rad — the lid hangs off the left, past vertical
const FLAME_FULL = 0.8; // uGrow at steady burn; ignition overshoots to 1
/* group-local wick position (pre-scale) — the flame roots here */
const WICK = new THREE.Vector3(-0.0085, 0.0505, 0);

/* offsets from the cigar tip, in camera space: the case hangs below the
   ember (flame top licking it), nudged right so the off-center wick lines
   up, and toward the camera so the flame reads in front of the ash */
const ANCHOR_OFFSET = new THREE.Vector3(0.0115, -0.1, 0.02);
const RAISE_DROP = 0.14; // extra below-anchor start for the rise-in
const OPEN_AT = 0.22; // s: rise duration, then the lid flips
const STRIKE_AT = 0.24; // s into "open": thumb reaches the wheel
const IGNITE_AT = 0.05; // s into "strike": the wick catches
const LIT_AT = 0.3; // s into "strike": ignition overshoot settled

type State = "hidden" | "raise" | "open" | "strike" | "lit" | "dying";

/* ---- shared materials & geometry (built once, never disposed) ---- */
let chrome: THREE.MeshStandardMaterial | null = null;
let chromeDark: THREE.MeshStandardMaterial | null = null;
let brass: THREE.MeshStandardMaterial | null = null;
function metals() {
  if (!chrome) {
    chrome = new THREE.MeshStandardMaterial({
      color: 0xd9dee4,
      metalness: 0.9,
      roughness: 0.24,
    });
    chromeDark = new THREE.MeshStandardMaterial({
      color: 0x8f959d,
      metalness: 0.85,
      roughness: 0.42,
    });
    brass = new THREE.MeshStandardMaterial({
      color: 0xb08d3e,
      metalness: 0.85,
      roughness: 0.35,
    });
  }
  return { chrome: chrome!, chromeDark: chromeDark!, brass: brass! };
}

/* the windscreen's two rows of vent holes, painted onto steel */
let chimneyTex: THREE.CanvasTexture | null = null;
function chimneyTexture(): THREE.CanvasTexture {
  if (chimneyTex) return chimneyTex;
  const cv = document.createElement("canvas");
  cv.width = 64;
  cv.height = 48;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#9aa0a8";
  c.fillRect(0, 0, 64, 48);
  c.fillStyle = "#3a3d42";
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.arc(12 + i * 14, 15 + row * 18, 4.5, 0, Math.PI * 2);
      c.fill();
    }
  chimneyTex = new THREE.CanvasTexture(cv);
  return chimneyTex;
}

/* knurling on the flint wheel */
let knurlTex: THREE.CanvasTexture | null = null;
function knurlTexture(): THREE.CanvasTexture {
  if (knurlTex) return knurlTex;
  const cv = document.createElement("canvas");
  cv.width = 64;
  cv.height = 16;
  const c = cv.getContext("2d")!;
  for (let x = 0; x < 64; x += 4) {
    c.fillStyle = x % 8 ? "#6b665c" : "#a8a294";
    c.fillRect(x, 0, 4, 16);
  }
  knurlTex = new THREE.CanvasTexture(cv);
  knurlTex.wrapS = THREE.RepeatWrapping;
  return knurlTex;
}

let sparkTex: THREE.CanvasTexture | null = null;
function sparkTexture(): THREE.CanvasTexture {
  if (sparkTex) return sparkTex;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 32;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(16, 16, 1, 16, 16, 15);
  g.addColorStop(0, "rgba(255,244,200,1)");
  g.addColorStop(0.4, "rgba(255,180,90,0.7)");
  g.addColorStop(1, "rgba(255,140,50,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 32, 32);
  sparkTex = new THREE.CanvasTexture(cv);
  return sparkTex;
}

let glowTex: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, "rgba(255,190,110,0.55)");
  g.addColorStop(0.5, "rgba(255,140,60,0.18)");
  g.addColorStop(1, "rgba(255,120,40,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}

/* the flame itself: a camera-facing quad running a small procedural
   shader — noise-bent teardrop, white-hot core, amber body, blue
   combustion ring hugging the wick. uGrow drives ignition and dying. */
const FLAME_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FLAME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGrow;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
void main() {
  float g = max(uGrow, 0.001);
  vec2 p = vec2(vUv.x - 0.5, vUv.y);
  // rising turbulence bends the body; the root stays pinned to the wick
  float turb = fbm(vec2(p.x * 6.0, p.y * 5.0 - uTime * 2.6)) - 0.5;
  p.x -= turb * 0.24 * smoothstep(0.04, 0.9, p.y);
  float y = p.y / g;
  if (y > 1.0 || y < 0.0) discard;
  // teardrop profile: bulge low, taper to a wavering point
  float r = 0.52 * pow(y, 0.3) * pow(1.0 - y, 1.15) + 0.01;
  float d = abs(p.x) / r;
  float body = 1.0 - smoothstep(0.5, 1.0, d + (fbm(vec2(p.x * 9.0, p.y * 7.0 - uTime * 3.2)) - 0.5) * 0.5);
  if (body <= 0.003) discard;
  vec3 col = mix(vec3(0.85, 0.28, 0.05), vec3(1.0, 0.72, 0.25), 1.0 - smoothstep(0.3, 0.95, d));
  float coreW = (1.0 - smoothstep(0.0, 0.5, d)) * (1.0 - smoothstep(0.1, 0.8, y));
  col = mix(col, vec3(1.0, 0.98, 0.88), coreW);
  // blue combustion ring at the root, strongest at the flame's skin
  float blue = (1.0 - smoothstep(0.0, 0.2, y)) * smoothstep(0.1, 0.7, d);
  col = mix(col, vec3(0.3, 0.5, 1.0), blue * 0.85);
  float a = body * min(1.0, uGrow + 0.15);
  gl_FragColor = vec4(col * a, a);
}`;

interface Spark {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  age: number;
}

export class ZippoLighter {
  private group = new THREE.Group();
  private lidPivot = new THREE.Group();
  private wheel: THREE.Mesh;
  private flame: THREE.Mesh;
  private flameU: { uTime: { value: number }; uGrow: { value: number } };
  private glow: THREE.Sprite;
  private light: THREE.PointLight;
  private state: State = "hidden";
  private stateT = 0;
  private grow = 0;
  private anchor = new THREE.Vector3(); // last known cigar-tip world pos
  private sparks: Spark[] = [];
  private _v = new THREE.Vector3();
  private _q = new THREE.Quaternion();

  constructor(private scene: THREE.Scene) {
    const { chrome, chromeDark, brass } = metals();
    const g = this.group;

    // bottom case, insert, chimney, wick — origin at the case's base center
    const caseBottom = new THREE.Mesh(new THREE.BoxGeometry(0.037, 0.0375, 0.0125), chrome);
    caseBottom.position.y = 0.0188;
    const insert = new THREE.Mesh(new THREE.BoxGeometry(0.033, 0.016, 0.0105), brass);
    insert.position.y = 0.0435;
    const chimney = new THREE.Mesh(
      new THREE.BoxGeometry(0.0155, 0.0115, 0.0108),
      new THREE.MeshStandardMaterial({ map: chimneyTexture(), metalness: 0.8, roughness: 0.45 })
    );
    chimney.position.set(-0.0085, 0.0478, 0);
    const wick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0018, 0.0018, 0.0045, 6),
      new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.95 })
    );
    wick.position.copy(WICK);

    // flint wheel, axis along depth so the thumb-spin reads from the front
    const wheelGeo = new THREE.CylinderGeometry(0.0052, 0.0052, 0.0042, 16);
    wheelGeo.rotateX(Math.PI / 2);
    this.wheel = new THREE.Mesh(
      wheelGeo,
      new THREE.MeshStandardMaterial({ map: knurlTexture(), metalness: 0.7, roughness: 0.55 })
    );
    this.wheel.position.set(0.0055, 0.0475, 0);

    // hinge + lid: pivot at the top-left seam, pin along the depth axis —
    // the lid swings sideways past vertical, the classic open pose
    const hingeGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 0.0125, 8);
    hingeGeo.rotateX(Math.PI / 2);
    const hinge = new THREE.Mesh(hingeGeo, chromeDark);
    hinge.position.set(-0.0185, 0.0378, 0);
    this.lidPivot.position.copy(hinge.position);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.037, 0.019, 0.0125), chrome);
    lid.position.set(0.0185, 0.0095, 0);
    const lidLiner = new THREE.Mesh(new THREE.BoxGeometry(0.0335, 0.017, 0.0098), chromeDark);
    lidLiner.position.set(0.0185, 0.006, 0);
    this.lidPivot.add(lid, lidLiner);

    this.flameU = { uTime: { value: 0 }, uGrow: { value: 0 } };
    const flameGeo = new THREE.PlaneGeometry(0.042, 0.085);
    flameGeo.translate(0, 0.0425, 0); // origin at the flame's root
    this.flame = new THREE.Mesh(
      flameGeo,
      new THREE.ShaderMaterial({
        vertexShader: FLAME_VERT,
        fragmentShader: FLAME_FRAG,
        uniforms: this.flameU,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.flame.position.set(WICK.x, WICK.y, 0.0075);
    this.flame.renderOrder = 2;

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      })
    );
    this.glow.position.set(WICK.x, WICK.y + 0.022, 0.006);
    this.glow.scale.setScalar(0.001);

    /* the flame's light lives at the scene root, not inside the (usually
       invisible) group: a light that pops in and out of traverseVisible
       changes the scene's light count and forces every material to
       recompile — the source of a fat first-strike hitch. At intensity 0
       it costs nothing and the program count stays stable. */
    this.light = new THREE.PointLight(0xffa445, 0, 1.1, 2);
    scene.add(this.light);

    g.add(caseBottom, insert, chimney, wick, this.wheel, hinge, this.lidPivot);
    g.add(this.flame, this.glow);
    g.scale.setScalar(SCALE);
    g.visible = false;
    scene.add(g);
    sparkTexture(); // pre-bake so the first strike doesn't rasterize canvases
  }

  /* bring the lighter up (idempotent while already out) */
  show(): void {
    if (this.state === "hidden") {
      this.state = "raise";
      this.stateT = 0;
      this.grow = 0;
      this.lidPivot.rotation.z = 0;
      this.group.visible = true;
      this.group.position.set(0, -10, 0); // frame() snaps to the anchor path
    } else if (this.state === "dying") {
      // back in the zone before it was pocketed: flip open and re-strike
      this.state = "open";
      this.stateT = 0;
      this.grow = 0;
    }
  }

  /* flame out, lid clinks shut, the hand drops out of frame */
  hide(): void {
    if (this.state === "hidden" || this.state === "dying") return;
    this.state = "dying";
    this.stateT = 0;
  }

  /* tip: world position of the ghost cigar's ember, or null once the
     ghost is gone (the lighter pockets itself) */
  frame(dt: number, now: number, camera: THREE.PerspectiveCamera, tip: THREE.Vector3 | null): void {
    this.updateSparks(dt);
    if (this.state === "hidden") return;
    if (!tip && this.state !== "dying") this.hide();
    if (tip) this.anchor.copy(tip);
    this.stateT += dt;
    const t = this.stateT;

    // face the camera with a lazy wrist tilt; park under the ember
    this.group.quaternion.copy(camera.quaternion);
    this._q.setFromAxisAngle(this._v.set(0, 0, 1), -0.06);
    this.group.quaternion.multiply(this._q);
    const target = this._v
      .copy(ANCHOR_OFFSET)
      .applyQuaternion(camera.quaternion)
      .add(this.anchor);

    let extraDown = 0;
    switch (this.state) {
      case "raise": {
        const k = Math.min(1, t / OPEN_AT);
        extraDown = RAISE_DROP * Math.pow(1 - k, 3);
        this.group.rotateZ(-0.3 * Math.pow(1 - k, 2)); // rolls level as it rises
        if (t === dt) {
          // first frame: start the rise from below, not from last ritual's spot
          this.group.position.copy(target).addScaledVector(camDown(camera, this._q), RAISE_DROP);
        }
        if (k >= 1) {
          this.state = "open";
          this.stateT = 0;
          zippoClinkSound();
        }
        break;
      }
      case "open": {
        const k = Math.min(1, t / 0.13);
        this.lidPivot.rotation.z = LID_OPEN * easeOutBack(k);
        if (t >= STRIKE_AT) {
          this.state = "strike";
          this.stateT = 0;
          zippoStrikeSound();
          this.burstSparks();
        }
        break;
      }
      case "strike": {
        this.lidPivot.rotation.z = LID_OPEN;
        if (t < 0.12) this.wheel.rotation.z -= dt * 55; // thumb rakes the wheel
        if (t >= IGNITE_AT) {
          // catch with a whoosh of overshoot, then settle to a steady burn
          const k = Math.min(1, (t - IGNITE_AT) / 0.16);
          this.grow = (FLAME_FULL + 0.25 * Math.sin(Math.min(1, k * 1.3) * Math.PI)) * easeOutCubic(k);
        }
        if (t >= LIT_AT) this.state = "lit";
        break;
      }
      case "lit":
        this.grow += (FLAME_FULL - this.grow) * Math.min(1, dt * 10);
        break;
      case "dying": {
        this.grow = Math.max(0, this.grow - dt * 8);
        if (t > 0.1) {
          const k = Math.min(1, (t - 0.1) / 0.08);
          const wasOpen = this.lidPivot.rotation.z > 0.01;
          this.lidPivot.rotation.z = LID_OPEN * (1 - k);
          if (wasOpen && k >= 1) zippoClinkSound();
          extraDown = 0.3 * (t - 0.1) * (t - 0.1) * 8;
        }
        if (t > 0.5) {
          this.state = "hidden";
          this.group.visible = false;
          this.light.intensity = 0;
          return;
        }
        break;
      }
    }
    target.addScaledVector(camDown(camera, this._q), extraDown);
    this.group.position.lerp(target, 1 - Math.exp(-dt * 26));

    // flame, halo, and light breathe together
    this.flameU.uTime.value = (now % 100000) / 1000;
    this.flameU.uGrow.value = this.grow;
    const flick = 1 + 0.16 * Math.sin(now * 0.021) + 0.09 * Math.sin(now * 0.0077);
    this.flame.scale.x = 1 + 0.07 * Math.sin(now * 0.017);
    this.glow.scale.setScalar(Math.max(0.001, 0.085 * this.grow * flick));
    (this.glow.material as THREE.SpriteMaterial).opacity = 0.8 * Math.min(1, this.grow);
    this.light.intensity = 2.6 * this.grow * flick;
    this.group.updateMatrixWorld();
    this.light.position.copy(
      this.group.localToWorld(_lightLocal.set(WICK.x, WICK.y + 0.015, 0.02))
    );
  }

  /* flint shower: a handful of hot flecks kicked off the wheel toward
     the wick, gone in a quarter second */
  private burstSparks(): void {
    this.group.updateMatrixWorld();
    for (let i = 0; i < 7; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: sparkTexture(),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      sprite.position.copy(
        this.group.localToWorld(new THREE.Vector3(0.0055, 0.0495, 0.004))
      );
      sprite.scale.setScalar(0.004 + Math.random() * 0.004);
      this.scene.add(sprite);
      const vel = new THREE.Vector3(
        -(0.05 + Math.random() * 0.12),
        0.03 + Math.random() * 0.09,
        (Math.random() - 0.5) * 0.03
      ).applyQuaternion(this.group.quaternion);
      this.sparks.push({ sprite, vel, life: 0.14 + Math.random() * 0.18, age: 0 });
    }
  }

  private updateSparks(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      if (s.age >= s.life) {
        this.scene.remove(s.sprite);
        (s.sprite.material as THREE.SpriteMaterial).dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      s.vel.y -= 0.9 * dt;
      s.sprite.position.addScaledVector(s.vel, dt);
      (s.sprite.material as THREE.SpriteMaterial).opacity = 1 - s.age / s.life;
    }
  }
}

function camDown(camera: THREE.PerspectiveCamera, tmp: THREE.Quaternion): THREE.Vector3 {
  return _down.set(0, -1, 0).applyQuaternion(tmp.copy(camera.quaternion));
}
const _down = new THREE.Vector3();
const _lightLocal = new THREE.Vector3();

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
/* the lid snap: overshoots past fully-open, then springs back */
function easeOutBack(t: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}
