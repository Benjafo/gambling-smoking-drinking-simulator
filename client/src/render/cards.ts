/* Card meshes with canvas-generated faces (same design language as the 2D
   game) and deal/flip tweens driven by snapshot diffs. */
import * as THREE from "three";
import type { Card } from "@shared/blackjack";
import { tween, easeInOut } from "./tween";

export const CARD_W = 0.1;
export const CARD_H = 0.145;
const CARD_T = 0.0022;

const texCache = new Map<string, THREE.CanvasTexture>();
let backTex: THREE.CanvasTexture | null = null;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function faceTexture(card: Card): THREE.CanvasTexture {
  const key = card.r + card.s;
  const hit = texCache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 372;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#f2e8d5";
  roundRect(ctx, 0, 0, 256, 372, 20);
  ctx.fill();
  ctx.strokeStyle = "#b7ab90";
  ctx.lineWidth = 4;
  roundRect(ctx, 2, 2, 252, 368, 18);
  ctx.stroke();

  // oversized indices: these cards are read from a metre away at an angle,
  // not from a hand of cards — legibility beats print fidelity
  // deep inks: the warm spot + ACES tone mapping washes lighter pigments
  const red = card.s === "♥" || card.s === "♦";
  ctx.fillStyle = red ? "#8f1418" : "#0d0b08";
  ctx.font = "700 96px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText(card.r, 62, 92);
  ctx.font = "72px Georgia, serif";
  ctx.fillText(card.s, 62, 164);
  // exact 180° mirror of the top-left index (baselines 92/164 from the top
  // edge) — offsets beyond that push the rank glyph past the canvas bottom
  ctx.save();
  ctx.translate(194, 280);
  ctx.rotate(Math.PI);
  ctx.font = "700 96px Georgia, serif";
  ctx.fillText(card.r, 0, 0);
  ctx.font = "72px Georgia, serif";
  ctx.fillText(card.s, 0, 72);
  ctx.restore();
  ctx.font = "140px Georgia, serif";
  ctx.fillText(card.s, 172, 330);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

function backTexture(): THREE.CanvasTexture {
  if (backTex) return backTex;
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 372;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#5d1517";
  roundRect(ctx, 0, 0, 256, 372, 20);
  ctx.fill();
  ctx.save();
  roundRect(ctx, 12, 12, 232, 348, 12);
  ctx.clip();
  ctx.strokeStyle = "#7a1f22";
  ctx.lineWidth = 8;
  for (let i = -400; i < 400; i += 18) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 372, 372);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "#3c0d0f";
  ctx.lineWidth = 6;
  roundRect(ctx, 10, 10, 236, 352, 14);
  ctx.stroke();
  backTex = new THREE.CanvasTexture(cv);
  backTex.colorSpace = THREE.SRGBColorSpace;
  return backTex;
}

const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: 0.8 });
const cardGeo = new THREE.BoxGeometry(CARD_W, CARD_H, CARD_T);

interface CardObj {
  group: THREE.Group; // world placement (flat on table, tilt, deal tween)
  inner: THREE.Mesh; // flip rotation about local Y
  data: Card;
  faceUp: boolean;
}

/* card faces glow softly with their own texture: pips must stay inky under
   the warm spot + ACES tone mapping, not wash out to beige */
function faceMaterial(tex: THREE.CanvasTexture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.55,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 0.55,
  });
}

function makeCardMesh(card: Card, faceUp: boolean): CardObj {
  const frontMat = faceMaterial(card.r === "?" ? backTexture() : faceTexture(card));
  const backMat = faceMaterial(backTexture());
  const inner = new THREE.Mesh(cardGeo, [edgeMat, edgeMat, edgeMat, edgeMat, frontMat, backMat]);
  inner.castShadow = true;
  const group = new THREE.Group();
  group.add(inner);
  if (!faceUp) inner.rotation.y = Math.PI;
  return { group, inner, data: card, faceUp };
}

export interface CardZoneOpts {
  scale?: number; // bigger cards for hands that must be read precisely
  lean?: number; // radians the card leans back toward its owner's eye
  badgeOffset?: { x: number; y: number; z: number }; // pill position vs anchor
  badgeScale?: number;
}

/* A zone renders one hand (dealer or a seat) and diffs against snapshots. */
export class CardZone {
  private cards: CardObj[] = [];
  private scale: number;
  private lean: number;
  /* 0..1: when the viewer's stake in the next reveal is high, flips hang
     an extra beat before turning — anticipation is the payoff */
  private tension = 0;
  private badge: THREE.Sprite | null = null;
  private badgeText: string | null = null;
  private badgeOffset: THREE.Vector3;
  private badgeScale: number;
  /* deals/flips in flight: the total pill must not spoil a card that hasn't
     turned over yet, so badge updates wait for the animations to finish */
  private animating = 0;
  private pendingBadge: string | null = null;
  private badgeDirty = false;
  constructor(
    private scene: THREE.Scene,
    private anchor: THREE.Vector3,
    private yaw: number,
    private shoePos: THREE.Vector3,
    private onDeal?: () => void,
    opts?: CardZoneOpts
  ) {
    this.scale = opts?.scale ?? 1;
    this.lean = opts?.lean ?? 0;
    const bo = opts?.badgeOffset ?? { x: 0, y: 0.14 * this.scale, z: 0 };
    this.badgeOffset = new THREE.Vector3(bo.x, bo.y, bo.z);
    this.badgeScale = opts?.badgeScale ?? 1;
  }

  setTension(v: number): void {
    this.tension = v;
  }

  private slotPos(i: number): THREE.Vector3 {
    const tangent = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const p = this.anchor.clone().addScaledVector(tangent, (i - 1) * 0.125 * this.scale);
    // leaned cards pivot at their center: lift so the bottom edge stays on the felt
    p.y += ((CARD_H * this.scale) / 2) * Math.sin(this.lean) * 0.95;
    return p;
  }

  private beginAnim(): void {
    this.animating++;
  }

  private endAnim(): void {
    this.animating = Math.max(0, this.animating - 1);
    if (this.animating === 0 && this.badgeDirty) this.applyBadge(this.pendingBadge);
  }

  /* floating total pill above the hand — readable at any distance, and in
     multiplayer it's how you read the table at a glance. Deferred while
     cards are still flying/flipping: the reveal comes before the arithmetic. */
  setBadge(text: string | null): void {
    this.pendingBadge = text;
    if (this.animating === 0) this.applyBadge(text);
    else this.badgeDirty = true;
  }

  private applyBadge(text: string | null): void {
    this.badgeDirty = false;
    if (text === this.badgeText) return;
    this.badgeText = text;
    if (this.badge) {
      this.scene.remove(this.badge);
      (this.badge.material as THREE.SpriteMaterial).map?.dispose();
      (this.badge.material as THREE.SpriteMaterial).dispose();
      this.badge = null;
    }
    if (!text) return;
    const cv = document.createElement("canvas");
    cv.width = 320;
    cv.height = 96;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "rgba(10,8,5,0.78)";
    ctx.beginPath();
    ctx.roundRect(4, 4, 312, 88, 44);
    ctx.fill();
    ctx.strokeStyle = "rgba(242,232,213,0.4)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#f2e8d5";
    ctx.font = "700 52px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 160, 52);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.badge = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    this.badge.scale.set(0.2 * this.badgeScale, 0.06 * this.badgeScale, 1);
    this.badge.position.copy(this.anchor).add(this.badgeOffset);
    this.scene.add(this.badge);
  }

  reconcile(hand: Card[]): void {
    // hand cleared (new round): sweep everything away
    if (hand.length < this.cards.length) this.clear();

    for (let i = 0; i < hand.length; i++) {
      const want = hand[i];
      const have = this.cards[i];
      if (!have) {
        this.spawn(want, i);
      } else if (have.data.r !== want.r || have.data.s !== want.s) {
        // hole card revealed: real rank replaces "?" — retexture and flip
        have.data = want;
        (have.inner.material as THREE.Material[])[4] = faceMaterial(faceTexture(want));
        if (!have.faceUp) this.flip(have);
      }
    }
  }

  private spawn(card: Card, i: number): void {
    const faceDown = card.r === "?";
    const obj = makeCardMesh(card, false); // all cards leave the shoe back-up
    obj.faceUp = false;
    const target = this.slotPos(i);
    const tilt = (Math.random() - 0.5) * 0.07;
    // -90° is flat on the felt; the lean tips the face toward the owner
    obj.group.rotation.set(-Math.PI / 2 + this.lean, 0, 0);
    obj.group.rotation.y = this.yaw + tilt;
    obj.group.scale.setScalar(this.scale);
    obj.group.position.copy(this.shoePos);
    this.scene.add(obj.group);
    this.cards[i] = obj;
    this.onDeal?.();

    const from = this.shoePos.clone();
    const lift = 0.28;
    this.beginAnim();
    tween({
      duration: 420,
      update: (t) => {
        obj.group.position.lerpVectors(from, target, t);
        obj.group.position.y += Math.sin(t * Math.PI) * lift;
      },
      done: () => {
        obj.group.position.copy(target);
        // start the flip before releasing the deal: the badge hold must
        // span both animations without a gap
        if (!faceDown) this.flip(obj);
        this.endAnim();
      },
    });
  }

  private flip(obj: CardObj): void {
    obj.faceUp = true;
    this.beginAnim();
    const base = obj.group.position.clone();
    const tense = this.tension > 0;
    const hang = tense ? 450 : 0; // the card lifts... and hovers
    if (tense) {
      tween({
        duration: hang,
        ease: easeInOut,
        update: (t) => {
          obj.group.position.y = base.y + t * 0.05;
        },
      });
    }
    tween({
      duration: 380 + (tense ? 200 : 0),
      delay: hang,
      ease: easeInOut,
      update: (t) => {
        obj.inner.rotation.y = Math.PI * (1 - t);
        obj.group.position.y =
          base.y + (tense ? 0.05 * (1 - t) : 0) + Math.sin(t * Math.PI) * 0.08;
      },
      done: () => {
        obj.inner.rotation.y = 0;
        obj.group.position.y = base.y;
        this.endAnim();
      },
    });
  }

  clear(): void {
    for (const c of this.cards) this.scene.remove(c.group);
    this.cards = [];
    // a cleared hand hides its pill immediately — nothing left to spoil
    this.pendingBadge = null;
    this.applyBadge(null);
  }
}
