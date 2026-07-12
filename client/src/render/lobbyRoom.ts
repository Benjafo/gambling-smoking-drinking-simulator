/* The waiting room: a grimy back-of-the-bar lounge rendered as its own
   scene. While the sim's phase is "lobby", SceneView routes pointer input
   here, renders this scene, and everyone walks around in first person —
   WASD to wander, mouse to look. The pointer locks itself on entry
   (FPS-style free look, crosshair marks the pick ray; a click re-captures
   whenever the browser wanted a fresher gesture); Esc hands the cursor to
   the options menu — main.ts owns that hand-off. Touch — and anywhere the
   lock is refused, headless runs included — keeps the old drag-to-look.
   Geometry matches shared/src/lobbyRoom.ts
   exactly: the furniture you see is the furniture the server collides you
   against, and local prediction runs the same stepLobbyMove() the sim runs,
   so the camera never fights the authority it's predicting. */
import * as THREE from "three";
import {
  DISPENSE_RADIUS,
  DOOR_RADIUS,
  LOBBY_DISPENSERS,
  LOBBY_DOOR,
  LOBBY_EYE_HEIGHT,
  LOBBY_JUMP_SPEED,
  LOBBY_OBSTACLES,
  LOBBY_REACH,
  LOBBY_ROOM,
  LOBBY_SCATTER,
  stepLobbyMove,
  type LobbyMotion,
} from "@shared/lobbyRoom";
import type { Intent, PlayerSnap, PropKind, Snapshot, ViceKind } from "@shared/types";
import { carpetTexture, leatherTexture, woodTexture } from "./textures";
import { DebrisView } from "./debris";
import { HeldItemControl, makeBottleMesh, makeCigarMesh } from "./held";
import { denySound, pickupSound } from "./effects";
import { makeFigure, poseArm } from "./figure";

/* you must be able to look at your own feet: pickup reach is 2.2m, and at
   the old -0.55 clamp the crosshair could only touch floor 2.38m+ away —
   every piece of litter close enough to grab sat below the screen edge */
const PITCH_MIN = -1.25;
const PITCH_MAX = 0.7;
/* rad per px of captured mouse travel — the table's free look imports this
   so both rooms turn at exactly the same rate */
export const LOOK_SENS = 0.0023;
const WALK_ANIM_HZ = 7.5; // leg-swing speed, phase cycles per second-ish

/* the crosshair's pick ray: dead center */
const CENTER = new THREE.Vector2(0, 0);

/* wrap to (-π, π] */
function wrapAngle(a: number): number {
  return ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

function canvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void
): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function nameSprite(name: string): THREE.Sprite {
  const tex = canvasTexture(256, 64, (ctx) => {
    ctx.font = "700 32px 'Pixelify Sans',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#ffc832";
    ctx.fillText(name.toUpperCase().slice(0, 14), 128, 34);
  });
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  sprite.scale.set(0.95, 0.24, 1);
  sprite.position.y = 1.72;
  return sprite;
}

interface LobbyAvatar {
  group: THREE.Group;
  legs: [THREE.Group, THREE.Group];
  targetPos: THREE.Vector3;
  targetYaw: number;
  moving: boolean;
  walkPhase: number;
  baseY: number;
}

export class LobbyRoomView {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;

  private active = false;
  private myId = "";
  private latest: Snapshot | null = null;

  /* first-person state: locally predicted position + free look. motion
     wraps myPos (same object) so prediction runs the sim's exact step,
     jumps included. */
  private myPos = new THREE.Vector3();
  private motion: LobbyMotion = { pos: this.myPos, vy: 0, grounded: true };
  private posInit = false;
  private correction = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private looking = false;
  private lastPointer = { x: 0, y: 0 };
  /* virtual hand position for wind-up drags while the pointer is locked */
  private virt = { x: 0, y: 0 };
  private crosshairEl = document.getElementById("crosshair");
  private keys = new Set<string>();
  private lastSentDir = { x: 0, z: 0 };
  private lastSentYaw = 0;
  private lastMoveSent = 0;

  private avatars = new Map<string, LobbyAvatar>();

  /* pre-game littering: the lobby's own debris + held-empty machinery,
     the same gestures the table uses (drag the empty, release to fling) */
  private debris: DebrisView;
  readonly held: HeldItemControl;
  private raycaster = new THREE.Raycaster();
  /* the canvas, for hover cursors — set by SceneView after construction */
  domElement: HTMLElement | null = null;
  private wasGrabbing = false;
  private lastHeldSent = 0;
  private dispenseHint = document.getElementById("dispenseHint");

  /* ambient life */
  private bulbLight!: THREE.PointLight;
  private bulbMesh!: THREE.Mesh;
  private bulbDropUntil = 0;
  private neonMat!: THREE.MeshBasicMaterial;
  private neonLight!: THREE.PointLight;
  private jukeGlow!: THREE.MeshBasicMaterial;
  private jukeLight!: THREE.PointLight;

  constructor(private send: (i: Intent) => void) {
    this.camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.05, 40);
    this.scene.background = new THREE.Color(0x0b0906);
    this.scene.fog = new THREE.Fog(0x0b0906, 7, 16);
    this.buildRoom();
    this.buildFurniture();
    this.buildTrash();
    this.debris = new DebrisView(this.scene);
    this.held = new HeldItemControl(this.scene, this.camera, send);

    addEventListener("keydown", (e) => {
      if (!this.active || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "KeyE") {
        this.captureLook(); // any gameplay key re-arms mouse-look (Esc can't)
        if (this.nearDoor()) this.tryStartAtDoor();
        else this.tryDispense();
        return;
      }
      if (e.code === "KeyO" || e.code === "KeyC") {
        // the janitor key (O, with C as a legacy alias) — leader-only,
        // same intent as the lobby button
        if (this.latest?.leaderId === this.myId) this.send({ type: "clearLitter" });
        return;
      }
      if (e.code === "Space") {
        this.captureLook();
        this.tryJump();
        e.preventDefault();
        return;
      }
      if (KEY_DIRS[e.code]) {
        this.captureLook();
        this.keys.add(e.code);
        e.preventDefault();
      }
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    // alt-tabbing away with W held would walk you into a wall forever
    addEventListener("blur", () => this.keys.clear());
    document.addEventListener("pointerlockchange", () => this.syncLockUi());
  }

  /* ---------------- pointer lock (mouse-look) ---------------- */
  private get locked(): boolean {
    return !!this.domElement && document.pointerLockElement === this.domElement;
  }

  /* called on lobby entry (riding the join click's user activation), on
     any canvas click, and by SceneView when the options RESUME button
     closes over the lobby */
  captureLook(): void {
    if (!this.active || this.locked || !this.domElement) return;
    try {
      // returns a promise in most engines, undefined in older ones; a
      // refusal (headless, iframe policy, Esc cooldown) just leaves the
      // drag fallback in charge
      const r = this.domElement.requestPointerLock() as unknown as
        | { catch?: (fn: () => void) => void }
        | undefined;
      r?.catch?.(() => undefined);
    } catch {
      /* no pointer lock here — drag-to-look still works */
    }
  }

  private syncLockUi(): void {
    const locked = this.locked;
    this.crosshairEl?.classList.toggle("show", this.active && locked);
    if (!locked) this.crosshairEl?.classList.remove("grab", "deny");
  }

  /* ---------------- the room shell ---------------- */
  private buildRoom(): void {
    const { halfW, halfD, height } = LOBBY_ROOM;

    const carpet = carpetTexture();
    carpet.repeat.set(6, 4.5);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(halfW * 2, halfD * 2),
      new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.97 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(halfW * 2, halfD * 2),
      new THREE.MeshStandardMaterial({ color: 0x141009, roughness: 1 })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = height;
    this.scene.add(ceiling);

    // nicotine-stained plaster above wood wainscot, on all four walls
    const plaster = new THREE.MeshStandardMaterial({ color: 0x37301f, roughness: 0.95 });
    const wainscotWood = woodTexture();
    wainscotWood.repeat.set(4, 1); // paneling, not one 8-meter plank
    const wainscotMat = new THREE.MeshStandardMaterial({ map: wainscotWood, roughness: 0.8 });
    const baseboardMat = new THREE.MeshStandardMaterial({ color: 0x120e08, roughness: 0.9 });
    const WAIN_H = 0.85;
    const walls: { w: number; x: number; z: number; ry: number }[] = [
      { w: halfW * 2, x: 0, z: -halfD, ry: 0 },
      { w: halfW * 2, x: 0, z: halfD, ry: Math.PI },
      { w: halfD * 2, x: -halfW, z: 0, ry: Math.PI / 2 },
      { w: halfD * 2, x: halfW, z: 0, ry: -Math.PI / 2 },
    ];
    for (const s of walls) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(s.w, height), plaster);
      wall.position.set(s.x, height / 2, s.z);
      wall.rotation.y = s.ry;
      wall.receiveShadow = true;
      const wain = new THREE.Mesh(new THREE.PlaneGeometry(s.w, WAIN_H), wainscotMat);
      wain.position.set(s.x, WAIN_H / 2, s.z);
      wain.rotation.y = s.ry;
      wain.translateZ(0.012);
      const base = new THREE.Mesh(new THREE.PlaneGeometry(s.w, 0.09), baseboardMat);
      base.position.set(s.x, 0.045, s.z);
      base.rotation.y = s.ry;
      base.translateZ(0.02);
      this.scene.add(wall, wain, base);
    }

    /* light: one honest bulb (it flickers), one steadier mate, and whatever
       the signs give off */
    this.scene.add(new THREE.AmbientLight(0x342b1e, 1.55));

    const hangBulb = (x: number, z: number, main: boolean): void => {
      const cord = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.5, 6),
        new THREE.MeshStandardMaterial({ color: 0x0d0b08, roughness: 0.9 })
      );
      cord.position.set(x, height - 0.25, z);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffe9bd })
      );
      bulb.position.set(x, height - 0.52, z);
      const light = new THREE.PointLight(0xffd9a0, main ? 9 : 6, 10, 1.6);
      light.position.set(x, height - 0.56, z);
      if (main) {
        light.castShadow = true;
        light.shadow.mapSize.set(512, 512);
        this.bulbLight = light;
        this.bulbMesh = bulb;
      }
      this.scene.add(cord, bulb, light);
    };
    hangBulb(-1.4, -0.9, true);
    hangBulb(1.8, 1.0, false);

    // the door back to the table, +Z wall — where everyone's headed anyway.
    // Its position is shared geometry now: E within DOOR_RADIUS starts the game
    const doorX = LOBBY_DOOR.x;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x0f0b06, roughness: 0.8 });
    // painted, not wood-grain: the only green surface in a room of plaster
    // and paneling, so the way out reads from anywhere
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 2.1, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x356041, roughness: 0.5 })
    );
    door.position.set(doorX, 1.05, halfD - 0.02);
    // inset panels a shade darker, slightly proud — depth the flat slab lacked
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x27452f, roughness: 0.6 });
    for (const [py, ph] of [
      [1.5, 0.8],
      [0.55, 0.8],
    ]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.62, ph, 0.03), panelMat);
      panel.position.set(doorX, py, halfD - 0.06);
      this.scene.add(panel);
    }
    // a full frame, not just a lintel — jambs make it a doorway, not wallpaper
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.19, 0.1, 0.12), frameMat);
    lintel.position.set(doorX, 2.15, halfD - 0.03);
    const jambGeo = new THREE.BoxGeometry(0.12, 2.2, 0.12);
    const jambL = new THREE.Mesh(jambGeo, frameMat);
    jambL.position.set(doorX - 0.535, 1.1, halfD - 0.03);
    const jambR = new THREE.Mesh(jambGeo, frameMat);
    jambR.position.set(doorX + 0.535, 1.1, halfD - 0.03);
    const brassDoorMat = new THREE.MeshStandardMaterial({
      color: 0xe8c469,
      metalness: 0.8,
      roughness: 0.3,
    });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), brassDoorMat);
    knob.position.set(doorX - 0.35, 1.02, halfD - 0.09);
    const kick = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.2, 0.02), brassDoorMat);
    kick.position.set(doorX, 0.14, halfD - 0.06);
    this.scene.add(door, lintel, jambL, jambR, knob, kick);

    // glowing sign over the door
    const tableSign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.28),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(512, 112, (ctx) => {
          ctx.fillStyle = "#0d1a10";
          ctx.fillRect(0, 0, 512, 112);
          ctx.font = "700 52px 'Pixelify Sans',sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.shadowColor = "#5fbf6e";
          ctx.shadowBlur = 22;
          ctx.fillStyle = "#8fe89b";
          ctx.fillText("→ TO THE TABLE", 256, 58);
        }),
      })
    );
    tableSign.position.set(doorX, 2.38, halfD - 0.04);
    tableSign.rotation.y = Math.PI;
    const doorGlow = new THREE.PointLight(0x5fbf6e, 1.6, 3.5, 2);
    doorGlow.position.set(doorX, 2.3, halfD - 0.4);
    this.scene.add(tableSign, doorGlow);

    // neon over the couch: the establishment names its clientele
    this.neonMat = new THREE.MeshBasicMaterial({
      map: canvasTexture(512, 160, (ctx) => {
        ctx.fillStyle = "#120d08";
        ctx.fillRect(0, 0, 512, 160);
        ctx.font = "700 60px 'Pixelify Sans',sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "#e0522b";
        ctx.shadowBlur = 26;
        ctx.strokeStyle = "#ff8a5e";
        ctx.lineWidth = 3;
        ctx.strokeText("THE  DEN", 256, 62);
        ctx.fillStyle = "#ffb08a";
        ctx.fillText("THE  DEN", 256, 62);
        ctx.font = "30px 'VT323',monospace";
        ctx.shadowBlur = 12;
        ctx.fillStyle = "#c9836a";
        ctx.fillText("NO SYMPATHY AFTER 9", 256, 122);
      }),
      transparent: true,
    });
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.53), this.neonMat);
    neon.position.set(-1.85, 2.05, -halfD + 0.03);
    this.neonLight = new THREE.PointLight(0xe0522b, 5, 6, 1.8);
    this.neonLight.position.set(-1.85, 1.95, -halfD + 0.7);
    this.scene.add(neon, this.neonLight);

    // crooked posters — the décor budget went to the neon
    const poster = (
      lines: [string, string],
      x: number,
      z: number,
      ry: number,
      tilt: number
    ): void => {
      const p = new THREE.Mesh(
        new THREE.PlaneGeometry(0.58, 0.78),
        new THREE.MeshStandardMaterial({
          map: canvasTexture(256, 344, (ctx) => {
            ctx.fillStyle = "#c9b98f";
            ctx.fillRect(0, 0, 256, 344);
            ctx.strokeStyle = "#6b5836";
            ctx.lineWidth = 10;
            ctx.strokeRect(8, 8, 240, 328);
            ctx.textAlign = "center";
            ctx.fillStyle = "#3a2c18";
            ctx.font = "700 36px 'Pixelify Sans',sans-serif";
            const words = lines[0].split(" ");
            words.forEach((w, i) => ctx.fillText(w, 128, 96 + i * 48));
            ctx.font = "22px 'VT323',monospace";
            // the fine print stays inside the frame — shrink to fit
            const sub = ctx.measureText(lines[1]).width;
            if (sub > 218) ctx.font = `${Math.floor((22 * 218) / sub)}px 'VT323',monospace`;
            ctx.fillStyle = "#6b5836";
            ctx.fillText(lines[1], 128, 300);
          }),
          roughness: 0.9,
        })
      );
      p.position.set(x, 1.72, z);
      p.rotation.y = ry;
      p.rotateZ(tilt);
      this.scene.add(p);
    };
    poster(["LOSERS DRINK FREE", "*nothing here is free"], halfW - 0.02, -1.4, -Math.PI / 2, 0.05);
    poster(["NO REFUNDS", "house rule no. 1 of 1"], -1.0, halfD - 0.02, Math.PI, -0.04);
    poster(["MISSING: LUCK", "reward: none"], -halfW + 0.02, 1.6, Math.PI / 2, 0.07);

    // dartboard on the -X wall, darts wherever they landed
    const board = new THREE.Group();
    const rings = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.045, 28),
      new THREE.MeshStandardMaterial({
        map: canvasTexture(256, 256, (ctx) => {
          ctx.fillStyle = "#1b150d";
          ctx.fillRect(0, 0, 256, 256);
          const cols = ["#d9c69a", "#25401f", "#7a2417", "#d9c69a", "#25401f"];
          for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            ctx.arc(128, 128, 110 - i * 22, 0, Math.PI * 2);
            ctx.fillStyle = cols[i];
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(128, 128, 9, 0, Math.PI * 2);
          ctx.fillStyle = "#e0522b";
          ctx.fill();
        }),
        roughness: 0.85,
      })
    );
    rings.rotation.z = Math.PI / 2;
    board.add(rings);
    const dartMat = new THREE.MeshStandardMaterial({ color: 0xe8c469, metalness: 0.6, roughness: 0.4 });
    for (const [dy, dz] of [
      [0.06, 0.03],
      [-0.09, -0.11],
      [0.14, -0.17], // barely on the board
    ]) {
      const dart = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.09, 6), dartMat);
      dart.rotation.z = Math.PI / 2 + 0.15;
      dart.position.set(0.05, dy, dz);
      board.add(dart);
    }
    board.position.set(-LOBBY_ROOM.halfW + 0.05, 1.62, -0.6);
    this.scene.add(board);
  }

  /* ---------------- furniture (positions == collision circles) ---------------- */
  private buildFurniture(): void {
    const wood = woodTexture();
    const woodMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.7 });
    const leather = new THREE.MeshStandardMaterial({ map: leatherTexture(), roughness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x17130d, roughness: 0.6 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xe8c469, metalness: 0.8, roughness: 0.35 });

    /* the couch (obstacles[0..1]), sagging under years of waiting */
    const couch = new THREE.Group();
    const seatL = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.3, 0.8), leather);
    seatL.position.set(-0.55, 0.32, 0);
    const seatR = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.24, 0.8), leather); // the sunk one
    seatR.position.set(0.55, 0.29, 0);
    seatR.rotation.z = -0.03;
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.72, 0.24), leather);
    back.position.set(0, 0.68, -0.38);
    back.rotation.x = -0.12;
    const armGeo = new THREE.BoxGeometry(0.24, 0.52, 0.85);
    const armL = new THREE.Mesh(armGeo, leather);
    armL.position.set(-1.22, 0.44, 0);
    const armR = new THREE.Mesh(armGeo, leather);
    armR.position.set(1.22, 0.42, 0);
    armR.rotation.z = 0.05; // loose
    couch.add(seatL, seatR, back, armL, armR);
    couch.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    couch.position.set(-1.85, 0, -2.72);
    this.scene.add(couch);

    /* coffee table (obstacles[2]) with its still life of vice */
    const coffee = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.55), woodMat);
    top.position.y = 0.4;
    top.castShadow = true;
    coffee.add(top);
    for (const [lx, lz] of [
      [-0.44, -0.21],
      [0.44, -0.21],
      [-0.44, 0.21],
      [0.44, 0.21],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.05), darkMat);
      leg.position.set(lx, 0.19, lz);
      coffee.add(leg);
    }
    const b1 = makeBottleMesh();
    b1.position.set(-0.28, 0.49, 0.1);
    const b2 = makeBottleMesh();
    b2.position.set(-0.16, 0.485, -0.12);
    b2.rotation.y = 1.7;
    const b3 = makeBottleMesh(); // the tipped one, mid-roll forever
    b3.position.set(0.13, 0.465, 0.14);
    b3.rotation.set(Math.PI / 2, 0, 2.3);
    // overflowing ashtray
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.03, 14), darkMat);
    tray.position.set(0.33, 0.44, -0.08);
    coffee.add(b1, b2, b3, tray);
    for (let i = 0; i < 4; i++) {
      const butt = makeCigarMesh(true);
      butt.scale.setScalar(0.7);
      butt.position.set(0.33 + Math.sin(i * 2.4) * 0.045, 0.457, -0.08 + Math.cos(i * 2.4) * 0.04);
      butt.rotation.set(Math.PI / 2, 0, i * 1.9);
      coffee.add(butt);
    }
    // a dead hand of cards, face up, nobody won
    for (let i = 0; i < 5; i++) {
      const card = new THREE.Mesh(
        new THREE.PlaneGeometry(0.062, 0.09),
        new THREE.MeshStandardMaterial({ color: 0xf2e8d5, roughness: 0.85 })
      );
      card.rotation.set(-Math.PI / 2, 0, i * 0.5 - 1);
      card.position.set(-0.02 + i * 0.035, 0.427, 0.02 + (i % 2) * 0.03);
      coffee.add(card);
    }
    coffee.position.set(-1.85, 0, -1.45);
    this.scene.add(coffee);

    /* two round bar tables (obstacles[3..4]) with stools */
    const barTable = (x: number, z: number): void => {
      const g = new THREE.Group();
      const tp = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 22), woodMat);
      tp.position.y = 1.0;
      tp.castShadow = true;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.98, 10), darkMat);
      stem.position.y = 0.5;
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.04, 18), darkMat);
      foot.position.y = 0.02;
      const bottle = makeBottleMesh();
      bottle.position.set(0.12, 1.09, -0.05);
      g.add(tp, stem, foot, bottle);
      g.position.set(x, 0, z);
      this.scene.add(g);
    };
    barTable(1.7, -1.5);
    barTable(2.9, 0.6);

    const stool = (x: number, z: number, tipped = false): void => {
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.07, 16), leather);
      top.position.y = 0.6;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.01, 8, 22), brass);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.57;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.08, 0.58, 10), darkMat);
      leg.position.y = 0.29;
      g.add(top, ring, leg);
      g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      if (tipped) {
        g.rotation.set(0, 0.8, Math.PI / 2 - 0.06);
        g.position.set(x, 0.2, z);
      } else {
        g.position.set(x, 0, z);
      }
      this.scene.add(g);
    };
    stool(1.15, -1.9);
    stool(2.25, -1.15);
    stool(3.3, 1.25);
    stool(2.35, 1.1, true); // lost an argument with gravity

    /* jukebox (obstacles[5]) — dead speakers, live lights */
    const juke = new THREE.Group();
    const jukeBody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.15, 0.52), woodMat);
    jukeBody.position.y = 0.575;
    jukeBody.castShadow = true;
    // arched crown: a horizontal cylinder half-sunk into the body's top
    const jukeTop = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.52, 20), woodMat);
    jukeTop.rotation.x = Math.PI / 2;
    jukeTop.position.y = 1.15;
    jukeTop.castShadow = true;
    this.jukeGlow = new THREE.MeshBasicMaterial({
      map: canvasTexture(128, 192, (ctx) => {
        const grad = ctx.createLinearGradient(0, 0, 0, 192);
        grad.addColorStop(0, "#e9a63a");
        grad.addColorStop(0.5, "#7a2417");
        grad.addColorStop(1, "#25401f");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 192);
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        for (let y = 24; y < 192; y += 24) ctx.fillRect(10, y, 108, 10);
      }),
    });
    const jukePanel = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.8), this.jukeGlow);
    jukePanel.position.set(0, 0.72, 0.262);
    const jukeArch = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.03, 8, 20, Math.PI),
      brass
    );
    jukeArch.position.set(0, 1.15, 0.262);
    juke.add(jukeBody, jukeTop, jukePanel, jukeArch);
    juke.position.set(-3.55, 0, 2.35);
    juke.rotation.y = 0.6; // angled out of its corner
    this.jukeLight = new THREE.PointLight(0xe9a63a, 2.5, 4, 2);
    this.jukeLight.position.set(-3.1, 0.9, 1.9);
    this.scene.add(juke, this.jukeLight);

    /* cigarette machine (obstacles[6]) by the door */
    const cig = new THREE.Group();
    const cigBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 1.5, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x3a1e17, roughness: 0.6, metalness: 0.2 })
    );
    cigBody.position.y = 0.75;
    cigBody.castShadow = true;
    const cigFace = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.5),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(256, 212, (ctx) => {
          ctx.fillStyle = "#1b1009";
          ctx.fillRect(0, 0, 256, 212);
          ctx.font = "700 46px 'Pixelify Sans',sans-serif";
          ctx.textAlign = "center";
          ctx.shadowColor = "#e9a63a";
          ctx.shadowBlur = 14;
          ctx.fillStyle = "#f2cf8b";
          ctx.fillText("SMOKES", 128, 62);
          ctx.font = "26px 'VT323',monospace";
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#a39a8b";
          ctx.fillText("CORRECT CHANGE", 128, 116);
          ctx.fillText("ONLY. ALWAYS.", 128, 146);
        }),
      })
    );
    cigFace.position.set(0, 1.05, 0.215);
    for (let i = 0; i < 4; i++) {
      const pull = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.07, 8), brass);
      pull.rotation.x = Math.PI / 2;
      pull.position.set(-0.24 + i * 0.16, 0.55, 0.23);
      cig.add(pull);
    }
    cig.add(cigBody, cigFace);
    cig.position.set(3.6, 0, 2.3);
    cig.rotation.y = -0.35;
    this.scene.add(cig);

    /* beer fridge (obstacles[9]) against the -X wall — the other dispenser */
    const fridge = new THREE.Group();
    const fridgeBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.66, 1.4, 0.62),
      new THREE.MeshStandardMaterial({ color: 0x27362c, roughness: 0.45, metalness: 0.35 })
    );
    fridgeBody.position.y = 0.7;
    fridgeBody.castShadow = true;
    const fridgeFace = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.62),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(212, 256, (ctx) => {
          ctx.fillStyle = "#101b14";
          ctx.fillRect(0, 0, 212, 256);
          ctx.font = "700 54px 'Pixelify Sans',sans-serif";
          ctx.textAlign = "center";
          ctx.shadowColor = "#5fbf6e";
          ctx.shadowBlur = 16;
          ctx.fillStyle = "#9fe8ab";
          ctx.fillText("BEER", 106, 92);
          ctx.font = "26px 'VT323',monospace";
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#a39a8b";
          ctx.fillText("COLD-ISH.", 106, 158);
          ctx.fillText("HELP YOURSELF.", 106, 190);
        }),
      })
    );
    fridgeFace.rotation.y = Math.PI / 2;
    fridgeFace.position.set(0.34, 0.95, 0);
    const fridgeHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.5, 8),
      brass
    );
    fridgeHandle.position.set(0.36, 0.62, -0.22);
    fridge.add(fridgeBody, fridgeFace, fridgeHandle);
    fridge.position.set(-3.75, 0, 0);
    this.scene.add(fridge);
    const fridgeGlow = new THREE.PointLight(0x5fbf6e, 1.2, 2.6, 2);
    fridgeGlow.position.set(-3.2, 1.1, 0);
    this.scene.add(fridgeGlow);

    /* dead plant (obstacles[7]) and the standing ashtray (obstacles[8]) */
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.26, 12), darkMat);
    pot.position.set(-3.75, 0.13, -2.7);
    this.scene.add(pot);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x4a3d22, roughness: 0.95 });
    for (let i = 0; i < 5; i++) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, 0.55, 5), stemMat);
      stem.position.set(-3.75 + Math.sin(i * 1.3) * 0.06, 0.5, -2.7 + Math.cos(i * 1.3) * 0.06);
      stem.rotation.set(Math.sin(i * 2.1) * 0.7, 0, 0.4 + Math.cos(i) * 0.35); // drooping
      this.scene.add(stem);
    }
    const ashPole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.75, 8), brass);
    ashPole.position.set(0.62, 0.375, -2.9);
    const ashBowl = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.07, 0.06, 12), darkMat);
    ashBowl.position.set(0.62, 0.76, -2.9);
    this.scene.add(ashPole, ashBowl);
  }

  /* the floor is part of the décor — but only the paper is décor now. The
     scattered bottles and butts (and the plunger and cue sticks) are real
     debris the sim seeds from the same LOBBY_SCATTER list, arriving through
     snapshots like any flung empty, so they can be picked up and thrown. */
  private buildTrash(): void {
    const paperMat = new THREE.MeshStandardMaterial({
      color: 0xcfc3a4,
      roughness: 0.95,
      flatShading: true,
    });
    for (const s of LOBBY_SCATTER) {
      if (s.kind !== "paper") continue;
      const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), paperMat);
      p.scale.y = 0.7;
      p.position.set(s.x, 0.03, s.z);
      p.rotation.y = s.roll;
      this.scene.add(p);
    }
  }

  /* ---------------- avatars ---------------- */
  private makeLobbyAvatar(p: PlayerSnap): LobbyAvatar {
    const colors = [0x4a3b2a, 0x2c3c60, 0x6a1f1f, 0x24512f, 0x3a3226];
    const { group, legs, armR, armL } = makeFigure(colors[p.seat % colors.length], 0x8a7560, {
      standing: true,
    });
    // arms hang at the sides — the default rest reaches for a felt that
    // isn't here
    poseArm(armR, new THREE.Vector3(0.21, 0.58, 0.06));
    poseArm(armL, new THREE.Vector3(-0.21, 0.58, 0.06));
    group.add(nameSprite(p.name));
    group.position.set(p.pos.x, p.pos.y, p.pos.z);
    group.rotation.y = p.moveYaw;
    this.scene.add(group);
    return {
      group,
      legs: legs!,
      targetPos: new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z),
      targetYaw: p.moveYaw,
      moving: p.moving,
      walkPhase: 0,
      baseY: p.pos.y,
    };
  }

  /* ---------------- lifecycle ---------------- */
  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    this.keys.clear();
    if (on) {
      // straight into free look: the click that joined the table is
      // recent enough to count as the gesture the lock API wants
      this.captureLook();
    } else {
      this.looking = false;
      this.dispenseHint?.classList.remove("show");
      // the lock itself survives: the walk from the waiting room to the
      // table keeps free look seamless (both rooms share the canvas).
      // Session teardown exits it explicitly in main.ts.
      if (this.domElement) this.domElement.style.cursor = "";
    }
    this.syncLockUi();
  }

  /* forget the session: sweep the other players and the litter, drop any
     held empty, and unlearn my position so the next join starts clean from
     the server's spawn instead of correcting away from a stale one */
  reset(): void {
    for (const av of this.avatars.values()) this.scene.remove(av.group);
    this.avatars.clear();
    this.debris.apply([]);
    this.held.reset();
    this.latest = null;
    this.myId = "";
    this.posInit = false;
    this.yaw = 0;
    this.pitch = 0;
    this.keys.clear();
  }

  apply(snap: Snapshot, myId: string): void {
    this.latest = snap;
    this.myId = myId;
    this.debris.apply(snap.debris.filter((d) => d.room === "lobby"));
    this.held.apply(snap.players.find((p) => p.id === myId));

    for (const p of snap.players) {
      if (p.id === myId) {
        if (!this.posInit) {
          this.myPos.set(p.pos.x, p.pos.y, p.pos.z);
          this.motion.vy = 0;
          this.motion.grounded = true;
          this.yaw = p.moveYaw;
          this.posInit = true;
          this.correction.set(0, 0, 0);
        } else {
          // authoritative minus predicted: fold in gently, snap if wild.
          // Height only reconciles on the ground — mid-jump the server's
          // arc lags ours by the wire, and tugging y would soften every hop
          this.correction.set(
            p.pos.x - this.myPos.x,
            this.motion.grounded ? p.pos.y - this.myPos.y : 0,
            p.pos.z - this.myPos.z
          );
          if (this.correction.length() > 1.2) {
            this.myPos.set(p.pos.x, p.pos.y, p.pos.z);
            this.motion.vy = 0;
            this.correction.set(0, 0, 0);
          }
        }
        continue;
      }
      let av = this.avatars.get(p.id);
      if (!av) {
        av = this.makeLobbyAvatar(p);
        this.avatars.set(p.id, av);
      }
      av.targetPos.set(p.pos.x, p.pos.y, p.pos.z);
      av.targetYaw = p.moveYaw;
      av.moving = p.moving;
    }
    for (const [id, av] of this.avatars)
      if (!snap.players.some((p) => p.id === id) || id === myId) {
        this.scene.remove(av.group);
        this.avatars.delete(id);
      }
  }

  /* ---------------- input (routed from SceneView while active) ----------------
     same priority the table uses: grab the held empty > pick up litter >
     drag to look */
  pointerDown(e: PointerEvent): void {
    if (e.pointerType === "mouse") this.captureLook(); // no-op once locked
    const ndc = this.locked ? CENTER : this.ndc(e);
    if (this.held.pointerDown(ndc)) {
      this.beginVirtualCursor(e);
      return;
    }
    const target = this.findDebrisAt(ndc);
    if (target) {
      if (this.held.hasHeld) {
        this.held.flashDeny();
        denySound();
        return;
      }
      this.send({ type: "pickup", itemId: target.id });
      this.held.beginFloorGrab(target.kind, target.pos);
      this.beginVirtualCursor(e);
      return;
    }
    if (this.locked && this.held.grabHeld()) {
      // locked, holding, crosshair on nothing: the click means the empty
      // in your hand — the wind-up starts from the center
      this.beginVirtualCursor(e);
      return;
    }
    this.looking = true; // drag fallback: touch, or the lock was refused
    this.lastPointer = { x: e.clientX, y: e.clientY };
  }
  pointerMove(e: PointerEvent): void {
    if (this.held.isGrabbing) {
      if (this.locked) {
        const [dx, dy] = this.lookDelta(e);
        this.virt.x = Math.max(0, Math.min(innerWidth, this.virt.x + dx));
        this.virt.y = Math.max(0, Math.min(innerHeight, this.virt.y + dy));
        this.held.pointerMove(
          new THREE.Vector2((this.virt.x / innerWidth) * 2 - 1, -(this.virt.y / innerHeight) * 2 + 1)
        );
      } else {
        this.held.pointerMove(this.ndc(e));
      }
      return;
    }
    if (this.locked) {
      // free look: the gaze follows the mouse, no button held. Standard
      // FPS signs (mouse down = look down), unlike the drag path below.
      // Eased back in after a fling so the whip's tail doesn't jerk the view.
      const [dx, dy] = this.lookDelta(e);
      const ease = this.held.lookEase(performance.now());
      this.yaw = wrapAngle(this.yaw - dx * LOOK_SENS * ease);
      this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch - dy * LOOK_SENS * ease));
      return; // crosshair hover refreshes per frame, where walking counts too
    }
    if (!this.looking) {
      this.updateHover(this.ndc(e));
      return;
    }
    this.yaw = wrapAngle(this.yaw - (e.clientX - this.lastPointer.x) * 0.003);
    this.pitch = Math.max(
      PITCH_MIN,
      Math.min(PITCH_MAX, this.pitch + (e.clientY - this.lastPointer.y) * 0.003)
    );
    this.lastPointer = { x: e.clientX, y: e.clientY };
  }
  pointerUp(): void {
    if (this.held.isGrabbing) this.held.pointerUp();
    this.looking = false;
  }

  private ndc(e: PointerEvent): THREE.Vector2 {
    return new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  }

  /* the wind-up drag's hand starts where the grab happened: the crosshair
     when locked (the cursor is gone), the cursor otherwise */
  private beginVirtualCursor(e: PointerEvent): void {
    this.virt.x = this.locked ? innerWidth / 2 : e.clientX;
    this.virt.y = this.locked ? innerHeight / 2 : e.clientY;
    this.lastPointer = { x: e.clientX, y: e.clientY };
  }

  /* mouse travel while locked, summed across coalesced events. Real locks
     freeze clientX/Y and report movementX/Y; synthetic pointers (headless
     runs) do the opposite, so zero movement falls back to position deltas. */
  private lookDelta(e: PointerEvent): [number, number] {
    let dx = 0;
    let dy = 0;
    const evs = e.getCoalescedEvents?.() ?? [];
    for (const ev of evs.length ? evs : [e]) {
      dx += ev.movementX;
      dy += ev.movementY;
    }
    if (dx === 0 && dy === 0) {
      dx = e.clientX - this.lastPointer.x;
      dy = e.clientY - this.lastPointer.y;
    }
    this.lastPointer = { x: e.clientX, y: e.clientY };
    return [dx, dy];
  }

  /* what grabbable litter is under the pointer — instance hit first, then
     the fat-pick fallback, both bounded by walking-reach from the eye */
  private findDebrisAt(
    ndc: THREE.Vector2
  ): { id: number; kind: PropKind; pos: THREE.Vector3 } | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.debris.pickables, false);
    for (const h of hits) {
      if (h.instanceId === undefined) continue;
      const id = this.debris.debrisIdFor(h.object, h.instanceId);
      if (id === null) continue;
      const info = this.debris.info(id);
      if (!info) continue;
      if (info.pos.distanceTo(this.camera.position) > LOBBY_REACH) continue;
      return { id, kind: info.kind, pos: info.pos };
    }
    const near = this.debris.nearestToRay(this.raycaster.ray, 0.25);
    if (near && near.pos.distanceTo(this.camera.position) <= LOBBY_REACH) return near;
    return null;
  }

  private updateHover(ndc: THREE.Vector2): void {
    const target = this.findDebrisAt(ndc);
    const denied = !!target && this.held.hasHeld;
    this.debris.setHighlight(denied ? null : (target?.id ?? null));
    if (this.locked) {
      // no cursor to shape: the crosshair does the talking
      this.crosshairEl?.classList.toggle("grab", !!target && !denied);
      this.crosshairEl?.classList.toggle("deny", denied);
    } else if (this.domElement) {
      this.domElement.style.cursor = denied ? "not-allowed" : target ? "grab" : "";
    }
  }

  /* ---------------- dispensers ---------------- */
  private nearDispenser(): { kind: ViceKind; x: number; z: number } | null {
    if (!this.posInit) return null;
    return (
      LOBBY_DISPENSERS.find(
        (d) => Math.hypot(this.myPos.x - d.x, this.myPos.z - d.z) <= DISPENSE_RADIUS
      ) ?? null
    );
  }

  private nearDoor(): boolean {
    return (
      this.posInit &&
      Math.hypot(this.myPos.x - LOBBY_DOOR.x, this.myPos.z - LOBBY_DOOR.z) <= DOOR_RADIUS
    );
  }

  /* the door IS the start button: the leader stands at it and presses E;
     anyone else knocking gets the deny buzz (the hint says why) */
  private tryStartAtDoor(): void {
    if (this.latest?.leaderId === this.myId) this.send({ type: "startGame" });
    else denySound();
  }

  /* predict the hop immediately; the sim keeps its own grounded record, so
     the intent is a request, not a command */
  private tryJump(): void {
    if (this.motion.grounded) {
      this.motion.vy = LOBBY_JUMP_SPEED;
      this.motion.grounded = false;
    }
    this.send({ type: "jump" });
  }

  private tryDispense(): void {
    const d = this.nearDispenser();
    if (!d) return;
    if (this.held.hasHeld) {
      this.held.flashDeny();
      denySound();
      return;
    }
    this.send({ type: "dispense", kind: d.kind });
    pickupSound();
  }

  private updateDispenseHint(): void {
    const el = this.dispenseHint;
    if (!el) return;
    if (this.nearDoor()) {
      el.textContent =
        this.latest?.leaderId === this.myId
          ? "PRESS E — START THE GAME"
          : "THE LEADER OPENS THIS DOOR";
      el.classList.add("show");
      return;
    }
    const d = this.nearDispenser();
    if (!d) {
      el.classList.remove("show");
      return;
    }
    el.textContent = this.held.hasHeld
      ? "HANDS FULL — PRESS F TO FLING IT"
      : d.kind === "beer"
        ? "PRESS E — GRAB A BEER"
        : "PRESS E — GRAB A SMOKE";
    el.classList.add("show");
  }

  /* ---------------- frame ---------------- */
  frame(dt: number, now: number): void {
    // my movement: keys → world direction (relative to camera yaw)
    let fwd = 0;
    let side = 0;
    for (const code of this.keys) {
      const d = KEY_DIRS[code];
      if (d) {
        fwd += d[0];
        side += d[1];
      }
    }
    fwd = Math.sign(fwd);
    side = Math.sign(side);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // facing = (sin yaw, cos yaw); right when facing +Z is -X
    let dirX = sy * fwd - cy * side;
    let dirZ = cy * fwd + sy * side;
    const len = Math.hypot(dirX, dirZ);
    if (len > 1e-6) {
      dirX /= len;
      dirZ /= len;
    } else {
      dirX = 0;
      dirZ = 0;
    }

    if (this.posInit) {
      // prediction: exactly the sim's step, at render rate — every frame,
      // gravity and landings don't wait for key input
      stepLobbyMove(this.motion, dirX, dirZ, dt);
      // fold in the server's opinion of where I am
      if (this.correction.lengthSq() > 1e-8) {
        const k = Math.min(1, dt * 4);
        this.myPos.addScaledVector(this.correction, k);
        this.correction.multiplyScalar(1 - k);
      }
      const eyeY = this.myPos.y + LOBBY_EYE_HEIGHT;
      this.camera.position.set(this.myPos.x, eyeY, this.myPos.z);
      const cp = Math.cos(this.pitch);
      this.camera.lookAt(
        this.myPos.x + sy * cp,
        eyeY + Math.sin(this.pitch),
        this.myPos.z + cy * cp
      );

      // tell the sim about held input: direction changes go out immediately,
      // facing drift goes out on a slow beat
      const dirChanged =
        Math.abs(dirX - this.lastSentDir.x) > 1e-3 || Math.abs(dirZ - this.lastSentDir.z) > 1e-3;
      const yawChanged = Math.abs(wrapAngle(this.yaw - this.lastSentYaw)) > 0.05;
      if (this.active && (dirChanged || (yawChanged && now - this.lastMoveSent > 150))) {
        this.lastSentDir = { x: dirX, z: dirZ };
        this.lastSentYaw = this.yaw;
        this.lastMoveSent = now;
        this.send({
          type: "move",
          dirX: Math.round(dirX * 1000) / 1000,
          dirZ: Math.round(dirZ * 1000) / 1000,
          yaw: Math.round(this.yaw * 100) / 100,
        });
      }
    }

    // everyone else: ease toward authority, swing the legs while moving
    const k = Math.min(1, dt * 12);
    for (const av of this.avatars.values()) {
      av.group.position.x += (av.targetPos.x - av.group.position.x) * k;
      av.group.position.z += (av.targetPos.z - av.group.position.z) * k;
      // jumps read as jumps: track height faster than the x/z stroll-ease
      av.baseY += (av.targetPos.y - av.baseY) * Math.min(1, dt * 20);
      av.group.rotation.y += wrapAngle(av.targetYaw - av.group.rotation.y) * k;
      const strideTarget = av.moving ? 1 : 0;
      if (av.moving) av.walkPhase += dt * WALK_ANIM_HZ;
      const swing = Math.sin(av.walkPhase * Math.PI) * 0.55;
      const damp = Math.min(1, dt * 8);
      av.legs[0].rotation.x += (swing * strideTarget - av.legs[0].rotation.x) * damp;
      av.legs[1].rotation.x += (-swing * strideTarget - av.legs[1].rotation.x) * damp;
      av.group.position.y =
        av.baseY + (av.moving ? Math.abs(Math.sin(av.walkPhase * Math.PI)) * 0.03 : 0);
    }

    // litter in motion, and the empty in my hand
    this.debris.frame(dt);
    this.held.frame(dt);
    // stream the wind-up drag (~10 Hz) — same contract the table uses
    const gp = this.held.grabWorldPos();
    if (gp) {
      this.wasGrabbing = true;
      if (now - this.lastHeldSent > 100) {
        this.lastHeldSent = now;
        this.send({ type: "heldMove", pos: { x: gp.x, y: gp.y, z: gp.z } });
      }
    } else if (this.wasGrabbing) {
      this.wasGrabbing = false;
      if (this.held.hasHeld) this.send({ type: "heldMove", pos: null });
    }
    if (this.active) this.updateDispenseHint();
    // under lock the pick ray is the gaze: walking alone changes what the
    // crosshair is over, so hover tracks per frame, not per pointer event
    if (this.active && this.locked && !this.held.isGrabbing) this.updateHover(CENTER);

    // ambient life: the bulb has moods, the neon buzzes, the jukebox breathes
    if (now > this.bulbDropUntil && Math.random() < 0.004) this.bulbDropUntil = now + 90;
    const dropped = now < this.bulbDropUntil;
    this.bulbLight.intensity = dropped ? 2.2 : 9 * (0.96 + 0.04 * Math.sin(now * 0.013));
    (this.bulbMesh.material as THREE.MeshBasicMaterial).color.setHex(
      dropped ? 0x8a6f4a : 0xffe9bd
    );
    this.neonLight.intensity = 5 * (0.9 + 0.1 * Math.sin(now * 0.021) * Math.sin(now * 0.0043));
    this.neonMat.opacity = 0.9 + 0.1 * Math.sin(now * 0.017);
    this.jukeLight.color.setHSL(0.08 + 0.05 * Math.sin(now * 0.0006), 0.8, 0.55);
    this.jukeLight.intensity = 2.2 + 0.5 * Math.sin(now * 0.0011);
  }

  /* my current look yaw — used by SceneView if anything needs it */
  get lookYaw(): number {
    return this.yaw;
  }
}

/* [forward, sideRight] contribution per key */
const KEY_DIRS: Record<string, [number, number] | undefined> = {
  KeyW: [1, 0],
  ArrowUp: [1, 0],
  KeyS: [-1, 0],
  ArrowDown: [-1, 0],
  KeyA: [0, -1],
  ArrowLeft: [0, -1],
  KeyD: [0, 1],
  ArrowRight: [0, 1],
};
