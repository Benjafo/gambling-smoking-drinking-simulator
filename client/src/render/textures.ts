/* Procedural canvas textures for the den — no asset files, everything is
   drawn at boot. Felt gets the classic printed blackjack layout; wood gets
   grain; the floor gets a tired carpet. */
import * as THREE from "three";

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

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
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
