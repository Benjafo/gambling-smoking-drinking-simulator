/* The 3D den: table, seats, avatars, cards, chips, debris — plus the
   per-seat camera and pointer routing (grab > pickup > look). Everything
   here renders snapshots; nothing here mutates game state. */
import * as THREE from "three";
import {
  TABLE,
  SEAT_COUNT,
  DEALER_POS,
  REACH_RADIUS,
  LOOK_YAW_LIMIT,
  LOOK_PITCH_MIN,
  LOOK_PITCH_MAX,
  seatAngle,
  seatPosition,
  seatEye,
  seatTablePoint,
} from "@shared/constants";
import type { Intent, PlayerSnap, Snapshot } from "@shared/types";
import type { ViceKind } from "@shared/types";
import { handValue } from "@shared/blackjack";
import { feltTexture, woodTexture, carpetTexture, leatherTexture } from "./textures";
import { CardZone } from "./cards";
import { DebrisView } from "./debris";
import { HeldItemControl, makeBottleMesh, makeCigarMesh } from "./held";
import {
  SmokeSystem,
  CashBurst,
  PointsBurst,
  impactSound,
  dealSound,
  denySound,
  cashSound,
  pointsSound,
  whooshSound,
  chipRiffleSound,
} from "./effects";
import { updateTweens, tween, easeInOut } from "./tween";

const CENTER = new THREE.Vector3(0, TABLE.height + 0.05, 0);
const SHOE_POS = new THREE.Vector3(0.72, TABLE.height + 0.09, -0.78);

/* another player's presence at the table: their figure, the head that
   tracks where they're looking, and whatever vice is in their hand */
interface AvatarView {
  seat: number;
  group: THREE.Group;
  head: THREE.Group;
  prop: THREE.Group | null;
  propKey: string | null; // "ritual:beer" | "held:cigar" | …
  lastProgress: number;
  targetYaw: number;
  targetPitch: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3(0, 0, 0);
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _m = new THREE.Matrix4();

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
  private lastPointer = { x: 0, y: 0 };
  private lastFrame = performance.now();
  private latest: Snapshot | null = null;
  private myId = "";

  constructor(container: HTMLElement, private send: (intent: Intent) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.05, 60);
    this.setCameraSeat(2);

    this.scene.background = new THREE.Color(0x0d0b08);
    this.scene.fog = new THREE.Fog(0x0d0b08, 6, 16);

    this.buildLights();
    this.buildRoom();
    this.buildTable();
    this.buildDealer();

    this.smoke = new SmokeSystem(this.scene);
    this.cash = new CashBurst(this.scene);
    this.points = new PointsBurst(this.scene);
    this.debrisView = new DebrisView(this.scene);
    this.held = new HeldItemControl(this.scene, this.camera, send);
    this.dealerZone = new CardZone(
      this.scene,
      new THREE.Vector3(0, TABLE.height + 0.004, -0.52),
      0,
      SHOE_POS,
      dealSound,
      // propped toward the players, sized for distance; the total pill sits
      // on the felt in front of the cards, not over the dealer's face
      { scale: 1.3, lean: 0.3, badgeOffset: { x: 0, y: 0.03, z: 0.3 } }
    );

    addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    this.bindPointer();
    requestAnimationFrame(() => this.frame());
  }

  /* ---------------- static world ---------------- */
  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0x342b1e, 1.6));
    // the spot hangs from the lamp over the table
    const spot = new THREE.SpotLight(0xffdca8, 70, 12, Math.PI / 3.1, 0.5, 1.5);
    spot.position.set(0, 2.65, 0);
    spot.target.position.set(0, TABLE.height, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    this.scene.add(spot, spot.target);
    const rim = new THREE.PointLight(0xe0522b, 6, 7, 2);
    rim.position.set(-3, 1.6, -2.5);
    this.scene.add(rim);

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
      new THREE.CylinderGeometry(0.008, 0.008, 1.6, 6),
      new THREE.MeshStandardMaterial({ color: 0x0d0b08, roughness: 0.9 })
    );
    cord.position.y = 3.55;
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
    const shadeInner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.088, 0.41, 0.29, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe2ae, side: THREE.BackSide })
    );
    shadeInner.position.y = 2.78;
    const trim = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.014, 8, 28),
      new THREE.MeshStandardMaterial({ color: 0xe8c469, metalness: 0.8, roughness: 0.3 })
    );
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 2.63;
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff2cf })
    );
    bulb.position.y = 2.72;
    lamp.add(cord, shade, shadeInner, trim, bulb);
    this.scene.add(lamp);
  }

  private buildRoom(): void {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(11, 40),
      new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 0.97 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // far-off bar lights: dim amber orbs floating in the dark, softened by fog
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xd99a4e });
    const orbGeo = new THREE.SphereGeometry(0.05, 8, 6);
    const ORBS: [number, number, number][] = [
      [-7.5, 2.2, -4], [-8.2, 1.7, 1.5], [-5.5, 2.5, -6.5], [6.8, 2.1, -5],
      [8.4, 1.8, 0.5], [5.8, 2.4, -7.2], [-2.5, 2.6, -8.5], [2.8, 2.0, -8.8],
    ];
    for (const [x, y, z] of ORBS) {
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.set(x, y, z);
      this.scene.add(orb);
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

    const pedestalWood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7 });
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.52, TABLE.height - 0.08, 24),
      pedestalWood
    );
    pedestal.position.y = (TABLE.height - 0.08) / 2;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.62, 0.05, 24),
      pedestalWood
    );
    base.position.y = 0.025;

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

    this.scene.add(felt, rim, inlay, pedestal, base, shoe, shoeLip);

    // stools: worn leather tops with a brass trim ring
    const leather = new THREE.MeshStandardMaterial({ map: leatherTexture(), roughness: 0.65 });
    const brass = new THREE.MeshStandardMaterial({
      color: 0xe8c469,
      metalness: 0.8,
      roughness: 0.35,
    });
    for (let i = 0; i < SEAT_COUNT; i++) {
      const p = seatPosition(i);
      const stool = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.08, 18), leather);
      top.position.y = 0.62;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.011, 8, 24), brass);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.585;
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.09, 0.6, 10),
        new THREE.MeshStandardMaterial({ color: 0x17130d, roughness: 0.6 })
      );
      leg.position.y = 0.3;
      const foot = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 8, 20), brass);
      foot.rotation.x = Math.PI / 2;
      foot.position.y = 0.16;
      stool.add(top, ring, leg, foot);
      stool.position.set(p.x, 0, p.z);
      stool.castShadow = true;
      this.scene.add(stool);
    }
  }

  private buildDealer(): void {
    const { group } = makeFigure(0xd9d2c0, 0x17130d, { seated: false, hat: 0x1e3a28 });
    group.position.set(DEALER_POS.x, 0, DEALER_POS.z);
    group.lookAt(0, 1.0, 0);
    this.scene.add(group);
  }

  private makeAvatar(seat: number): AvatarView {
    const colors = [0x4a3b2a, 0x2c3c60, 0x6a1f1f, 0x24512f, 0x3a3226];
    const { group, head } = makeFigure(colors[seat % colors.length], 0x8a7560);
    const p = seatPosition(seat);
    group.position.set(p.x, 0.28, p.z);
    group.lookAt(0, 1.0, 0);
    this.scene.add(group);
    return {
      seat,
      group,
      head,
      prop: null,
      propKey: null,
      lastProgress: 0,
      targetYaw: 0,
      targetPitch: 0,
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
        this.camera.fov = 58 - 7 * t;
        this.camera.updateProjectionMatrix();
      },
      done: () =>
        tween({
          duration: 320,
          ease: easeInOut,
          update: (t) => {
            this.camera.fov = 51 + 7 * t;
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
      if (this.held.isGrabbing) {
        this.held.pointerMove(this.ndc(e));
        return;
      }
      if (this.looking) {
        // wide enough to center the neighboring seats (~74° off-axis)
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

  /* project a world point to CSS pixels — used by headless UI tests */
  screenPos(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
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
        const anchor = seatTablePoint(p.seat, 0.86);
        const mine = p.id === myId;
        zone = new CardZone(
          this.scene,
          new THREE.Vector3(anchor.x, anchor.y + 0.004, anchor.z),
          seatAngle(p.seat),
          SHOE_POS,
          dealSound,
          // your own hand is the one you must read at a glance; neighbors'
          // lean gently toward their owners, still identifiable from above
          mine
            ? { scale: 1.3, lean: 0.55, badgeScale: 0.8, badgeOffset: { x: 0, y: 0.17, z: 0 } }
            : { scale: 1.05, lean: 0.12 }
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

    this.debrisView.apply(snap.debris);
    this.held.apply(me);

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
      } else if (ev.t === "fling") {
        whooshSound();
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

  /* what's in their hand, for everyone to see: mid-ritual the cigar sits at
     the mouth (puffing smoke as progress accrues) and the bottle tips back
     with the pour; a finished empty rests in the hand until they fling it */
  private reconcileViceProp(av: AvatarView, p: PlayerSnap): void {
    const key = p.ritual ? "ritual:" + p.ritual.kind : p.held ? "held:" + p.held.kind : null;
    if (key !== av.propKey) {
      if (av.prop) av.group.remove(av.prop);
      av.prop = null;
      av.propKey = key;
      av.lastProgress = 0;
      if (key) {
        av.prop = key.endsWith("beer") ? makeBottleMesh() : makeCigarMesh(key.startsWith("held"));
        av.group.add(av.prop);
      }
    }
    if (!av.prop) return;
    if (p.ritual) {
      const t = p.ritual.progress;
      if (p.ritual.kind === "beer") {
        av.prop.position.set(0.13, 1.04 + t * 0.14, 0.21);
        av.prop.rotation.set(-(0.15 + t * 1.1), 0, 0.15);
      } else {
        av.prop.position.set(0.1, 1.17, 0.18);
        av.prop.rotation.set(-1.1, 0, 0.35);
        if (t > av.lastProgress && Math.random() < 0.35) {
          av.group.updateMatrixWorld(true);
          this.smoke.emit(av.prop.localToWorld(new THREE.Vector3(0, 0.062, 0)));
        }
      }
      av.lastProgress = t;
    } else {
      // the spent empty dangles from the hand
      av.prop.position.set(0.16, 0.88, 0.33);
      av.prop.rotation.set(0.9, 0, -0.5);
    }
  }

  /* ---------------- frame loop ---------------- */
  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    updateTweens(now);

    // heads ease toward their owner's actual camera ray — reproduced in
    // world space, so the avatar frame's lean can't skew the gaze
    const k = Math.min(1, dt * 10);
    for (const av of this.avatars.values()) {
      lookDir(av.seat, av.targetYaw, av.targetPitch, _dir);
      _m.lookAt(_dir, ORIGIN, UP); // basis with +Z along the gaze ray
      _q.setFromRotationMatrix(_m);
      av.group.getWorldQuaternion(_qParent).invert();
      av.head.quaternion.slerp(_qParent.multiply(_q), k);
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
    this.debrisView.frame(dt);
    this.held.frame(dt);
    this.smoke.frame(dt);
    this.cash.frame(dt);
    this.points.frame(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.frame());
  }
}

/* A regular at the table, still built from primitives: slumped torso, arms
   resting toward the felt, hat, and just enough face to read a stare. The
   group's +Z is the front (lookAt points it at the table). Everything above
   the shoulders lives in `head`, pivoted at the neck, so a remote player's
   look direction turns the whole face, eyes, and hat together. `seated`
   adds thighs on the stool; the dealer stands, hidden behind the table. */
function makeFigure(
  shirt: number,
  skin: number,
  opts: { hat?: number; seated?: boolean } = {}
): { group: THREE.Group; head: THREE.Group } {
  const g = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.75 });
  const darkMat = new THREE.MeshStandardMaterial({ color: opts.hat ?? 0x17130d, roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.36, 4, 12), shirtMat);
  body.position.y = 0.85;
  body.rotation.x = 0.08; // a slump — nobody here sits up straight
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Group();
  head.position.y = 1.26;
  g.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skinMat);
  skull.castShadow = true;
  head.add(skull);

  // eyes: fixed on the table like everything else in their life
  const eyeGeo = new THREE.SphereGeometry(0.014, 6, 6);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14100a, roughness: 0.35 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(s * 0.042, 0.015, 0.1);
    head.add(eye);
  }

  // hat: brim + tapered crown, tipped a touch — silhouette does the work
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.014, 18), darkMat);
  brim.position.y = 0.075;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.098, 0.1, 14), darkMat);
  crown.position.y = 0.13;
  brim.castShadow = crown.castShadow = true;
  const hat = new THREE.Group();
  hat.add(brim, crown);
  hat.position.y = 0.01;
  hat.rotation.z = 0.09;
  head.add(hat);

  // arms slanting from the shoulders down toward the felt, hands at the ends
  const armGeo = new THREE.CapsuleGeometry(0.048, 0.24, 3, 8);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, shirtMat);
    arm.position.set(s * 0.175, 0.945, 0.165);
    arm.rotation.x = 2.0;
    arm.rotation.z = s * -0.22;
    arm.castShadow = true;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skinMat);
    hand.position.set(s * 0.14, 0.85, 0.33);
    hand.castShadow = true;
    g.add(arm, hand);
  }

  if (opts.seated !== false) {
    const legGeo = new THREE.CapsuleGeometry(0.065, 0.2, 3, 8);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, darkMat);
      leg.position.set(s * 0.085, 0.47, 0.14);
      leg.rotation.x = 1.35;
      leg.castShadow = true;
      g.add(leg);
    }
  }
  return { group: g, head };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
