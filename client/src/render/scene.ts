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
import { CardZone } from "./cards";
import { DebrisView } from "./debris";
import { HeldItemControl, makeBottleMesh, makeCigarMesh } from "./held";
import { SmokeSystem, impactSound, dealSound, denySound } from "./effects";
import { updateTweens } from "./tween";

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
  held: HeldItemControl;
  private raycaster = new THREE.Raycaster();

  private ritualGhost: THREE.Group | null = null;
  private ritualRay = new THREE.Raycaster();
  private mySeat = 2;
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
    this.debrisView = new DebrisView(this.scene);
    this.held = new HeldItemControl(this.scene, this.camera, send);
    this.dealerZone = new CardZone(
      this.scene,
      new THREE.Vector3(0, TABLE.height + 0.004, -0.52),
      0,
      SHOE_POS,
      dealSound
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
    this.scene.add(new THREE.AmbientLight(0x342b1e, 1.4));
    const spot = new THREE.SpotLight(0xffdca8, 90, 14, Math.PI / 3.6, 0.55, 1.6);
    spot.position.set(0, 4.2, 0);
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
  }

  private buildRoom(): void {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(11, 40),
      new THREE.MeshStandardMaterial({ color: 0x1a140d, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  private buildTable(): void {
    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(TABLE.radius, TABLE.radius, 0.08, 48),
      new THREE.MeshStandardMaterial({ color: 0x1d4a30, roughness: 0.92 })
    );
    felt.position.y = TABLE.height - 0.04;
    felt.receiveShadow = true;
    felt.castShadow = true;

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(TABLE.rimRadius, TABLE.rimTube, 14, 48),
      new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.55 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = TABLE.height + TABLE.rimTube * 0.5;
    rim.castShadow = true;

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.5, TABLE.height - 0.08, 24),
      new THREE.MeshStandardMaterial({ color: 0x241809, roughness: 0.8 })
    );
    pedestal.position.y = (TABLE.height - 0.08) / 2;

    // the shoe
    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.14, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x241809, roughness: 0.5 })
    );
    shoe.position.copy(SHOE_POS);
    shoe.rotation.y = -0.25;
    shoe.castShadow = true;

    this.scene.add(felt, rim, pedestal, shoe);

    // stools at every seat
    for (let i = 0; i < SEAT_COUNT; i++) {
      const p = seatPosition(i);
      const stool = new THREE.Group();
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.06, 18),
        new THREE.MeshStandardMaterial({ color: 0x5d1517, roughness: 0.7 })
      );
      top.position.y = 0.62;
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.09, 0.62, 10),
        new THREE.MeshStandardMaterial({ color: 0x17130d, roughness: 0.6 })
      );
      leg.position.y = 0.31;
      stool.add(top, leg);
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
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.applyLook();
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
    this.scene.add(this.ritualGhost);
  }

  /* place the ghost on the pointer ray; tilt tips the bottle for the pour.
     The tip is around the view axis (screen-plane rotation, like the 2D
     game) with a touch of lean for depth — pitching it at the camera just
     reads as a dark disc. */
  moveRitualGhost(ndcX: number, ndcY: number, tilt: number): void {
    if (!this.ritualGhost) return;
    this.ritualRay.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    this.ritualGhost.position
      .copy(this.ritualRay.ray.origin)
      .addScaledVector(this.ritualRay.ray.direction, 0.9);
    this.ritualGhost.quaternion.copy(this.camera.quaternion);
    this.ritualGhost.rotateZ(0.25 + tilt);
    if (tilt !== 0) this.ritualGhost.rotateX(-tilt * 0.2);
  }

  emitSmokeAtGhost(): void {
    if (this.ritualGhost)
      this.smoke.emit(this.ritualGhost.position.clone().add(new THREE.Vector3(0, 0.09, 0)));
  }

  hideRitualGhost(): void {
    if (this.ritualGhost) this.scene.remove(this.ritualGhost);
    this.ritualGhost = null;
  }

  /* ---------------- snapshot reconcile ---------------- */
  apply(snap: Snapshot, myId: string): void {
    this.latest = snap;
    this.myId = myId;
    const me = snap.players.find((p) => p.id === myId);
    if (me && me.seat !== this.mySeat) this.setCameraSeat(me.seat);

    this.dealerZone.reconcile(snap.dealerHand);

    for (const p of snap.players) {
      let zone = this.playerZones.get(p.id);
      if (!zone) {
        const anchor = seatTablePoint(p.seat, 0.86);
        zone = new CardZone(
          this.scene,
          new THREE.Vector3(anchor.x, anchor.y + 0.004, anchor.z),
          seatAngle(p.seat),
          SHOE_POS,
          dealSound
        );
        this.playerZones.set(p.id, zone);
      }
      zone.reconcile(p.hand);
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
      if (ev.t === "impact") impactSound(ev.speed);
    }
  }

  private reconcileChips(p: PlayerSnap): void {
    const bet = p.committed ? p.bet : 0;
    let entry = this.chipStacks.get(p.id);
    if (!entry) {
      entry = { group: new THREE.Group(), bet: -1 };
      const spot = seatTablePoint(p.seat, 0.58);
      entry.group.position.set(spot.x, spot.y, spot.z);
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
    this.debrisView.frame(dt);
    this.held.frame(dt);
    this.smoke.frame(dt);
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
