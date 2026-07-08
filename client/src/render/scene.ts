/* The 3D den: table, seats, avatars, cards, chips, debris — plus the
   per-seat camera and pointer routing (grab > pickup > look). Everything
   here renders snapshots; nothing here mutates game state. */
import * as THREE from "three";
import {
  TABLE,
  SEAT_COUNT,
  DEALER_POS,
  REACH_RADIUS,
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
  impactSound,
  dealSound,
  denySound,
  cashSound,
  whooshSound,
  chipRiffleSound,
} from "./effects";
import { updateTweens, tween, easeInOut } from "./tween";

const CENTER = new THREE.Vector3(0, TABLE.height + 0.05, 0);
const SHOE_POS = new THREE.Vector3(0.72, TABLE.height + 0.09, -0.78);

export class SceneView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private dealerZone: CardZone;
  private playerZones = new Map<string, CardZone>();
  private chipStacks = new Map<string, { group: THREE.Group; bet: number }>();
  private avatars = new Map<number, THREE.Group>();
  private debrisView: DebrisView;
  private smoke: SmokeSystem;
  private cash: CashBurst;
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
    const g = makeFigure(0xd9d2c0, 0x17130d);
    g.position.set(DEALER_POS.x, 0, DEALER_POS.z);
    g.lookAt(0, 1.0, 0);
    this.scene.add(g);
  }

  private makeAvatar(seat: number): THREE.Group {
    const colors = [0x4a3b2a, 0x2c3c60, 0x6a1f1f, 0x24512f, 0x3a3226];
    const g = makeFigure(colors[seat % colors.length], 0x8a7560);
    const p = seatPosition(seat);
    g.position.set(p.x, 0.28, p.z);
    g.lookAt(0, 1.0, 0);
    this.scene.add(g);
    return g;
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
    const dir = CENTER.clone().sub(this.camera.position).normalize();
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yawOff);
    dir.applyQuaternion(yawQ);
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(right, this.pitchOff);
    dir.applyQuaternion(pitchQ);
    this.camera.lookAt(this.camera.position.clone().add(dir));
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
        this.yawOff = clamp(this.yawOff - (e.clientX - this.lastPointer.x) * 0.003, -0.85, 0.85);
        this.pitchOff = clamp(this.pitchOff + (e.clientY - this.lastPointer.y) * 0.003, -0.5, 0.35);
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.applyLook();
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
      this.reconcileChips(p);
      this.reconcileAvatar(p);
    }
    // players who left
    for (const [id, zone] of this.playerZones)
      if (!snap.players.some((p) => p.id === id)) {
        zone.clear();
        this.playerZones.delete(id);
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
        this.scene.remove(existing);
        this.avatars.delete(p.seat);
      }
      return;
    }
    if (!existing) this.avatars.set(p.seat, this.makeAvatar(p.seat));
  }

  /* ---------------- frame loop ---------------- */
  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    updateTweens(now);
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
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.frame());
  }
}

function makeFigure(shirt: number, skin: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.17, 0.36, 4, 12),
    new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 })
  );
  body.position.y = 0.85;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.115, 16, 12),
    new THREE.MeshStandardMaterial({ color: skin, roughness: 0.75 })
  );
  head.position.y = 1.26;
  head.castShadow = true;
  g.add(body, head);
  return g;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
