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

export function hurtSound(): void {
  const ac = audio();
  if (!ac) return;
  // blunt thud...
  const dur = 0.08;
  const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++)
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.5);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 500;
  const thud = ac.createGain();
  thud.gain.value = 0.3;
  src.connect(filter).connect(thud).connect(ac.destination);
  src.start();
  // ...plus a short descending groan
  const osc = ac.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(200, ac.currentTime);
  osc.frequency.linearRampToValueAtTime(110, ac.currentTime + 0.15);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.12, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.18);
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + 0.2);
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

export function pointsSound(): void {
  const ac = audio();
  if (!ac) return;
  // a quick rising triad blip — cheekier and thinner than the cash chime
  for (const [freq, at] of [
    [660, 0],
    [830, 0.05],
    [990, 0.1],
  ] as const) {
    const osc = ac.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, ac.currentTime + at);
    gain.gain.exponentialRampToValueAtTime(0.06, ac.currentTime + at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + at + 0.22);
    osc.connect(gain).connect(ac.destination);
    osc.start(ac.currentTime + at);
    osc.stop(ac.currentTime + at + 0.25);
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
  c.font = "22px 'VT323',monospace";
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
  c.font = "64px 'VT323',monospace";
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

/* ---- litter points ---- */
let sparkTex: THREE.CanvasTexture | null = null;
function sparkTexture(): THREE.CanvasTexture {
  if (sparkTex) return sparkTex;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d")!;
  // four-point star: two soft crossed lobes over a hot core
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,240,190,0.95)");
  g.addColorStop(0.35, "rgba(232,196,105,0.55)");
  g.addColorStop(1, "rgba(232,196,105,0)");
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(32, 2);
  c.quadraticCurveTo(38, 26, 62, 32);
  c.quadraticCurveTo(38, 38, 32, 62);
  c.quadraticCurveTo(26, 38, 2, 32);
  c.quadraticCurveTo(26, 26, 32, 2);
  c.fill();
  sparkTex = new THREE.CanvasTexture(cv);
  return sparkTex;
}

function pointsTexture(points: number): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 96;
  const c = cv.getContext("2d")!;
  c.font = "56px 'VT323',monospace";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.shadowColor = "rgba(255,214,110,0.9)";
  c.shadowBlur = 16;
  c.fillStyle = "#ffe9b0";
  c.fillText(`+${points} PTS`, 128, 48);
  return new THREE.CanvasTexture(cv);
}

interface Spark {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  age: number;
  rise: boolean; // the +N PTS label floats straight up
}

/* gold sparkle burst + rising "+N PTS" label where litter settles — the
   visible promise that filth is worth something (scoring system to come) */
export class PointsBurst {
  private sparks: Spark[] = [];
  constructor(private scene: THREE.Scene) {}

  emit(at: THREE.Vector3, points: number): void {
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.SpriteMaterial({
        map: sparkTexture(),
        transparent: true,
        depthWrite: false,
        rotation: Math.random() * Math.PI * 2,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(at);
      sprite.scale.setScalar(0.03 + Math.random() * 0.03);
      this.scene.add(sprite);
      const a = Math.random() * Math.PI * 2;
      this.sparks.push({
        sprite,
        vel: new THREE.Vector3(
          Math.cos(a) * (0.15 + Math.random() * 0.25),
          0.5 + Math.random() * 0.6,
          Math.sin(a) * (0.15 + Math.random() * 0.25)
        ),
        life: 0.7 + Math.random() * 0.4,
        age: 0,
        rise: false,
      });
    }
    const labelMat = new THREE.SpriteMaterial({
      map: pointsTexture(points),
      transparent: true,
      depthWrite: false,
      depthTest: false, // readable even when the litter lands behind furniture
    });
    const label = new THREE.Sprite(labelMat);
    label.position.copy(at).add(new THREE.Vector3(0, 0.12, 0));
    label.scale.set(0.28, 0.105, 1);
    this.scene.add(label);
    this.sparks.push({
      sprite: label,
      vel: new THREE.Vector3(0, 0.2, 0),
      life: 1.5,
      age: 0,
      rise: true,
    });
  }

  frame(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      const mat = s.sprite.material as THREE.SpriteMaterial;
      if (s.age >= s.life) {
        this.scene.remove(s.sprite);
        if (s.rise) mat.map?.dispose(); // per-emit points texture
        mat.dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      if (!s.rise) {
        s.vel.y -= 1.6 * dt; // sparks pop up, hang, drift back down
        mat.rotation += 2.5 * dt;
      }
      s.sprite.position.addScaledVector(s.vel, dt);
      const t = s.age / s.life;
      mat.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    }
  }
}

const OUCH_WORDS = ["OUCH!", "YOW!", "AGH!", "OOF!", "HEY!"];
let ouchIdx = 0;

function ouchTexture(text: string): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 96;
  const c = cv.getContext("2d")!;
  // the rounded backdrop is what makes it read as a yelp bubble, not
  // another points label
  c.fillStyle = "rgba(25,10,8,0.7)";
  c.strokeStyle = "#ff6a55";
  c.lineWidth = 4;
  c.beginPath();
  c.roundRect(18, 12, 220, 72, 20);
  c.fill();
  c.stroke();
  c.font = "50px 'VT323',monospace";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.shadowColor = "rgba(255,80,60,0.9)";
  c.shadowBlur = 14;
  c.fillStyle = "#ffb4a4";
  c.fillText(text, 128, 50);
  return new THREE.CanvasTexture(cv);
}

/* a yelp bubble popping off whoever just took a bottle to the head —
   world-anchored so everyone at the table sees the victim complain */
export class OuchBubbles {
  private items: { sprite: THREE.Sprite; vel: THREE.Vector3; life: number; age: number }[] =
    [];
  constructor(private scene: THREE.Scene) {}

  emit(at: THREE.Vector3): void {
    const word = OUCH_WORDS[ouchIdx++ % OUCH_WORDS.length];
    const mat = new THREE.SpriteMaterial({
      map: ouchTexture(word),
      transparent: true,
      depthWrite: false,
      depthTest: false, // readable even at point-blank camera range
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(at).add(new THREE.Vector3(0, 0.06, 0));
    sprite.scale.set(0.2, 0.075, 1);
    this.scene.add(sprite);
    this.items.push({
      sprite,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 0.06,
        0.22,
        (Math.random() - 0.5) * 0.06
      ),
      life: 1.3,
      age: 0,
    });
  }

  frame(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const s = this.items[i];
      s.age += dt;
      const mat = s.sprite.material as THREE.SpriteMaterial;
      if (s.age >= s.life) {
        this.scene.remove(s.sprite);
        mat.map?.dispose(); // per-emit word texture
        mat.dispose();
        this.items.splice(i, 1);
        continue;
      }
      s.sprite.position.addScaledVector(s.vel, dt);
      const t = s.age / s.life;
      mat.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
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
