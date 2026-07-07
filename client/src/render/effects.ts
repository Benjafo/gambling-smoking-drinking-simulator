/* Impact audio + cigar smoke particles. All cosmetic, all client-side. */
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
      new THREE.Vector3((Math.random() - 0.5) * 0.06, 0, (Math.random() - 0.5) * 0.06)
    );
    sprite.scale.setScalar(0.06);
    this.scene.add(sprite);
    this.puffs.push({
      sprite,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.05, 0.22 + Math.random() * 0.12, (Math.random() - 0.5) * 0.05),
      life: 1.5 + Math.random() * 0.5,
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
      p.sprite.scale.setScalar(0.06 + t * 0.22);
      (p.sprite.material as THREE.SpriteMaterial).opacity = 0.7 * (1 - t);
    }
  }
}
