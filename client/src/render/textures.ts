/* Procedural canvas textures for the den — no asset files, everything is
   drawn at boot. Felt gets the classic printed blackjack layout; wood gets
   grain; the floor gets a tired carpet. */
import * as THREE from "three";
import { chipLabel, type ChipStyle } from "../chips";

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  return [cv, cv.getContext("2d")!];
}

function speckle(
  ctx: CanvasRenderingContext2D,
  size: number,
  count: number,
  alpha: number
): void {
  for (let i = 0; i < count; i++) {
    const v = Math.random();
    ctx.fillStyle = v < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,240,${alpha * 0.7})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random(), 1 + Math.random());
  }
}

/* text along a circular arc; phi=0 points toward canvas +x, arc is centered
   there and read from outside the circle. Characters are laid out clockwise
   in canvas space because the cap's UV mapping (calibrated by screenshot:
   canvas +x → world +z, canvas +y → world −x) renders canvas-CCW as
   world-CW when viewed from the player's side of the table. */
function arcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  r: number,
  centerPhi: number,
  arcSpan: number
): void {
  const step = arcSpan / Math.max(1, text.length - 1);
  for (let i = 0; i < text.length; i++) {
    const phi = centerPhi + arcSpan / 2 - i * step;
    ctx.save();
    ctx.translate(cx + Math.cos(phi) * r, cy + Math.sin(phi) * r);
    ctx.rotate(phi - Math.PI / 2);
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }
}

/* world seat angle A (from +z toward +x) lands at canvas angle −A under the
   calibrated mapping */
const MIRROR = -1;

export function feltTexture(seatAngles: number[]): THREE.CanvasTexture {
  const S = 1024;
  const [cv, ctx] = canvas(S);
  const c = S / 2;

  const g = ctx.createRadialGradient(c, c, S * 0.06, c, c, S * 0.52);
  g.addColorStop(0, "#26593a");
  g.addColorStop(0.62, "#1d4a30");
  g.addColorStop(1, "#12331f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, S, 14000, 0.05);

  // outer trim: double ring
  ctx.strokeStyle = "rgba(242,232,213,0.30)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, S * 0.462, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c, c, S * 0.446, 0, Math.PI * 2);
  ctx.stroke();

  // the printed rules band, facing the players' side (canvas -x once the
  // whole drawing is flipped for the cap's mirrored UVs)
  ctx.fillStyle = "rgba(242,232,213,0.42)";
  ctx.font = "italic 700 30px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  arcText(ctx, "BLACKJACK PAYS 3 TO 2", c, c, S * 0.34, 0, Math.PI * 0.5);
  ctx.font = "italic 700 20px Georgia, serif";
  ctx.fillStyle = "rgba(242,232,213,0.30)";
  arcText(ctx, "DEALER STANDS ON ALL 17s  ·  NO EXITS", c, c, S * 0.275, 0, Math.PI * 0.52);

  // bet spots at each seat
  for (const a of seatAngles) {
    const phi = MIRROR * a;
    const x = c + Math.cos(phi) * S * 0.41;
    const y = c + Math.sin(phi) * S * 0.41;
    ctx.strokeStyle = "rgba(242,232,213,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([5, 7]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // house mark at the dealer's side
  ctx.fillStyle = "rgba(242,232,213,0.16)";
  ctx.font = "44px Georgia, serif";
  ctx.save();
  ctx.translate(c - S * 0.3, c);
  ctx.rotate(Math.PI / 2);
  ctx.fillText("♠ ♥ ♦ ♣", 0, 0);
  ctx.restore();

  // years of abuse, printed over the layout: drink rings where glasses
  // sweat, cigarette burns clustered near the rim where cigars get parked,
  // and a shiny lane worn where every hand ever dealt has slid
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = S * (0.16 + Math.random() * 0.28);
    const x = c + Math.cos(a) * rr;
    const y = c + Math.sin(a) * rr;
    ctx.strokeStyle = `rgba(46,28,10,${0.15 + Math.random() * 0.14})`;
    ctx.lineWidth = 3.5 + Math.random() * 4;
    ctx.beginPath();
    ctx.arc(x, y, 14 + Math.random() * 15, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = S * (0.35 + Math.random() * 0.09);
    const x = c + Math.cos(a) * rr;
    const y = c + Math.sin(a) * rr;
    ctx.fillStyle = "rgba(214,200,168,0.45)"; // ash halo
    ctx.beginPath();
    ctx.ellipse(x, y, 7, 4.2, a, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(14,9,4,0.8)"; // the scorch itself
    ctx.beginPath();
    ctx.ellipse(x, y, 4, 2.4, a, 0, Math.PI * 2);
    ctx.fill();
  }
  const wear = ctx.createRadialGradient(c, c + S * 0.08, S * 0.04, c, c + S * 0.08, S * 0.3);
  wear.addColorStop(0, "rgba(232,222,196,0.07)");
  wear.addColorStop(1, "rgba(232,222,196,0)");
  ctx.fillStyle = wear;
  ctx.fillRect(0, 0, S, S);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* chip paint, cached per denomination — every $25 chip in the room shares
   one set of maps. CylinderGeometry material order: [rim, top, bottom]. */
const chipMatCache = new Map<number, THREE.Material[]>();

export function chipMaterials(s: ChipStyle): THREE.Material[] {
  const hit = chipMatCache.get(s.value);
  if (hit) return hit;

  // face: body paint, the dashed ring the HUD rack also wears, value dead
  // center. Both caps share it; the underside's mirrored print never shows.
  const S = 128;
  const [cv, ctx] = canvas(S);
  ctx.fillStyle = s.color;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = s.edge;
  ctx.lineWidth = 10;
  ctx.setLineDash([11, 10]);
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.43, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.31, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const label = chipLabel(s.value);
  ctx.fillStyle = s.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 34px 'Silkscreen','Courier New',monospace";
  const w = ctx.measureText(label).width;
  if (w > S * 0.52) ctx.font = `700 ${Math.floor((34 * S * 0.52) / w)}px 'Silkscreen','Courier New',monospace`;
  ctx.fillText(label, S / 2, S / 2 + 2);
  speckle(ctx, S, 260, 0.05); // table wear
  const face = new THREE.CanvasTexture(cv);
  face.colorSpace = THREE.SRGBColorSpace;
  face.anisotropy = 4;

  // rim: six edge stripes — what makes a stack read as denominations from
  // across the table. The cylinder wall wraps this once around.
  const rcv = document.createElement("canvas");
  rcv.width = 240;
  rcv.height = 32;
  const rctx = rcv.getContext("2d")!;
  rctx.fillStyle = s.color;
  rctx.fillRect(0, 0, 240, 32);
  rctx.fillStyle = s.edge;
  for (let i = 0; i < 6; i++) rctx.fillRect(i * 40 + 13, 0, 14, 32);
  const rim = new THREE.CanvasTexture(rcv);
  rim.colorSpace = THREE.SRGBColorSpace;
  rim.anisotropy = 4;

  const capMat = new THREE.MeshStandardMaterial({ map: face, roughness: 0.55 });
  const mats = [new THREE.MeshStandardMaterial({ map: rim, roughness: 0.55 }), capMat, capMat];
  chipMatCache.set(s.value, mats);
  return mats;
}

export function woodTexture(): THREE.CanvasTexture {
  const S = 512;
  const [cv, ctx] = canvas(S);
  ctx.fillStyle = "#3a2a18";
  ctx.fillRect(0, 0, S, S);
  // long grain streaks with a slow wobble
  for (let i = 0; i < 170; i++) {
    const y0 = Math.random() * S;
    const w = 0.6 + Math.random() * 2.2;
    const dark = Math.random() < 0.55;
    ctx.strokeStyle = dark
      ? `rgba(20,10,3,${0.12 + Math.random() * 0.2})`
      : `rgba(190,130,70,${0.05 + Math.random() * 0.1})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    const wobble = 3 + Math.random() * 7;
    const phase = Math.random() * Math.PI * 2;
    for (let x = 0; x <= S; x += 16)
      ctx.lineTo(x, y0 + Math.sin(x / 70 + phase) * wobble);
    ctx.stroke();
  }
  // occasional knot
  for (let i = 0; i < 5; i++) {
    const x = Math.random() * S,
      y = Math.random() * S;
    ctx.strokeStyle = "rgba(20,10,3,0.25)";
    ctx.lineWidth = 1.4;
    for (let r = 3; r < 14; r += 3.5) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  speckle(ctx, S, 2500, 0.04);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export function carpetTexture(): THREE.CanvasTexture {
  const S = 512;
  const [cv, ctx] = canvas(S);
  ctx.fillStyle = "#191009";
  ctx.fillRect(0, 0, S, S);
  // worn diamond lattice
  ctx.strokeStyle = "rgba(120,70,40,0.10)";
  ctx.lineWidth = 2;
  const step = 64;
  for (let x = -S; x < S * 2; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + S, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + S, 0);
    ctx.lineTo(x, S);
    ctx.stroke();
  }
  // faded medallions at the lattice crossings
  ctx.fillStyle = "rgba(160,100,50,0.07)";
  for (let x = step / 2; x < S; x += step)
    for (let y = step / 2; y < S; y += step) {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  speckle(ctx, S, 6000, 0.05);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  tex.anisotropy = 4;
  return tex;
}

/* grimy plaster for the den's walls. Tiles horizontally (blobs are drawn
   thrice at ±S so the seam never shows); vertically it's meant to map once,
   floor to ceiling — the grime gradient darkens at the baseboard and the
   ceiling line, so keep repeat.y = 1. */
export function plasterTexture(): THREE.CanvasTexture {
  const S = 512;
  const [cv, ctx] = canvas(S);
  ctx.fillStyle = "#46402c";
  ctx.fillRect(0, 0, S, S);
  // mottled patches of old paint and older grime
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 22 + Math.random() * 62;
    const dark = Math.random() < 0.6;
    const a = dark ? 0.05 + Math.random() * 0.08 : 0.04 + Math.random() * 0.05;
    for (const ox of [-S, 0, S]) {
      const g = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, r);
      g.addColorStop(0, dark ? `rgba(22,18,10,${a})` : `rgba(122,106,68,${a})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y - r, r * 2, r * 2);
    }
  }
  // water stains bleeding down from the ceiling line
  for (let i = 0; i < 6; i++) {
    const x0 = S * 0.08 + Math.random() * S * 0.84;
    const w = 10 + Math.random() * 26;
    const len = S * (0.2 + Math.random() * 0.35);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(58,44,22,${0.1 + Math.random() * 0.1})`);
    g.addColorStop(1, "rgba(58,44,22,0)");
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x0, 0);
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(w / 2, 0);
    ctx.lineTo(w * 0.2, len);
    ctx.lineTo(-w * 0.15, len * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // hairline cracks wandering down
  for (let i = 0; i < 7; i++) {
    ctx.strokeStyle = `rgba(16,13,7,${0.25 + Math.random() * 0.2})`;
    ctx.lineWidth = 0.8 + Math.random() * 0.6;
    let x = S * 0.1 + Math.random() * S * 0.8;
    let y = Math.random() * S * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 4 + Math.floor(Math.random() * 4);
    for (let k = 0; k < steps; k++) {
      x += (Math.random() - 0.5) * 40;
      y += 20 + Math.random() * 50;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // scuffed dark at the floor, nicotine-dark at the ceiling
  const g2 = ctx.createLinearGradient(0, 0, 0, S);
  g2.addColorStop(0, "rgba(14,11,5,0.32)");
  g2.addColorStop(0.22, "rgba(14,11,5,0)");
  g2.addColorStop(0.78, "rgba(10,8,4,0)");
  g2.addColorStop(1, "rgba(10,8,4,0.38)");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, S, 4200, 0.04);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/* worn floorboards for under the rug — dark planks, butt joints, scuffs */
export function floorboardTexture(): THREE.CanvasTexture {
  const S = 512;
  const [cv, ctx] = canvas(S);
  const rows = 8;
  const rowH = S / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    // per-plank tint drift
    const t = 0.85 + Math.random() * 0.35;
    ctx.fillStyle = `rgb(${Math.round(52 * t)},${Math.round(36 * t)},${Math.round(20 * t)})`;
    ctx.fillRect(0, y, S, rowH);
    // grain confined to the plank
    for (let i = 0; i < 26; i++) {
      const gy = y + 2 + Math.random() * (rowH - 4);
      const dark = Math.random() < 0.55;
      ctx.strokeStyle = dark
        ? `rgba(18,10,3,${0.1 + Math.random() * 0.18})`
        : `rgba(170,120,66,${0.04 + Math.random() * 0.08})`;
      ctx.lineWidth = 0.6 + Math.random() * 1.6;
      ctx.beginPath();
      const wob = 1 + Math.random() * 2.5;
      const ph = Math.random() * Math.PI * 2;
      for (let x = 0; x <= S; x += 16) ctx.lineTo(x, gy + Math.sin(x / 60 + ph) * wob);
      ctx.stroke();
    }
    // butt joint + nail heads
    const jx = Math.random() * S;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(jx, y);
    ctx.lineTo(jx, y + rowH);
    ctx.stroke();
    ctx.fillStyle = "rgba(10,7,3,0.7)";
    for (const side of [-6, 6]) {
      ctx.beginPath();
      ctx.arc((jx + side + S) % S, y + rowH * (0.25 + Math.random() * 0.5), 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // gap between planks
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, y + rowH - 1.5, S, 1.5);
  }
  // scuffs and drag marks
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = `rgba(190,160,110,${0.03 + Math.random() * 0.05})`;
    ctx.lineWidth = 1.5 + Math.random() * 3;
    const y = Math.random() * S;
    ctx.beginPath();
    ctx.moveTo(Math.random() * S * 0.5, y);
    ctx.lineTo(S * 0.5 + Math.random() * S * 0.5, y + (Math.random() - 0.5) * 30);
    ctx.stroke();
  }
  speckle(ctx, S, 3200, 0.05);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/* the ceiling nobody was ever meant to look at: stained plaster, smoke
   shadow blooming over where the lamp hangs, water damage in the corners */
export function ceilingTexture(): THREE.CanvasTexture {
  const S = 512;
  const [cv, ctx] = canvas(S);
  ctx.fillStyle = "#2a241a";
  ctx.fillRect(0, 0, S, S);
  const c = S / 2;
  // decades of cigar smoke rising off the table below
  const smoke = ctx.createRadialGradient(c, c, S * 0.05, c, c, S * 0.5);
  smoke.addColorStop(0, "rgba(12,9,4,0.5)");
  smoke.addColorStop(0.6, "rgba(12,9,4,0.18)");
  smoke.addColorStop(1, "rgba(12,9,4,0)");
  ctx.fillStyle = smoke;
  ctx.fillRect(0, 0, S, S);
  // water stains: brown blotches with darker rims
  for (let i = 0; i < 7; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 18 + Math.random() * 45;
    ctx.fillStyle = `rgba(74,52,24,${0.08 + Math.random() * 0.09})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + Math.random() * 0.4), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(52,34,14,${0.15 + Math.random() * 0.12})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.75, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.stroke();
  }
  speckle(ctx, S, 3800, 0.045);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function leatherTexture(): THREE.CanvasTexture {
  const S = 256;
  const [cv, ctx] = canvas(S);
  ctx.fillStyle = "#5d1517";
  ctx.fillRect(0, 0, S, S);
  // creases
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.1})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    let x = Math.random() * S,
      y = Math.random() * S;
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += (Math.random() - 0.5) * 60;
      y += (Math.random() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  speckle(ctx, S, 1800, 0.06);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
