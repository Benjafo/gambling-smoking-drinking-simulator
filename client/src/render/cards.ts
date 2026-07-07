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

  const red = card.s === "♥" || card.s === "♦";
  ctx.fillStyle = red ? "#b3272c" : "#1d1a14";
  ctx.font = "700 52px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText(card.r, 40, 58);
  ctx.font = "44px Georgia, serif";
  ctx.fillText(card.s, 40, 102);
  ctx.save();
  ctx.translate(216, 314);
  ctx.rotate(Math.PI);
  ctx.font = "700 52px Georgia, serif";
  ctx.fillText(card.r, 0, -46);
  ctx.font = "44px Georgia, serif";
  ctx.fillText(card.s, 0, 0);
  ctx.restore();
  ctx.font = "150px Georgia, serif";
  ctx.fillText(card.s, 128, 240);

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

function makeCardMesh(card: Card, faceUp: boolean): CardObj {
  const frontMat = new THREE.MeshStandardMaterial({
    map: card.r === "?" ? backTexture() : faceTexture(card),
    roughness: 0.55,
  });
  const backMat = new THREE.MeshStandardMaterial({ map: backTexture(), roughness: 0.6 });
  const inner = new THREE.Mesh(cardGeo, [edgeMat, edgeMat, edgeMat, edgeMat, frontMat, backMat]);
  inner.castShadow = true;
  const group = new THREE.Group();
  group.add(inner);
  if (!faceUp) inner.rotation.y = Math.PI;
  return { group, inner, data: card, faceUp };
}

/* A zone renders one hand (dealer or a seat) and diffs against snapshots. */
export class CardZone {
  private cards: CardObj[] = [];
  constructor(
    private scene: THREE.Scene,
    private anchor: THREE.Vector3,
    private yaw: number,
    private shoePos: THREE.Vector3,
    private onDeal?: () => void
  ) {}

  private slotPos(i: number): THREE.Vector3 {
    const tangent = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return this.anchor.clone().addScaledVector(tangent, (i - 1) * 0.125);
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
        (have.inner.material as THREE.Material[])[4] = new THREE.MeshStandardMaterial({
          map: faceTexture(want),
          roughness: 0.55,
        });
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
    obj.group.rotation.set(-Math.PI / 2, 0, 0);
    obj.group.rotation.y = this.yaw + tilt;
    obj.group.position.copy(this.shoePos);
    this.scene.add(obj.group);
    this.cards[i] = obj;
    this.onDeal?.();

    const from = this.shoePos.clone();
    const lift = 0.28;
    tween({
      duration: 420,
      update: (t) => {
        obj.group.position.lerpVectors(from, target, t);
        obj.group.position.y += Math.sin(t * Math.PI) * lift;
      },
      done: () => {
        obj.group.position.copy(target);
        if (!faceDown) this.flip(obj);
      },
    });
  }

  private flip(obj: CardObj): void {
    obj.faceUp = true;
    const base = obj.group.position.clone();
    tween({
      duration: 380,
      ease: easeInOut,
      update: (t) => {
        obj.inner.rotation.y = Math.PI * (1 - t);
        obj.group.position.y = base.y + Math.sin(t * Math.PI) * 0.08;
      },
      done: () => {
        obj.inner.rotation.y = 0;
        obj.group.position.y = base.y;
      },
    });
  }

  clear(): void {
    for (const c of this.cards) this.scene.remove(c.group);
    this.cards = [];
  }
}
