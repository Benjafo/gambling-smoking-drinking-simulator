/* Impact audio + cigar smoke + money-drop particles. All cosmetic, all
   client-side. */
import * as THREE from "three";

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function impactSound(speed: number): void {
  const ac = audio();
  if (!ac) return;
  const dur = 0.09;
  const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++)
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.2);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900 + speed * 260;
  const gain = ac.createGain();
  gain.gain.value = Math.min(0.5, 0.05 + speed / 22);
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start();
}

export function denySound(): void {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(140, ac.currentTime);
  osc.frequency.linearRampToValueAtTime(95, ac.currentTime + 0.12);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.05, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.14);
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + 0.15);
}

export function pickupSound(): void {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(340, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(520, ac.currentTime + 0.06);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.08, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.09);
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + 0.1);
}

export function whooshSound(): void {
  const ac = audio();
  if (!ac) return;
  const dur = 0.22;
  const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    data[i] = (Math.random() * 2 - 1) * Math.sin(t * Math.PI); // swell then fade
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(350, ac.currentTime);
  filter.frequency.exponentialRampToValueAtTime(1600, ac.currentTime + dur);
  const gain = ac.createGain();
  gain.gain.value = 0.1;
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start();
}

export function chipRiffleSound(): void {
  const ac = audio();
  if (!ac) return;
  // a run of tiny clicks — chips stacking against each other
  for (let i = 0; i < 6; i++) {
    const at = ac.currentTime + i * 0.035;
    const dur = 0.02;
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let j = 0; j < data.length; j++)
      data[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / data.length, 3);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filter = ac.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 2200;
    const gain = ac.createGain();
    gain.gain.value = 0.05 + Math.random() * 0.03;
    src.connect(filter).connect(gain).connect(ac.destination);
    src.start(at);
  }
}

export function cashSound(): void {
  const ac = audio();
  if (!ac) return;
  // two quick ascending chimes — bright against the low thuds and squelches
  for (const [freq, at] of [
    [880, 0],
    [1318, 0.07],
  ] as const) {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, ac.currentTime + at);
    gain.gain.exponentialRampToValueAtTime(0.09, ac.currentTime + at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + at + 0.35);
    osc.connect(gain).connect(ac.destination);
    osc.start(ac.currentTime + at);
    osc.stop(ac.currentTime + at + 0.4);
  }
}

export function dealSound(): void {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = 210;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.06, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.07);
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + 0.08);
}

/* ---- smoke ---- */
let smokeTex: THREE.CanvasTexture | null = null;
function smokeTexture(): THREE.CanvasTexture {
  if (smokeTex) return smokeTex;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, "rgba(200,195,185,0.55)");
  g.addColorStop(1, "rgba(200,195,185,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  smokeTex = new THREE.CanvasTexture(cv);
  return smokeTex;
}

interface Puff {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  age: number;
}

/* ---- money drop ---- */
let billTex: THREE.CanvasTexture | null = null;
function billTexture(): THREE.CanvasTexture {
  if (billTex) return billTex;
  const cv = document.createElement("canvas");
  cv.width = 64;
  cv.height = 32;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#3f7a45";
  c.fillRect(0, 0, 64, 32);
  c.strokeStyle = "#2a5230";
  c.lineWidth = 4;
  c.strokeRect(2, 2, 60, 28);
  c.fillStyle = "#bfe8c2";
  c.font = "bold 20px monospace";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("$", 32, 17);
  billTex = new THREE.CanvasTexture(cv);
  return billTex;
}

function amountTexture(amount: number): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 96;
  const c = cv.getContext("2d")!;
  c.font = "bold 56px monospace";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.shadowColor = "rgba(120,255,140,0.9)";
  c.shadowBlur = 18;
  c.fillStyle = "#c9f5c9";
  c.fillText("+$" + amount, 128, 48);
  return new THREE.CanvasTexture(cv);
}

interface Bill {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  spin: number;
  life: number;
  age: number;
  rise: boolean; // the +$N label floats up instead of falling
}

export class CashBurst {
  private bills: Bill[] = [];
  constructor(private scene: THREE.Scene) {}

  emit(at: THREE.Vector3, amount: number): void {
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.SpriteMaterial({
        map: billTexture(),
        transparent: true,
        depthWrite: false,
        rotation: Math.random() * Math.PI * 2,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(at);
      sprite.scale.set(0.05, 0.025, 1);
      this.scene.add(sprite);
      const a = Math.random() * Math.PI * 2;
      this.bills.push({
        sprite,
        vel: new THREE.Vector3(
          Math.cos(a) * (0.2 + Math.random() * 0.3),
          0.7 + Math.random() * 0.5,
          Math.sin(a) * (0.2 + Math.random() * 0.3)
        ),
        spin: (Math.random() - 0.5) * 10,
        life: 1.1 + Math.random() * 0.5,
        age: 0,
        rise: false,
      });
    }
    const labelMat = new THREE.SpriteMaterial({
      map: amountTexture(amount),
      transparent: true,
      depthWrite: false,
      depthTest: false, // readable even when the drop lands behind a stool
    });
    const label = new THREE.Sprite(labelMat);
    label.position.copy(at).add(new THREE.Vector3(0, 0.1, 0));
    label.scale.set(0.34, 0.13, 1);
    this.scene.add(label);
    this.bills.push({
      sprite: label,
      vel: new THREE.Vector3(0, 0.22, 0),
      spin: 0,
      life: 1.7,
      age: 0,
      rise: true,
    });
  }

  frame(dt: number): void {
    for (let i = this.bills.length - 1; i >= 0; i--) {
      const b = this.bills[i];
      b.age += dt;
      const mat = b.sprite.material as THREE.SpriteMaterial;
      if (b.age >= b.life) {
        this.scene.remove(b.sprite);
        if (b.rise) mat.map?.dispose(); // per-emit amount texture
        mat.dispose();
        this.bills.splice(i, 1);
        continue;
      }
      if (!b.rise) {
        b.vel.y -= 2.2 * dt; // bills arc up then flutter down
        mat.rotation += b.spin * dt;
      }
      b.sprite.position.addScaledVector(b.vel, dt);
      const t = b.age / b.life;
      mat.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    }
  }
}

export class SmokeSystem {
  private puffs: Puff[] = [];
  constructor(private scene: THREE.Scene) {}

  emit(at: THREE.Vector3): void {
    const mat = new THREE.SpriteMaterial({
      map: smokeTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.7,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(at).add(
      new THREE.Vector3((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.04)
    );
    // small: ritual smoke lives ~1m from the camera, where a fat sprite
    // reads as a blinding white blob
    sprite.scale.setScalar(0.02);
    mat.opacity = 0.4;
    this.scene.add(sprite);
    this.puffs.push({
      sprite,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.04, 0.16 + Math.random() * 0.1, (Math.random() - 0.5) * 0.04),
      life: 1.4 + Math.random() * 0.5,
      age: 0,
    });
  }

  frame(dt: number): void {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.scene.remove(p.sprite);
        (p.sprite.material as THREE.SpriteMaterial).dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      const t = p.age / p.life;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(0.02 + t * 0.09);
      (p.sprite.material as THREE.SpriteMaterial).opacity = 0.4 * (1 - t);
    }
  }
}
