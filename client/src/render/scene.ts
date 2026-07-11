/* The 3D den: table, seats, avatars, cards, chips, debris — plus the
   per-seat camera and pointer routing (grab > pickup > look). Everything
   here renders snapshots; nothing here mutates game state. */
import * as THREE from "three";
import {
  TABLE,
  DEN_ROOM,
  SEAT_COUNT,
  DEALER_POS,
  REACH_RADIUS,
  LOOK_YAW_LIMIT,
  LOOK_PITCH_MIN,
  LOOK_PITCH_MAX,
  CARD_LIFT,
  HAND_ANCHOR_R,
  PLAYER_CARD_SCALE,
  PLAYER_CARD_LEAN,
  DEALER_CARD_SCALE,
  DEALER_CARD_LEAN,
  DEALER_HAND_Z,
  seatAngle,
  seatPosition,
  seatEye,
  seatTablePoint,
} from "@shared/constants";
import type { Intent, PlayerSnap, Snapshot } from "@shared/types";
import type { ViceKind } from "@shared/types";
import { handValue } from "@shared/blackjack";
import {
  feltTexture,
  woodTexture,
  carpetTexture,
  leatherTexture,
  plasterTexture,
  floorboardTexture,
  ceilingTexture,
} from "./textures";
import { makeFigure, poseArm, type ArmRig } from "./figure";
import { LobbyRoomView } from "./lobbyRoom";
import { CardZone } from "./cards";
import { DebrisView } from "./debris";
import { HeldItemControl, makeBottleMesh, makeCigarMesh } from "./held";
import {
  SmokeSystem,
  CashBurst,
  PointsBurst,
  OuchBubbles,
  impactSound,
  dealSound,
  denySound,
  cashSound,
  pointsSound,
  whooshSound,
  chipRiffleSound,
  hurtSound,
} from "./effects";
import { updateTweens, tween, easeInOut } from "./tween";

const CENTER = new THREE.Vector3(0, TABLE.height + 0.05, 0);
const SHOE_POS = new THREE.Vector3(0.72, TABLE.height + 0.09, -0.78);

const BASE_FOV = 62;
/* player figures only (the dealer looms full-size): smaller silhouettes make
   a direct bottle hit a skill shot. The sim's PLAYER_HIT_* capsule constants
   are derived from this — keep them in sync. */
const AVATAR_SCALE = 0.88;
/* world-space head/chest anchors of a scaled figure (group sits at y 0.28) */
const AVATAR_HEAD_Y = 0.28 + 1.26 * AVATAR_SCALE;
const AVATAR_CHEST_Y = 0.28 + 0.85 * AVATAR_SCALE;

/* another player's presence at the table: their figure, the head that
   tracks where they're looking, and whatever vice is in their hand */
interface AvatarView {
  seat: number;
  group: THREE.Group;
  head: THREE.Group;
  armR: ArmRig;
  armL: ArmRig;
  /* the vice in their hand; pose eases toward propPosT/propQuatT each frame
     so raises, tips, and lowers read as motion instead of teleports */
  prop: THREE.Group | null;
  propKey: string | null; // "ritual:beer" | "held:cigar" | …
  propDying: boolean; // easing back to the hand, retired on arrival
  propPosT: THREE.Vector3;
  propQuatT: THREE.Quaternion;
  /* the other hand's lighter, out only during a cigar ritual */
  lighter: THREE.Group | null;
  flame: THREE.Mesh | null;
  lighterDying: boolean;
  lighterPosT: THREE.Vector3;
  lastProgress: number;
  targetYaw: number;
  targetPitch: number;
  /* follow-through after a fling: the arm whips toward this point (avatar-
     local) until throwUntil, then drifts home */
  throwUntil: number;
  throwTarget: THREE.Vector3;
}

/* where props rest / rise from: the figure's hand spheres */
const HAND_R = new THREE.Vector3(0.15, 0.86, 0.33);
const HAND_L = new THREE.Vector3(-0.15, 0.86, 0.33);

const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3(0, 0, 0);
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _grip = new THREE.Vector3();
const _from = new THREE.Vector3();
const _cand = new THREE.Vector3();
const _best = new THREE.Vector3();

/* eye-contact magnetism: a reported gaze ray passing within this cone of
   someone's head locks onto it exactly (aiming through a HUD-cluttered,
   wide-FOV viewport is ~10-15° imprecise — social reads shouldn't be) */
const GAZE_SNAP = 0.3;

/* how far a rendered head may actually turn — the camera's LOOK_YAW_LIMIT
   reaches ~150° but a neck showing that snaps bones */
const HEAD_YAW_SHOWN_MAX = 1.5;

/* The exact ray a player's camera looks along, given their seat and look
   offsets: from the seat's eye toward the table center, yawed about
   world-up, then pitched about the right axis. The local camera and every
   remote avatar head use THIS same function — that shared math is what
   makes eye contact land where the looker actually aimed. */
function lookDir(seat: number, yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const eye = seatEye(seat);
  out.set(CENTER.x - eye.x, CENTER.y - eye.y, CENTER.z - eye.z).normalize();
  out.applyQuaternion(_q.setFromAxisAngle(UP, yaw));
  _right.crossVectors(out, UP).normalize();
  out.applyQuaternion(_q.setFromAxisAngle(_right, pitch));
  return out;
}

export class SceneView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private dealerZone: CardZone;
  private playerZones = new Map<string, CardZone>();
  private chipStacks = new Map<string, { group: THREE.Group; bet: number }>();
  private avatars = new Map<number, AvatarView>();
  private debrisView: DebrisView;
  private smoke: SmokeSystem;
  private cash: CashBurst;
  private points: PointsBurst;
  private ouch: OuchBubbles;
  /* last known seat per player id — needed to clear a departed player's
     avatar/chips after they vanish from snapshots */
  private lastSeat = new Map<string, number>();
  held: HeldItemControl;
  private raycaster = new THREE.Raycaster();

  private ritualGhost: THREE.Group | null = null;
  private ritualGhostKind: ViceKind | null = null;
  private ritualRay = new THREE.Raycaster();
  private mySeat = 2;
  private eyePos = new THREE.Vector3();
  private shakeLeft = 0; // seconds of camera shake remaining
  private shakeAmp = 0;
  private yawOff = 0;
  private pitchOff = 0;
  private looking = false;
  private lookDirty = false;
  private lastLookSent = 0;
  private lastHeldSent = 0;
  private wasGrabbing = false;
  private lastPointer = { x: 0, y: 0 };
  private lastFrame = performance.now();
  private latest: Snapshot | null = null;
  private myId = "";
  /* which scene the renderer shows: the table, or the waiting room the sim
     calls the "lobby" phase */
  private mode: "table" | "lobby" = "table";
  readonly lobbyRoom: LobbyRoomView;
  /* ambient life in the den: the wall neon buzzes, its light breathes */
  private neonMat!: THREE.MeshBasicMaterial;
  private neonLight!: THREE.PointLight;
  /* the hanging lamp's parts, so the title screen can make its wiring act up */
  private tableSpot!: THREE.SpotLight;
  private lampBulbMat!: THREE.MeshBasicMaterial;
  private lampInnerMat!: THREE.MeshBasicMaterial;
  private lampHazeMat!: THREE.MeshBasicMaterial;
  private titleScreenEl = document.getElementById("titleScreen")!;

  constructor(container: HTMLElement, private send: (intent: Intent) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.05, 60);
    this.setCameraSeat(2);

    this.scene.background = new THREE.Color(0x0d0b08);
    // the room is small now — fog just murks up the far corners
    this.scene.fog = new THREE.Fog(0x0d0b08, 5, 14);

    this.buildLights();
    this.buildRoom();
    this.buildTable();
    this.buildDealer();

    this.smoke = new SmokeSystem(this.scene);
    this.cash = new CashBurst(this.scene);
    this.points = new PointsBurst(this.scene);
    this.ouch = new OuchBubbles(this.scene);
    this.debrisView = new DebrisView(this.scene);
    this.held = new HeldItemControl(this.scene, this.camera, send);
    this.dealerZone = new CardZone(
      this.scene,
      new THREE.Vector3(0, TABLE.height + CARD_LIFT, DEALER_HAND_Z),
      0,
      SHOE_POS,
      dealSound,
      // propped toward the players, sized for distance; the total pill sits
      // on the felt in front of the cards, not over the dealer's face
      {
        scale: DEALER_CARD_SCALE,
        lean: DEALER_CARD_LEAN,
        badgeOffset: { x: 0, y: 0.03, z: 0.3 },
      }
    );

    this.lobbyRoom = new LobbyRoomView(send);
    this.lobbyRoom.domElement = this.renderer.domElement; // for hover cursors

    addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.lobbyRoom.camera.aspect = innerWidth / innerHeight;
      this.lobbyRoom.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    this.bindPointer();
    requestAnimationFrame(() => this.frame());
  }

  /* ---------------- static world ---------------- */
  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0x342b1e, 1.6));
    // gentle top-down lift so the walls read as walls, not void
    this.scene.add(new THREE.HemisphereLight(0x564a33, 0x120d08, 1.0));
    // the spot hangs from the lamp over the table; high penumbra melts the
    // pool's edge into the ambient murk instead of stamping a hard circle
    const spot = new THREE.SpotLight(0xffdca8, 70, 12, Math.PI / 3.1, 0.8, 1.5);
    spot.position.set(0, 2.65, 0);
    spot.target.position.set(0, TABLE.height, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    this.scene.add(spot, spot.target);
    this.tableSpot = spot;
    // the wall neon's glow — flickered alongside its sign in frame()
    this.neonLight = new THREE.PointLight(0xe0522b, 6, 7, 2);
    this.neonLight.position.set(-3.5, 2.0, -1.6);
    this.scene.add(this.neonLight);

    // warm den glow hung over the seat ring: the other degenerates are
    // meant to be SEEN — the fog still swallows the room beyond the table
    const ring = new THREE.PointLight(0xffd9a0, 9, 7.5, 1.8);
    ring.position.set(0, 2.35, 0.5);
    this.scene.add(ring);

    // camera-attached fill so held items / ritual ghosts aren't silhouettes
    this.scene.add(this.camera);
    const fill = new THREE.PointLight(0xffe6c0, 0.9, 2.2, 2);
    fill.position.set(0.1, 0.15, 0.1);
    this.camera.add(fill);

    // the hanging lamp itself: cord, brass-trimmed shade, glowing bulb
    const lamp = new THREE.Group();
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, DEN_ROOM.height - 2.78, 6),
      new THREE.MeshStandardMaterial({ color: 0x0d0b08, roughness: 0.9 })
    );
    cord.position.y = (DEN_ROOM.height + 2.78) / 2; // shade top to the ceiling
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.42, 0.3, 24, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x1e3a28,
        roughness: 0.5,
        metalness: 0.3,
        side: THREE.DoubleSide,
      })
    );
    shade.position.y = 2.78;
    this.lampInnerMat = new THREE.MeshBasicMaterial({ color: 0xffe2ae, side: THREE.BackSide });
    const shadeInner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.088, 0.41, 0.29, 24, 1, true),
      this.lampInnerMat
    );
    shadeInner.position.y = 2.78;
    const trim = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.014, 8, 28),
      new THREE.MeshStandardMaterial({ color: 0xe8c469, metalness: 0.8, roughness: 0.3 })
    );
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 2.63;
    this.lampBulbMat = new THREE.MeshBasicMaterial({ color: 0xfff2cf });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), this.lampBulbMat);
    bulb.position.y = 2.72;
    lamp.add(cord, shade, shadeInner, trim, bulb);
    this.scene.add(lamp);

    // smoke hanging in the lamplight: a faint additive cone under the shade,
    // faded out along its length so it dissolves above the felt instead of
    // ending in a hard glowing edge sliced off by the tabletop
    const hazeCv = document.createElement("canvas");
    hazeCv.width = 1;
    hazeCv.height = 64;
    const hazeCtx = hazeCv.getContext("2d")!;
    const hazeGrad = hazeCtx.createLinearGradient(0, 0, 0, 64);
    hazeGrad.addColorStop(0, "#ffdca8"); // apex, right under the shade
    hazeGrad.addColorStop(0.7, "#40361f");
    hazeGrad.addColorStop(1, "#000000"); // additive black = fully gone
    hazeCtx.fillStyle = hazeGrad;
    hazeCtx.fillRect(0, 0, 1, 64);
    const hazeTex = new THREE.CanvasTexture(hazeCv);
    this.lampHazeMat = new THREE.MeshBasicMaterial({
      map: hazeTex,
      transparent: true,
      opacity: 0.055,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    const haze = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.9, 24, 1, true), this.lampHazeMat);
    haze.position.y = 2.6 - 0.95;
    this.scene.add(haze);
  }

  /* the den itself: a small dingy back room — floorboards under a tired
     rug, stained plaster over wood wainscot, a boarded-up door (the felt
     says NO EXITS and it means it), wall neon, and the kind of clutter a
     room like this accretes. Matches DEN_ROOM, which physics.ts also reads:
     the walls you see are the walls the bottles bounce off. */
  private buildRoom(): void {
    const { halfW, halfD, height, centerZ } = DEN_ROOM;
    const zBack = centerZ - halfD; // behind the dealer
    const zFront = centerZ + halfD; // behind the players

    // floorboards under everything, the old rug under the table
    const boards = floorboardTexture();
    boards.repeat.set(4, 4);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(halfW * 2, halfD * 2),
      new THREE.MeshStandardMaterial({ map: boards, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, centerZ);
    floor.receiveShadow = true;

    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(3.3, 48),
      new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 0.97 })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.006;
    rug.receiveShadow = true;

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(halfW * 2, halfD * 2),
      new THREE.MeshStandardMaterial({ map: ceilingTexture(), roughness: 1 })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, height, centerZ);
    this.scene.add(floor, rug, ceiling);

    // walls: grimy plaster above wood wainscot, rail and baseboard between
    const plaster = plasterTexture();
    plaster.repeat.set(3, 1); // y=1: the grime gradient spans floor→ceiling
    const plasterMat = new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.95 });
    const wainWood = woodTexture();
    wainWood.repeat.set(5, 1);
    const wainMat = new THREE.MeshStandardMaterial({
      map: wainWood,
      color: 0xb8a88f, // knocked back: paneling in shadow, not fresh varnish
      roughness: 0.8,
    });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x1c150c, roughness: 0.85 });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x120e08, roughness: 0.9 });
    const WAIN_H = 0.95;
    const wallSpecs: { w: number; x: number; z: number; ry: number }[] = [
      { w: halfW * 2, x: 0, z: zBack, ry: 0 },
      { w: halfW * 2, x: 0, z: zFront, ry: Math.PI },
      { w: halfD * 2, x: -halfW, z: centerZ, ry: Math.PI / 2 },
      { w: halfD * 2, x: halfW, z: centerZ, ry: -Math.PI / 2 },
    ];
    for (const s of wallSpecs) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(s.w, height), plasterMat);
      wall.position.set(s.x, height / 2, s.z);
      wall.rotation.y = s.ry;
      wall.receiveShadow = true;
      const wain = new THREE.Mesh(new THREE.PlaneGeometry(s.w, WAIN_H), wainMat);
      wain.position.set(s.x, WAIN_H / 2, s.z);
      wain.rotation.y = s.ry;
      wain.translateZ(0.012);
      wain.receiveShadow = true;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(s.w, 0.045, 0.035), railMat);
      rail.position.set(s.x, WAIN_H + 0.02, s.z);
      rail.rotation.y = s.ry;
      rail.translateZ(0.024);
      const base = new THREE.Mesh(new THREE.PlaneGeometry(s.w, 0.12), baseMat);
      base.position.set(s.x, 0.06, s.z);
      base.rotation.y = s.ry;
      base.translateZ(0.02);
      this.scene.add(wall, wain, rail, base);
    }

    // shared prop materials
    const wood = woodTexture();
    const woodMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.75 });
    const oldWoodMat = new THREE.MeshStandardMaterial({
      map: woodTexture(),
      color: 0x9a8a72,
      roughness: 0.9,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c150c, roughness: 0.8 });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xe8c469,
      metalness: 0.8,
      roughness: 0.35,
    });

    /* the door out, boarded shut — the game ends when the game says so */
    const doorX = -1.9;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.05, 0.07), woodMat);
    door.position.set(doorX, 1.025, zBack + 0.05);
    for (const side of [-0.52, 0.52]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.2, 0.11), frameMat);
      jamb.position.set(doorX + side, 1.1, zBack + 0.05);
      this.scene.add(jamb);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.13, 0.09, 0.11), frameMat);
    lintel.position.set(doorX, 2.16, zBack + 0.05);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), brassMat);
    knob.position.set(doorX + 0.35, 1.0, zBack + 0.11);
    this.scene.add(door, lintel, knob);
    for (const [by, tilt] of [
      [1.42, 0.24],
      [0.78, -0.31],
    ]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.14, 0.03), oldWoodMat);
      board.position.set(doorX, by, zBack + 0.1);
      board.rotation.z = tilt;
      board.castShadow = true;
      this.scene.add(board);
    }

    /* back bar behind the dealer: a low cabinet, its bottles, a sconce */
    const cabinet = new THREE.Group();
    const cabBody = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.92, 0.42), woodMat);
    cabBody.position.y = 0.46;
    cabBody.castShadow = true;
    const cabTop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.48), frameMat);
    cabTop.position.y = 0.945;
    for (const px of [-0.36, 0.36]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.62), oldWoodMat);
      panel.position.set(px, 0.48, 0.212);
      cabinet.add(panel);
      const pull = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), brassMat);
      pull.position.set(px + (px < 0 ? 0.2 : -0.2), 0.5, 0.22);
      cabinet.add(pull);
    }
    cabinet.add(cabBody, cabTop);
    cabinet.position.set(1.9, 0, zBack + 0.24);
    this.scene.add(cabinet);
    this.scatterBottles(
      [
        [1.62, 0.97, zBack + 0.2, false],
        [1.78, 0.97, zBack + 0.3, false],
        [2.02, 0.97, zBack + 0.22, false],
        [2.24, 0.97, zBack + 0.28, false],
        [2.38, 0.99, zBack + 0.24, true], // the one nobody stood back up
      ]
    );
    this.sconce(1.9, 2.3, zBack + 0.035, 0, 3);
    this.sconce(-3.6, 2.3, zBack + 0.035, 0, 2);

    /* what passes for décor */
    const poster = (
      lines: [string, string],
      x: number,
      y: number,
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
            ctx.fillStyle = "#6b5836";
            ctx.fillText(lines[1], 128, 300);
          }),
          roughness: 0.9,
        })
      );
      p.position.set(x, y, z);
      p.rotation.y = ry;
      p.rotateZ(tilt);
      this.scene.add(p);
    };
    poster(["THE HOUSE ALWAYS WINS", "it lives here, after all"], 0.35, 2.45, zBack + 0.02, 0, -0.04);
    poster(["WINNERS SIT STILL", "everyone else also sits still"], -halfW + 0.02, 1.75, 1.4, Math.PI / 2, 0.06);
    poster(["CASH ONLY", "and it stays here"], 2.6, 1.8, zFront - 0.02, Math.PI, -0.05);

    /* neon on the west wall, naming the whole enterprise */
    this.neonMat = new THREE.MeshBasicMaterial({
      map: canvasTexture(640, 160, (ctx) => {
        // no backing fill: just tubes and glow floating on the plaster
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "700 58px 'Pixelify Sans',sans-serif";
        ctx.shadowColor = "#e0522b";
        ctx.shadowBlur = 26;
        ctx.strokeStyle = "#ff8a5e";
        ctx.lineWidth = 3;
        ctx.strokeText("DRINK · SMOKE · BET", 320, 64);
        ctx.fillStyle = "#ffb08a";
        ctx.fillText("DRINK · SMOKE · BET", 320, 64);
        ctx.font = "28px 'VT323',monospace";
        ctx.shadowBlur = 12;
        ctx.fillStyle = "#c9836a";
        ctx.fillText("repeat until done", 320, 124);
      }),
      transparent: true,
    });
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5), this.neonMat);
    neon.position.set(-halfW + 0.03, 2.0, -1.6);
    neon.rotation.y = Math.PI / 2;
    this.scene.add(neon);

    /* barred window on the east wall: night outside, and it stays outside */
    const winX = halfW - 0.02;
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.56),
      new THREE.MeshBasicMaterial({ color: 0x131c26 })
    );
    pane.position.set(winX, 2.35, 2.3);
    pane.rotation.y = -Math.PI / 2;
    this.scene.add(pane);
    for (const [w, h, oy, oz] of [
      [0.84, 0.07, 0.315, 0],
      [0.84, 0.07, -0.315, 0],
      [0.07, 0.56, 0, 0.385],
      [0.07, 0.56, 0, -0.385],
    ]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, w), frameMat);
      strip.position.set(winX - 0.01, 2.35 + oy, 2.3 + oz);
      this.scene.add(strip);
    }
    for (const oz of [-0.15, 0.05, 0.25]) {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.011, 0.011, 0.56, 6),
        new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.7, roughness: 0.5 })
      );
      bar.position.set(winX - 0.03, 2.35, 2.2 + oz);
      this.scene.add(bar);
    }
    const moon = new THREE.PointLight(0x35507a, 2.4, 4.5, 2);
    moon.position.set(winX - 0.3, 2.35, 2.3);
    this.scene.add(moon);

    /* shelf of the house's private reserve, east wall */
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 1.1), woodMat);
    shelf.position.set(halfW - 0.11, 1.45, -0.8);
    shelf.castShadow = true;
    this.scene.add(shelf);
    for (const bz of [-1.15, -0.85, -0.55]) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.04), frameMat);
      bracket.position.set(halfW - 0.09, 1.36, bz);
      this.scene.add(bracket);
    }
    this.scatterBottles([
      [halfW - 0.12, 1.47, -1.1, false],
      [halfW - 0.1, 1.47, -0.88, false],
      [halfW - 0.13, 1.47, -0.62, false],
      [halfW - 0.11, 1.47, -0.42, false],
    ]);

    /* sconces over the players' shoulders — fixtures only, the ambient
       carries them; real lights stay budgeted for the table and neon */
    this.sconce(-2.5, 2.25, zFront - 0.035, Math.PI, 1.5);
    this.sconce(2.5, 2.25, zFront - 0.035, Math.PI, 1.5);

    /* floor clutter: crates in one corner, a bucket that lost its mop */
    const crate1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), oldWoodMat);
    crate1.position.set(3.55, 0.275, zFront - 0.75);
    crate1.rotation.y = 0.3;
    crate1.castShadow = true;
    const crate2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), oldWoodMat);
    crate2.position.set(3.62, 0.8, zFront - 0.82);
    crate2.rotation.y = -0.2;
    crate2.castShadow = true;
    const bucket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.11, 0.26, 14, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x3f4448,
        metalness: 0.6,
        roughness: 0.5,
        side: THREE.DoubleSide,
      })
    );
    bucket.position.set(-3.7, 0.13, zFront - 0.6);
    bucket.castShadow = true;
    const broom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 1.3, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b5433, roughness: 0.9 })
    );
    broom.position.set(-3.35, 0.66, zFront - 0.28);
    broom.rotation.z = 0.28;
    const brush = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.12, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x8a6f3f, roughness: 1 })
    );
    brush.position.set(-3.53, 0.06, zFront - 0.28);
    this.scene.add(crate1, crate2, bucket, broom, brush);
  }

  /* a wall sconce: half-shade, glowing bulb, and optionally a real light
     (most are set dressing — the ambient does their lifting) */
  private sconce(x: number, y: number, z: number, ry: number, glow: number): void {
    const g = new THREE.Group();
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.16, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x2a2416, metalness: 0.4, roughness: 0.6 })
    );
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.045, 0.11, 12, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x1e3a28,
        roughness: 0.55,
        metalness: 0.25,
        side: THREE.DoubleSide,
      })
    );
    shade.position.set(0, 0.05, 0.07);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe2ae })
    );
    bulb.position.set(0, 0.09, 0.07);
    g.add(plate, shade, bulb);
    g.position.set(x, y, z);
    g.rotation.y = ry;
    this.scene.add(g);
    if (glow > 0) {
      const light = new THREE.PointLight(0xffc07a, glow, 4.5, 1.8);
      light.position.set(x, y + 0.18, z);
      light.translateZ(0.3 * (ry === 0 ? 1 : -1));
      this.scene.add(light);
    }
  }

  /* dead soldiers and full ones alike: quick dark-glass bottles for the
     shelf and the back bar. [x, y(surface), z, tippedOver] */
  private scatterBottles(spots: [number, number, number, boolean][]): void {
    const glassColors = [0x24402a, 0x4a2a12, 0x1e2a1a, 0x3d2317];
    let i = 0;
    for (const [x, y, z, tipped] of spots) {
      const mat = new THREE.MeshStandardMaterial({
        color: glassColors[i++ % glassColors.length],
        roughness: 0.15,
        metalness: 0.1,
      });
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.035, 0.16, 10), mat);
      body.position.y = 0.08;
      body.castShadow = true;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.024, 0.08, 8), mat);
      neck.position.y = 0.19;
      g.add(body, neck);
      if (tipped) {
        g.rotation.z = Math.PI / 2;
        g.position.set(x, y + 0.035, z);
        g.rotation.y = 0.7;
      } else {
        g.position.set(x, y, z);
        g.rotation.y = i * 1.7;
      }
      this.scene.add(g);
    }
  }

  private buildTable(): void {
    const wood = woodTexture();
    const seatAngles = Array.from({ length: SEAT_COUNT }, (_, i) => seatAngle(i));
    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(TABLE.radius, TABLE.radius, 0.08, 64),
      new THREE.MeshStandardMaterial({ map: feltTexture(seatAngles), roughness: 0.94 })
    );
    felt.position.y = TABLE.height - 0.04;
    felt.receiveShadow = true;
    felt.castShadow = true;

    const rimWood = new THREE.MeshStandardMaterial({
      map: wood,
      roughness: 0.35,
      metalness: 0.05,
    });
    rimWood.map!.repeat.set(6, 1);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(TABLE.rimRadius, TABLE.rimTube, 16, 64),
      rimWood
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = TABLE.height + TABLE.rimTube * 0.5;
    rim.castShadow = true;

    // brass inlay ring between felt and rim
    const inlay = new THREE.Mesh(
      new THREE.TorusGeometry(TABLE.rimRadius - TABLE.rimTube - 0.012, 0.008, 8, 64),
      new THREE.MeshStandardMaterial({ color: 0xe8c469, metalness: 0.85, roughness: 0.3 })
    );
    inlay.rotation.x = Math.PI / 2;
    inlay.position.y = TABLE.height + 0.004;

    // apron: the skirt under the felt's edge, so the top reads as a solid
    // slab instead of a floating disc when seen from a stool
    const apron = new THREE.Mesh(
      new THREE.CylinderGeometry(TABLE.radius - 0.005, TABLE.radius - 0.05, 0.15, 64, 1, true),
      rimWood
    );
    apron.position.y = TABLE.height - 0.155;

    const pedestalWood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7 });
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.52, TABLE.height - 0.08, 24),
      pedestalWood
    );
    pedestal.position.y = (TABLE.height - 0.08) / 2;
    pedestal.castShadow = true;
    // lathe-turned details: a collar at the top, a bulge mid-column
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.02, 8, 32), pedestalWood);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.65;
    const bulge = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.035, 10, 36), pedestalWood);
    bulge.rotation.x = Math.PI / 2;
    bulge.position.y = 0.32;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.62, 0.05, 24),
      pedestalWood
    );
    base.position.y = 0.025;
    // brass footrest ring for restless heels, strutted to the pedestal
    const brassRail = new THREE.MeshStandardMaterial({
      color: 0xe8c469,
      metalness: 0.8,
      roughness: 0.35,
    });
    const footRing = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.018, 10, 48), brassRail);
    footRing.rotation.x = Math.PI / 2;
    footRing.position.y = 0.22;
    this.scene.add(collar, bulge, footRing);
    for (let i = 0; i < 4; i++) {
      const holder = new THREE.Group();
      holder.rotation.y = (i / 4) * Math.PI * 2;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.12, 6), brassRail);
      strut.rotation.z = Math.PI / 2;
      strut.position.set(0.47, 0.22, 0);
      holder.add(strut);
      this.scene.add(holder);
    }

    // the shoe: wooden body with a brass lip
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.16), rimWood);
    shoe.position.copy(SHOE_POS);
    shoe.rotation.y = -0.25;
    shoe.castShadow = true;
    const shoeLip = new THREE.Mesh(
      new THREE.BoxGeometry(0.23, 0.014, 0.17),
      new THREE.MeshStandardMaterial({ color: 0xe8c469, metalness: 0.8, roughness: 0.35 })
    );
    shoeLip.position.copy(SHOE_POS).add(new THREE.Vector3(0, 0.077, 0));
    shoeLip.rotation.y = -0.25;

    this.scene.add(felt, rim, inlay, apron, pedestal, base, shoe, shoeLip);

    // stools: padded leather cushions with a rolled edge over a turned
    // column and four splayed legs — the cushion's top stays at ~0.66 so
    // the seated figures still land on the seat
    const leather = new THREE.MeshStandardMaterial({ map: leatherTexture(), roughness: 0.65 });
    const brass = new THREE.MeshStandardMaterial({
      color: 0xe8c469,
      metalness: 0.8,
      roughness: 0.35,
    });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x17130d, roughness: 0.6 });
    for (let i = 0; i < SEAT_COUNT; i++) {
      const p = seatPosition(i);
      const stool = new THREE.Group();
      const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.215, 0.06, 24), leather);
      cushion.position.y = 0.633;
      const roll = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.032, 10, 28), leather);
      roll.rotation.x = Math.PI / 2;
      roll.position.y = 0.648;
      const button = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x3d0e10, roughness: 0.5 })
      );
      button.scale.y = 0.45;
      button.position.y = 0.664;
      const trim = new THREE.Mesh(new THREE.TorusGeometry(0.208, 0.01, 8, 28), brass);
      trim.rotation.x = Math.PI / 2;
      trim.position.y = 0.605;
      const seatPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.11, 0.05, 14), darkWood);
      seatPlate.position.y = 0.578;
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.052, 0.5, 12), darkWood);
      column.position.y = 0.33;
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.013, 8, 16), darkWood);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.52;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.07, 0.07, 10), darkWood);
      hub.position.y = 0.29;
      stool.add(cushion, roll, button, trim, seatPlate, column, collar, hub);
      for (let l = 0; l < 4; l++) {
        const a = (l / 4) * Math.PI * 2 + 0.4;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.021, 0.36, 8), darkWood);
        leg.position.set(Math.sin(a) * 0.105, 0.16, Math.cos(a) * 0.105);
        leg.quaternion.setFromAxisAngle(_dir.set(Math.cos(a), 0, -Math.sin(a)), -0.45);
        leg.castShadow = true;
        stool.add(leg);
      }
      const footRail = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.011, 8, 24), brass);
      footRail.rotation.x = Math.PI / 2;
      footRail.position.y = 0.1;
      stool.add(footRail);
      for (const m of [cushion, roll, column, seatPlate]) m.castShadow = true;
      stool.position.set(p.x, 0, p.z);
      // each stool has been dragged and re-parked a thousand times
      stool.rotation.y = i * 1.9 + 0.6;
      this.scene.add(stool);
    }
  }

  private buildDealer(): void {
    const { group } = makeFigure(0xd9d2c0, 0x17130d, { seated: false, hat: 0x1e3a28 });
    group.position.set(DEALER_POS.x, 0, DEALER_POS.z);
    // yaw-only: figures stand upright. A 3D lookAt would tip the body back
    // and slide the rendered head off the seat axis — where the player's
    // camera actually is — breaking "aim at the body = look at them"
    group.lookAt(0, 0, 0);
    this.scene.add(group);
  }

  private makeAvatar(seat: number): AvatarView {
    const colors = [0x4a3b2a, 0x2c3c60, 0x6a1f1f, 0x24512f, 0x3a3226];
    const { group, head, armR, armL } = makeFigure(colors[seat % colors.length], 0x8a7560);
    const p = seatPosition(seat);
    group.position.set(p.x, 0.28, p.z);
    group.lookAt(0, 0.28, 0); // yaw-only: upright on the seat axis (see buildDealer)
    // uniform scale: the arm rigs and prop anchors all pose in group-local
    // space (worldToLocal), so everything stays glued at any scale
    group.scale.setScalar(AVATAR_SCALE);
    this.scene.add(group);
    return {
      seat,
      group,
      head,
      armR,
      armL,
      prop: null,
      propKey: null,
      propDying: false,
      propPosT: new THREE.Vector3(),
      propQuatT: new THREE.Quaternion(),
      lighter: null,
      flame: null,
      lighterDying: false,
      lighterPosT: new THREE.Vector3(),
      lastProgress: 0,
      targetYaw: 0,
      targetPitch: 0,
      throwUntil: 0,
      throwTarget: new THREE.Vector3(),
    };
  }

  /* ---------------- camera ---------------- */
  private setCameraSeat(seat: number): void {
    this.mySeat = seat;
    const eye = seatEye(seat);
    this.eyePos.set(eye.x, eye.y, eye.z);
    this.camera.position.copy(this.eyePos);
    this.applyLook();
  }

  private addShake(amp: number, dur = 0.16): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeLeft = Math.max(this.shakeLeft, dur);
  }

  /* quick punch-in and settle — blackjack should land in the chest */
  private fovPunch(): void {
    tween({
      duration: 90,
      update: (t) => {
        this.camera.fov = BASE_FOV - 7 * t;
        this.camera.updateProjectionMatrix();
      },
      done: () =>
        tween({
          duration: 320,
          ease: easeInOut,
          update: (t) => {
            this.camera.fov = BASE_FOV - 7 + 7 * t;
            this.camera.updateProjectionMatrix();
          },
        }),
    });
  }

  private applyLook(): void {
    const dir = lookDir(this.mySeat, this.yawOff, this.pitchOff, _dir);
    this.camera.lookAt(
      this.camera.position.x + dir.x,
      this.camera.position.y + dir.y,
      this.camera.position.z + dir.z
    );
  }

  /* ---------------- pointer routing ---------------- */
  private ndc(e: PointerEvent): THREE.Vector2 {
    return new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  }

  private bindPointer(): void {
    const dom = this.renderer.domElement;
    const capture = (e: PointerEvent) => {
      try {
        dom.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointers can't be captured — dragging still works */
      }
    };
    dom.addEventListener("pointerdown", (e) => {
      if (this.mode === "lobby") {
        this.lobbyRoom.pointerDown(e);
        capture(e);
        return;
      }
      const ndc = this.ndc(e);
      if (this.held.pointerDown(ndc)) {
        capture(e);
        return;
      }
      const target = this.findDebrisAt(ndc);
      if (target) {
        if (this.held.hasHeld) {
          // hands full: deny, and make the held item say so
          this.held.flashDeny();
          denySound();
          return;
        }
        // one motion: the pickup intent flies while the drag starts locally
        this.send({ type: "pickup", itemId: target.id });
        this.held.beginFloorGrab(target.kind, target.pos);
        capture(e);
        return;
      }
      this.looking = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      capture(e);
    });
    dom.addEventListener("pointermove", (e) => {
      if (this.mode === "lobby") {
        this.lobbyRoom.pointerMove(e);
        return;
      }
      if (this.held.isGrabbing) {
        this.held.pointerMove(this.ndc(e));
        return;
      }
      if (this.looking) {
        // well past the shoulder (~150°) — checking the room behind you is
        // allowed; avatars cap the SHOWN neck turn in the frame loop
        this.yawOff = clamp(
          this.yawOff - (e.clientX - this.lastPointer.x) * 0.003,
          -LOOK_YAW_LIMIT,
          LOOK_YAW_LIMIT
        );
        this.pitchOff = clamp(
          this.pitchOff + (e.clientY - this.lastPointer.y) * 0.003,
          LOOK_PITCH_MIN,
          LOOK_PITCH_MAX
        );
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.applyLook();
        this.lookDirty = true; // everyone else gets to watch the head turn
        return;
      }
      this.updateHover(this.ndc(e));
    });
    const up = () => {
      this.lobbyRoom.pointerUp();
      if (this.held.isGrabbing) this.held.pointerUp();
      this.looking = false;
    };
    dom.addEventListener("pointerup", up);
    dom.addEventListener("pointercancel", up);
  }

  /* what grabbable debris is under the pointer? Direct instance hit first,
     then a fat-pick fallback: nearest item (settled or mid-tumble) within
     ~25cm of the pointer ray — clicking near a cigar counts, and a rolling
     bottle can be snatched out of the air. */
  private findDebrisAt(ndc: THREE.Vector2): { id: number; kind: ViceKind; pos: THREE.Vector3 } | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.debrisView.pickables, false);
    for (const h of hits) {
      if (h.instanceId === undefined) continue;
      const id = this.debrisView.debrisIdFor(h.object, h.instanceId);
      if (id === null) continue;
      const info = this.debrisView.info(id);
      if (!info) continue;
      if (info.pos.distanceTo(this.camera.position) > REACH_RADIUS) continue;
      return { id, kind: info.kind, pos: info.pos };
    }
    const near = this.debrisView.nearestToRay(this.raycaster.ray, 0.25);
    if (near && near.pos.distanceTo(this.camera.position) <= REACH_RADIUS) return near;
    return null;
  }

  private updateHover(ndc: THREE.Vector2): void {
    const target = this.findDebrisAt(ndc);
    if (target && this.held.hasHeld) {
      // hands full: no invitation, and the cursor says why
      this.debrisView.setHighlight(null);
      this.renderer.domElement.style.cursor = "not-allowed";
      return;
    }
    this.debrisView.setHighlight(target?.id ?? null);
    this.renderer.domElement.style.cursor = target ? "grab" : "";
  }

  /* whether the waiting room owns the screen right now — main.ts uses it
     to route pointer-lock hand-offs */
  get inLobby(): boolean {
    return this.mode === "lobby";
  }

  /* re-capture the lobby mouse-look from a UI click (the options RESUME
     button) — pointer lock demands a fresh user gesture */
  captureLobbyPointer(): void {
    if (this.mode === "lobby") this.lobbyRoom.captureLook();
  }

  /* project a world point to CSS pixels — used by headless UI tests.
     Projects through whichever camera is live (table or waiting room). */
  screenPos(x: number, y: number, z: number): { x: number; y: number } {
    const cam = this.mode === "lobby" ? this.lobbyRoom.camera : this.camera;
    const v = new THREE.Vector3(x, y, z).project(cam);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  }

  /* ---------------- ritual ghost (driven by RitualControl) ---------------- */
  showRitualGhost(kind: ViceKind): void {
    this.hideRitualGhost();
    this.ritualGhost = kind === "beer" ? makeBottleMesh() : makeCigarMesh(false);
    if (kind === "cigar") this.ritualGhost.scale.setScalar(1.35); // foreshortened, needs presence
    this.ritualGhostKind = kind;
    this.scene.add(this.ritualGhost);
  }

  /* place the ghost on the pointer ray. Orientation is first-person:
     - cigar: held like a smoker holds it — mouth end (band) toward the
       player, lit end pointing away with a slight up-right cant
     - beer: neck tips back TOWARD the mouth as `tilt` grows, curving left
       so the bottle stays visible instead of foreshortening into a disc */
  moveRitualGhost(ndcX: number, ndcY: number, tilt: number): void {
    if (!this.ritualGhost) return;
    this.ritualRay.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    this.ritualGhost.position
      .copy(this.ritualRay.ray.origin)
      .addScaledVector(this.ritualRay.ray.direction, 0.9);
    this.ritualGhost.quaternion.copy(this.camera.quaternion);
    if (this.ritualGhostKind === "cigar") {
      // ember end points away and up-right; enough screen-plane length
      // remains that it reads as a cigar, not a dot behind the lighter
      this.ritualGhost.rotateZ(0.35);
      this.ritualGhost.rotateX(-0.95);
    } else {
      this.ritualGhost.rotateZ(0.18 + tilt * 0.45); // left curve keeps the label in view
      this.ritualGhost.rotateX(tilt * 0.75); // neck pitches back toward the drinker
    }
    this.ritualGhost.updateMatrixWorld();
  }

  /* screen position of the ghost's far tip (+Y end: ember / bottle neck) —
     the lighter flame parks itself here */
  ritualGhostTipScreen(): { x: number; y: number } | null {
    if (!this.ritualGhost) return null;
    const tip = this.ritualGhost.localToWorld(new THREE.Vector3(0, 0.075, 0));
    const v = tip.project(this.camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  }

  ritualGhostWorldPos(): THREE.Vector3 | null {
    return this.ritualGhost ? this.ritualGhost.position.clone() : null;
  }

  emitSmokeAtGhost(): void {
    if (!this.ritualGhost) return;
    // smoke rises off the ember — the far tip, not "above the hand"
    this.smoke.emit(this.ritualGhost.localToWorld(new THREE.Vector3(0, 0.062, 0)));
  }

  hideRitualGhost(): void {
    if (this.ritualGhost) this.scene.remove(this.ritualGhost);
    this.ritualGhost = null;
    this.ritualGhostKind = null;
  }

  /* ---------------- snapshot reconcile ---------------- */
  apply(snap: Snapshot, myId: string): void {
    this.latest = snap;
    this.myId = myId;

    // the lobby phase happens in the waiting room, a scene of its own; the
    // table below still reconciles so the den is warm when the game starts
    const wantLobby = snap.phase === "lobby";
    if (wantLobby !== (this.mode === "lobby")) {
      this.mode = wantLobby ? "lobby" : "table";
      this.lobbyRoom.setActive(wantLobby);
      this.renderer.domElement.style.cursor = "";
    }
    if (wantLobby) this.lobbyRoom.apply(snap, myId);

    const me = snap.players.find((p) => p.id === myId);
    if (me && me.seat !== this.mySeat) this.setCameraSeat(me.seat);

    // dealer reveals (hole card, draw-out cards) hang an extra beat when
    // you're sweating a made hand — anticipation is the whole show
    const myTotal = me && me.alive && me.bet > 0 ? handValue(me.hand).total : 0;
    this.dealerZone.setTension(myTotal >= 19 && myTotal <= 21 ? 1 : 0);

    this.dealerZone.reconcile(snap.dealerHand);
    this.dealerZone.setBadge(
      snap.dealerHand.length === 0
        ? null
        : snap.holeHidden
          ? "SHOWS " + snap.dealerHand[0].r
          : String(handValue(snap.dealerHand).total)
    );

    for (const p of snap.players) {
      let zone = this.playerZones.get(p.id);
      if (!zone) {
        const anchor = seatTablePoint(p.seat, HAND_ANCHOR_R);
        const mine = p.id === myId;
        // ONE layout for every viewer (shared constants): the sim's card
        // colliders match what everyone sees, and a neighbor's hand is big
        // enough to actually follow as they play it. Only the badge differs —
        // your own total pill tucks in close so it never blocks your cards.
        zone = new CardZone(
          this.scene,
          new THREE.Vector3(anchor.x, anchor.y + CARD_LIFT, anchor.z),
          seatAngle(p.seat),
          SHOE_POS,
          dealSound,
          mine
            ? {
                scale: PLAYER_CARD_SCALE,
                lean: PLAYER_CARD_LEAN,
                badgeScale: 0.8,
                badgeOffset: { x: 0, y: 0.17, z: 0 },
              }
            : { scale: PLAYER_CARD_SCALE, lean: PLAYER_CARD_LEAN }
        );
        this.playerZones.set(p.id, zone);
      }
      // your own hit card hesitates when the hit could bust you
      if (p.id === myId && p.hand.length > 2) {
        const prior = handValue(p.hand.slice(0, -1)).total;
        zone.setTension(prior >= 14 && prior <= 16 ? 1 : 0);
      } else {
        zone.setTension(0);
      }
      zone.reconcile(p.hand);
      const hv = handValue(p.hand);
      zone.setBadge(
        p.hand.length ? `${hv.soft && hv.total <= 21 ? "soft " : ""}${hv.total}` : null
      );
      this.lastSeat.set(p.id, p.seat);
      this.reconcileChips(p);
      this.reconcileAvatar(p);
    }
    // players who left: sweep their cards, chips, and avatar
    for (const [id, zone] of this.playerZones)
      if (!snap.players.some((p) => p.id === id)) {
        zone.clear();
        this.playerZones.delete(id);
        const chips = this.chipStacks.get(id);
        if (chips) {
          this.scene.remove(chips.group);
          this.chipStacks.delete(id);
        }
        const seat = this.lastSeat.get(id);
        this.lastSeat.delete(id);
        if (seat !== undefined) {
          const avatar = this.avatars.get(seat);
          if (avatar) {
            this.scene.remove(avatar.group);
            this.avatars.delete(seat);
          }
        }
      }

    // lobby litter belongs to the waiting-room scene; the den only ever
    // renders its own. The held empty follows whichever room is live —
    // handing the other view `undefined` retires its mesh.
    this.debrisView.apply(snap.debris.filter((d) => d.room !== "lobby"));
    this.held.apply(wantLobby ? undefined : me);

    for (const ev of snap.events) {
      if (ev.t === "impact") {
        impactSound(ev.speed);
        this.addShake(Math.min(0.012, 0.002 + ev.speed * 0.001));
      } else if (ev.t === "moneyDrop") {
        this.cash.emit(new THREE.Vector3(ev.pos.x, ev.pos.y + 0.04, ev.pos.z), ev.amount);
        cashSound();
      } else if (ev.t === "litter") {
        // your mess, your dopamine — nobody else sees the points pop
        if (ev.playerId === myId) {
          this.points.emit(new THREE.Vector3(ev.pos.x, ev.pos.y + 0.03, ev.pos.z), ev.points);
          pointsSound();
        }
      } else if (ev.t === "score") {
        // anchor-less gains (hand settled, vice finished): your own head is
        // behind the camera, so the pop lands just inside your view instead
        if (ev.playerId === myId) {
          const fwd = this.camera.getWorldDirection(new THREE.Vector3());
          const at = this.camera.position.clone().addScaledVector(fwd, 0.6);
          at.y -= 0.12;
          this.points.emit(at, ev.points);
          pointsSound();
        }
      } else if (ev.t === "playerHit") {
        const at = new THREE.Vector3(ev.pos.x, ev.pos.y, ev.pos.z);
        if (ev.victimId === myId) {
          // the impact point is at your own head — behind your view. Pull
          // the yelp into frame, biased toward the side the bottle came from
          const fwd = this.camera.getWorldDirection(new THREE.Vector3());
          const side = at.clone().sub(this.camera.position);
          side.addScaledVector(fwd, -side.dot(fwd));
          if (side.lengthSq() > 1e-6) side.setLength(0.18);
          at.copy(this.camera.position).addScaledVector(fwd, 0.55).add(side);
        }
        this.ouch.emit(at); // world-anchored: everyone sees the victim yelp
        if (ev.flingerId === myId) {
          // the sniper's payoff: points pop right where the bottle connected
          this.points.emit(at.clone().add(new THREE.Vector3(0, 0.18, 0)), ev.points);
          pointsSound();
        }
        if (ev.victimId === myId) {
          this.addShake(0.025, 0.3);
          hurtSound();
        }
      } else if (ev.t === "fling") {
        whooshSound();
        // the real item is airborne as debris now — a hand prop easing
        // down would be a ghost duplicate, so it dies on the spot
        const who = snap.players.find((q) => q.id === ev.playerId);
        const av = who ? this.avatars.get(who.seat) : undefined;
        if (av) {
          if (av.prop && av.propDying) {
            av.group.remove(av.prop);
            av.prop = null;
            av.propDying = false;
          }
          // follow-through: the arm whips out along the throw
          _dir.set(ev.vel.x, ev.vel.y, ev.vel.z);
          if (_dir.lengthSq() > 1e-6) {
            av.group.getWorldQuaternion(_q).invert();
            _dir.normalize().applyQuaternion(_q);
            av.throwTarget.copy(av.armR.shoulder).addScaledVector(_dir, 0.46);
            av.throwUntil = performance.now() + 240;
          }
        }
      } else if (ev.t === "result" && ev.delta > 0) {
        const winner = snap.players.find((q) => q.id === ev.playerId);
        if (winner) this.payoutChips(winner.seat, ev.delta);
        if (ev.playerId === myId && ev.label === "BLACKJACK!") this.fovPunch();
      }
    }
  }

  /* winnings slide across the felt from the dealer's bank — money you can
     watch arrive beats a number ticking up */
  private payoutChips(seat: number, amount: number): void {
    chipRiffleSound();
    const n = Math.min(14, Math.max(3, Math.round(Math.log2(amount / 5 + 1) * 2)));
    const colors = [0x2c3c60, 0x6a1f1f, 0x24512f, 0x101010];
    const group = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const chip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.008, 16),
        new THREE.MeshStandardMaterial({ color: colors[i % 4], roughness: 0.4 })
      );
      chip.position.set(
        (Math.random() - 0.5) * 0.006,
        0.006 + i * 0.009,
        (Math.random() - 0.5) * 0.006
      );
      chip.rotation.y = Math.random() * Math.PI;
      chip.castShadow = true;
      group.add(chip);
    }
    group.position.set(0, TABLE.height, -0.25); // the dealer's bank
    this.scene.add(group);

    const from = group.position.clone();
    const spot = seatTablePoint(seat, 0.62);
    const a = seatAngle(seat);
    const dest = new THREE.Vector3(spot.x, spot.y, spot.z).addScaledVector(
      new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)),
      -0.3
    );
    const dispose = () => {
      this.scene.remove(group);
      for (const c of group.children as THREE.Mesh[]) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    };
    tween({
      duration: 700,
      ease: easeInOut,
      update: (t) => {
        group.position.lerpVectors(from, dest, t);
        group.position.y += Math.sin(t * Math.PI) * 0.05;
      },
      done: () =>
        tween({
          duration: 400,
          delay: 550,
          update: (t) => group.scale.setScalar(1 - t),
          done: dispose,
        }),
    });
  }

  private reconcileChips(p: PlayerSnap): void {
    const bet = p.committed ? p.bet : 0;
    let entry = this.chipStacks.get(p.id);
    if (!entry) {
      entry = { group: new THREE.Group(), bet: -1 };
      // beside the cards, not between them and the eye — a chip stack in
      // the sightline reads as a black blob squatting on your hand
      const spot = seatTablePoint(p.seat, 0.62);
      const a = seatAngle(p.seat);
      const tangent = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      entry.group.position.set(spot.x, spot.y, spot.z).addScaledVector(tangent, -0.3);
      this.scene.add(entry.group);
      this.chipStacks.set(p.id, entry);
    }
    if (entry.bet === bet) return;
    entry.bet = bet;
    entry.group.clear();
    if (bet <= 0) return;
    const n = Math.min(14, Math.max(1, Math.round(Math.log2(bet / 5 + 1) * 2)));
    const colors = [0x2c3c60, 0x6a1f1f, 0x24512f, 0x101010];
    for (let i = 0; i < n; i++) {
      const chip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.008, 16),
        new THREE.MeshStandardMaterial({ color: colors[i % 4], roughness: 0.4 })
      );
      chip.position.set((Math.random() - 0.5) * 0.006, 0.006 + i * 0.009, (Math.random() - 0.5) * 0.006);
      chip.rotation.y = Math.random() * Math.PI;
      chip.castShadow = true;
      entry.group.add(chip);
    }
  }

  private reconcileAvatar(p: PlayerSnap): void {
    const isMe = p.id === this.myId;
    const existing = this.avatars.get(p.seat);
    if (isMe) {
      if (existing) {
        this.scene.remove(existing.group);
        this.avatars.delete(p.seat);
      }
      return;
    }
    let av = existing;
    if (!av) {
      av = this.makeAvatar(p.seat);
      this.avatars.set(p.seat, av);
    }
    av.targetYaw = p.look.yaw;
    av.targetPitch = p.look.pitch;
    this.reconcileViceProp(av, p);
  }

  /* what's in their hand, for everyone to see. Props ease between poses
     (frame() does the motion): a new ritual raises the item from the hand
     to the mouth, the bottle tips back with the pour, a cigar brings the
     lighter up in the other hand, and a finished empty lowers back to the
     hand until they fling it. A cancelled ritual gets put away the same
     way — eased down, then retired. */
  private reconcileViceProp(av: AvatarView, p: PlayerSnap): void {
    const key = p.ritual ? "ritual:" + p.ritual.kind : p.held ? "held:" + p.held.kind : null;
    if (key !== av.propKey) {
      if (key === null) {
        // nothing replaces it: lower to the hand, frame() retires it there
        av.propKey = null;
        if (av.prop) {
          av.propDying = true;
          av.propPosT.copy(HAND_R);
          av.propQuatT.setFromEuler(_e.set(0.9, 0, -0.5));
        }
      } else {
        // swap meshes in place: complete→held keeps the pose and lowers
        const from = av.prop ? av.prop.position.clone() : HAND_R.clone();
        if (av.prop) av.group.remove(av.prop);
        av.prop = key.endsWith("beer") ? makeBottleMesh() : makeCigarMesh(key.startsWith("held"));
        av.prop.position.copy(from);
        av.group.add(av.prop);
        av.propKey = key;
        av.propDying = false;
        av.lastProgress = 0;
      }
      // the lighter comes out with a cigar ritual, and only then
      if (key === "ritual:cigar" && !av.lighter) {
        const { group, flame } = makeLighterMesh();
        group.position.copy(HAND_L);
        av.lighter = group;
        av.flame = flame;
        av.lighterDying = false;
        av.group.add(group);
      } else if (key !== "ritual:cigar" && av.lighter && !av.lighterDying) {
        av.lighterDying = true;
        av.lighterPosT.copy(HAND_L);
        if (av.flame) av.flame.visible = false;
      }
    }
    if (!av.prop || av.propDying) return;
    if (p.ritual) {
      const t = p.ritual.progress;
      if (p.ritual.kind === "beer") {
        av.propPosT.set(0.13, 1.04 + t * 0.14, 0.21);
        av.propQuatT.setFromEuler(_e.set(-(0.15 + t * 1.1), 0, 0.15));
      } else {
        av.propPosT.set(0.1, 1.17, 0.18);
        av.propQuatT.setFromEuler(_e.set(-1.1, 0, 0.35));
        av.lighterPosT.set(0.0, 1.09, 0.27); // flame up by the cigar's tip
        if (t > av.lastProgress && Math.random() < 0.35) {
          av.group.updateMatrixWorld(true);
          this.smoke.emit(av.prop.localToWorld(new THREE.Vector3(0, 0.062, 0)));
        }
      }
      av.lastProgress = t;
    } else if (p.held?.pos) {
      // the owner is dragging it — mirror the wind-up, hand tracking along
      av.propPosT.copy(av.group.worldToLocal(_grip.set(p.held.pos.x, p.held.pos.y, p.held.pos.z)));
      av.propQuatT.setFromEuler(_e.set(0.25, 0, 0.15));
    } else {
      // the spent empty dangles from the hand
      av.propPosT.copy(HAND_R);
      av.propQuatT.setFromEuler(_e.set(0.9, 0, -0.5));
    }
  }

  /* If this avatar's gaze ray passes near a PLAYER — their head or their
     torso, since "look at someone" means centering the body as often as the
     face — lock the gaze onto their eyes exactly. When the target is MINE,
     the aim point is my actual camera: someone looking at you stares
     straight down your lens, not an aiming-error to the side of it. Beyond
     the cone the raw ray stands, so deliberately gazing past still works. */
  private snapGaze(av: AvatarView, dir: THREE.Vector3): void {
    const eye = seatEye(av.seat);
    _from.set(eye.x, eye.y, eye.z);
    let bestAng = GAZE_SNAP;
    let found = false;
    // test the column at (x,z) from chest to head; on a hit, aim at eye level
    const consider = (x: number, z: number, yHead: number, yChest: number, yAim: number) => {
      for (const y of [yHead, yChest]) {
        _cand.set(x, y, z).sub(_from);
        const a = dir.angleTo(_cand);
        if (a < bestAng) {
          bestAng = a;
          _best.set(x, yAim, z).sub(_from);
          found = true;
        }
      }
    };
    if (this.latest)
      for (const q of this.latest.players) {
        if (q.seat === av.seat) continue;
        if (q.id === this.myId)
          consider(this.eyePos.x, this.eyePos.z, this.eyePos.y, this.eyePos.y - 0.42, this.eyePos.y);
        else {
          const p = seatPosition(q.seat);
          consider(p.x, p.z, AVATAR_HEAD_Y, AVATAR_CHEST_Y, AVATAR_HEAD_Y - 0.04);
        }
      }
    consider(DEALER_POS.x, DEALER_POS.z, 1.26, 0.9, 1.26); // staring down the dealer
    if (found) dir.copy(_best).normalize();
  }

  /* ---------------- frame loop ---------------- */
  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    updateTweens(now);

    if (this.mode === "lobby") {
      this.lobbyRoom.frame(dt, now);
      this.renderer.render(this.lobbyRoom.scene, this.lobbyRoom.camera);
      requestAnimationFrame(() => this.frame());
      return;
    }

    // heads ease toward their owner's actual camera ray — reproduced in
    // world space, so the avatar frame's lean can't skew the gaze
    const k = Math.min(1, dt * 10);
    const kp = Math.min(1, dt * 5); // props raise/lower in ~half a second
    for (const av of this.avatars.values()) {
      // a camera may crank to LOOK_YAW_LIMIT, but a rendered neck cannot:
      // cap the shown turn short of exorcist territory. Past the cap the
      // owner is looking off into the room, never at another player, so
      // eye-contact fidelity survives the clamp.
      const headYaw = clamp(av.targetYaw, -HEAD_YAW_SHOWN_MAX, HEAD_YAW_SHOWN_MAX);
      lookDir(av.seat, headYaw, av.targetPitch, _dir);
      this.snapGaze(av, _dir);
      _m.lookAt(_dir, ORIGIN, UP); // basis with +Z along the gaze ray
      _q.setFromRotationMatrix(_m);
      av.group.getWorldQuaternion(_qParent).invert();
      av.head.quaternion.slerp(_qParent.multiply(_q), k);

      if (av.prop) {
        av.prop.position.lerp(av.propPosT, kp);
        av.prop.quaternion.slerp(av.propQuatT, kp);
        if (av.propDying && av.prop.position.distanceTo(av.propPosT) < 0.03) {
          av.group.remove(av.prop);
          av.prop = null;
          av.propDying = false;
        }
      }
      if (av.lighter) {
        av.lighter.position.lerp(av.lighterPosT, kp);
        if (av.flame?.visible) {
          const s = 0.85 + 0.25 * Math.sin(now * 0.021) + 0.12 * Math.sin(now * 0.0077);
          av.flame.scale.set(s, s * (1.1 + 0.25 * Math.sin(now * 0.013)), s);
        }
        if (av.lighterDying && av.lighter.position.distanceTo(av.lighterPosT) < 0.03) {
          av.group.remove(av.lighter);
          av.lighter = null;
          av.flame = null;
          av.lighterDying = false;
        }
      }

      // hands follow whatever they're holding; empty hands drift home.
      // Props are already eased, so gripping tracks without extra lag.
      if (now < av.throwUntil) {
        // fling follow-through: fast whip toward full extension
        poseArm(
          av.armR,
          _grip.copy(av.armR.hand.position).lerp(av.throwTarget, Math.min(1, dt * 22))
        );
      } else if (av.prop) {
        _grip.set(0, -0.045, 0).applyQuaternion(av.prop.quaternion).add(av.prop.position);
        poseArm(av.armR, _grip);
      } else {
        poseArm(av.armR, _grip.copy(av.armR.hand.position).lerp(av.armR.rest, kp));
      }
      if (av.lighter) {
        _grip.set(0, -0.03, 0).add(av.lighter.position);
        poseArm(av.armL, _grip);
      } else {
        poseArm(av.armL, _grip.copy(av.armL.hand.position).lerp(av.armL.rest, kp));
      }
    }
    // share my own look at ~10 Hz, only when it changed
    if (this.lookDirty && now - this.lastLookSent > 100) {
      this.lastLookSent = now;
      this.lookDirty = false;
      this.send({
        type: "look",
        yaw: Math.round(this.yawOff * 100) / 100,
        pitch: Math.round(this.pitchOff * 100) / 100,
      });
    }
    // stream the drag of a held empty (~10 Hz) — my wind-up, their show
    const gp = this.held.grabWorldPos();
    if (gp) {
      this.wasGrabbing = true;
      if (now - this.lastHeldSent > 100) {
        this.lastHeldSent = now;
        this.send({ type: "heldMove", pos: { x: gp.x, y: gp.y, z: gp.z } });
      }
    } else if (this.wasGrabbing) {
      this.wasGrabbing = false;
      // released without a fling: the empty tucked back into the hand
      if (this.held.hasHeld) this.send({ type: "heldMove", pos: null });
    }

    if (this.shakeLeft > 0) {
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
      const k = this.shakeLeft > 0 ? this.shakeLeft / 0.16 : 0;
      this.camera.position.set(
        this.eyePos.x + (Math.random() - 0.5) * this.shakeAmp * k * 2,
        this.eyePos.y + (Math.random() - 0.5) * this.shakeAmp * k * 2,
        this.eyePos.z + (Math.random() - 0.5) * this.shakeAmp * k * 2
      );
      if (this.shakeLeft === 0) {
        this.camera.position.copy(this.eyePos);
        this.shakeAmp = 0;
      }
    }
    // the neon buzzes: two incommensurate sines read as electrical, not tidal
    const flick = 0.84 + 0.12 * Math.sin(now * 0.019) + 0.05 * Math.sin(now * 0.0073);
    this.neonMat.opacity = flick;
    this.neonLight.intensity = 3 + 4 * flick;

    // while the title screen hangs over the den, the table lamp catches the
    // same bad wiring as the marquee sign — but on its own slower 13.4s
    // cycle (incommensurate with the sign's 7s, so they never lock step)
    let lampF = 1;
    if (this.titleScreenEl.classList.contains("active")) {
      const t = now % 13400;
      if (t > 9040 && t < 9130) lampF = 0.3;
      else if (t > 9220 && t < 9280) lampF = 0.5;
      else if (t > 12960 && t < 13010) lampF = 0.25;
    }
    this.tableSpot.intensity = 70 * lampF;
    this.lampBulbMat.color.setHex(0xfff2cf).multiplyScalar(lampF);
    this.lampInnerMat.color.setHex(0xffe2ae).multiplyScalar(lampF);
    this.lampHazeMat.opacity = 0.055 * lampF;

    this.debrisView.frame(dt);
    this.held.frame(dt);
    this.smoke.frame(dt);
    this.cash.frame(dt);
    this.points.frame(dt);
    this.ouch.frame(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.frame());
  }
}

/* a pocket lighter for third-person smokers: brass body, steel hood, and a
   teardrop flame that frame() keeps flickering */
function makeLighterMesh(): { group: THREE.Group; flame: THREE.Mesh } {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.022, 0.042, 0.014),
    new THREE.MeshStandardMaterial({ color: 0xb08d3e, metalness: 0.85, roughness: 0.3 })
  );
  const hood = new THREE.Mesh(
    new THREE.BoxGeometry(0.023, 0.012, 0.015),
    new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.9, roughness: 0.25 })
  );
  hood.position.y = 0.027;
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.007, 0.03, 8),
    new THREE.MeshBasicMaterial({ color: 0xffc25e })
  );
  flame.position.y = 0.05;
  group.add(body, hood, flame);
  return { group, flame };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/* one-off canvas texture for signs and posters */
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
