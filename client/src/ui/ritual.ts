/* The vice rituals, faithful to the 2D game: drag the cigar/bottle to the
   target ring mid-screen, then HOLD STILL to light the cigar, or SWIPE UP
   AND HOLD to pour the beer. The 3D ghost follows the pointer; the sim owns
   the clock (progress only accrues while we report the gesture engaged). */
import { Vector2 } from "three";
import type { Intent, PlayerSnap, ViceKind } from "@shared/types";
import type { SceneView } from "../render/scene";

const TARGET_RADIUS = 75; // px from target center that counts as "in the zone"
const STILL_TOLERANCE = 18; // px of wobble before the lighter gives up
const SWIPE_MIN = 60; // px of upward swipe to start pouring
const SIDE_CANCEL = 220; // px sideways drift that spills the attempt
const RING_C = 339.3;

const $ = (id: string): HTMLElement => document.getElementById(id)!;

export class RitualControl {
  private active: ViceKind | null = null;
  /* "fling" = ritual finished but the pointer is still down: the fresh
     empty is grabbed in place, events route to the held-item control */
  private phase: "drag" | "hold" | "primed" | "pouring" | "fling" = "drag";
  private auto = false;
  private sawRitual = false; // sim confirmed the ritual started
  private anchorX = 0;
  private anchorY = 0;
  private baseY = 0;
  private spillTimer: number | undefined;
  private items: Record<ViceKind, HTMLElement>;
  private ringFg: SVGCircleElement;
  /* which vice key is currently held down — the pointer-lock ritual path */
  private holdKey: ViceKind | null = null;

  constructor(
    private send: (i: Intent) => void,
    private scene: SceneView
  ) {
    this.items = { cigar: $("cigarItem"), beer: $("beerItem") };
    this.ringFg = document.querySelector("#dropTarget .ring-fg") as SVGCircleElement;
    this.bind("cigar");
    this.bind("beer");
    this.bindKeys();
  }

  /* hold-to-do-it keys: 1 lights the cigar, 2 pours the beer — the path
     for pointer-locked play, where there's no cursor to drag the item
     with. Keydown starts the ritual engaged (the sim runs the clock);
     releasing before it finishes spills the attempt, exactly like
     dropping the drag gesture. */
  private bindKeys(): void {
    const kinds: Record<string, ViceKind> = { Digit1: "cigar", Digit2: "beer" };
    addEventListener("keydown", (e) => {
      const kind = kinds[e.code];
      if (!kind || e.repeat || this.active) return;
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      // table chrome only: no HUD (menu) or waiting room (nothing to smoke)
      if (!$("hud").classList.contains("active")) return;
      if (document.body.classList.contains("lobby-room")) return;
      if (this.items[kind].classList.contains("disabled")) return;
      this.holdKey = kind;
      this.start(kind, 0, 0, true);
      $("targetLabel").textContent = kind === "cigar" ? "KEEP HOLDING 1…" : "KEEP HOLDING 2…";
    });
    addEventListener("keyup", (e) => {
      const kind = kinds[e.code];
      if (!kind || this.holdKey !== kind) return;
      this.holdKey = null;
      if (this.active === kind) this.cancel(); // let go early: it spills
    });
    // alt-tabbing away mustn't leave a drink pouring itself forever
    addEventListener("blur", () => {
      if (this.holdKey && this.active === this.holdKey) this.cancel();
      this.holdKey = null;
    });
  }

  private targetCenter(): { x: number; y: number } {
    return { x: innerWidth / 2, y: innerHeight * 0.45 };
  }
  private inZone(x: number, y: number): boolean {
    const c = this.targetCenter();
    return Math.hypot(x - c.x, y - c.y) <= TARGET_RADIUS;
  }
  private ndc(x: number, y: number): [number, number] {
    return [(x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1];
  }
  private setRing(p: number): void {
    this.ringFg.style.strokeDashoffset = String(RING_C * (1 - Math.max(0, Math.min(1, p))));
  }

  /* ---------------- binding ---------------- */
  private bind(kind: ViceKind): void {
    const item = this.items[kind];
    item.addEventListener("pointerdown", (e) => {
      if (item.classList.contains("disabled") || this.active) return;
      e.preventDefault();
      try {
        item.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointers can't be captured */
      }
      this.start(kind, e.clientX, e.clientY, false);
    });
    item.addEventListener("pointermove", (e) => {
      if (this.active !== kind || this.auto) return;
      if (this.phase === "fling")
        this.scene.held.pointerMove(new Vector2(...this.ndc(e.clientX, e.clientY)));
      else this.gestureMove(e.clientX, e.clientY);
    });
    const drop = () => {
      if (this.active !== kind || this.auto) return;
      if (this.phase === "fling") {
        this.scene.held.pointerUp(); // fling on a flick, drop in place otherwise
        this.cleanup();
      } else {
        this.cancel();
      }
    };
    item.addEventListener("pointerup", drop);
    item.addEventListener("pointercancel", drop);
    // keyboard fallback: same time cost, hands-free ritual
    item.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && !item.classList.contains("disabled") && !this.active) {
        e.preventDefault();
        this.start(kind, 0, 0, true);
      }
    });
  }

  /* ---------------- lifecycle ---------------- */
  private start(kind: ViceKind, x: number, y: number, auto: boolean): void {
    this.active = kind;
    this.phase = "drag";
    this.auto = auto;
    this.sawRitual = false;
    this.send({ type: "consumeStart", kind });

    this.items[kind].classList.add("held");
    $("dropTarget").classList.add("show");
    $("dropTarget").classList.remove("armed");
    $("targetLabel").textContent = kind === "cigar" ? "HOLD CIGAR HERE" : "BRING BEER HERE";
    this.setRing(0);
    this.scene.showRitualGhost(kind);

    if (auto) {
      // hands-free: park the ghost on the target and let the sim run the clock
      const c = this.targetCenter();
      this.scene.moveRitualGhost(...this.ndc(c.x, c.y), kind === "beer" ? 1.6 : 0);
      $("dropTarget").classList.add("armed");
      $("targetLabel").textContent = kind === "cigar" ? "LIGHTING…" : "POURING…";
      this.send({ type: "ritualEngage", on: true });
      if (kind === "beer") this.startSpill();
      else this.showLighter();
    } else {
      this.gestureMove(x, y);
    }
  }

  private gestureMove(x: number, y: number): void {
    if (this.active === "cigar") this.cigarMove(x, y);
    else if (this.active === "beer") this.beerMove(x, y);
  }

  private cigarMove(x: number, y: number): void {
    this.scene.moveRitualGhost(...this.ndc(x, y), 0);
    const inZone = this.inZone(x, y);
    if (this.phase === "drag" && inZone) {
      this.phase = "hold";
      this.anchorX = x;
      this.anchorY = y;
      this.send({ type: "ritualEngage", on: true });
      $("dropTarget").classList.add("armed");
      $("targetLabel").textContent = "HOLD STILL…";
      this.showLighter();
    } else if (this.phase === "hold") {
      if (!inZone) {
        this.phase = "drag";
        this.send({ type: "ritualEngage", on: false });
        this.send({ type: "ritualReset" });
        this.setRing(0);
        $("dropTarget").classList.remove("armed");
        $("targetLabel").textContent = "HOLD CIGAR HERE";
        this.scene.hideRitualLighter();
      } else if (Math.hypot(x - this.anchorX, y - this.anchorY) > STILL_TOLERANCE) {
        // wobbled: the flame restarts
        this.anchorX = x;
        this.anchorY = y;
        this.send({ type: "ritualReset" });
        this.setRing(0);
      }
      if (this.phase === "hold") this.showLighter();
    }
  }

  private beerMove(x: number, y: number): void {
    const c = this.targetCenter();
    if (this.phase === "drag") {
      this.scene.moveRitualGhost(...this.ndc(x, y), 0);
      if (this.inZone(x, y)) {
        this.phase = "primed";
        this.baseY = y;
        $("dropTarget").classList.add("armed");
        $("targetLabel").textContent = "NOW SWIPE UP & HOLD";
        $("swipeHint").classList.add("show");
      }
      return;
    }
    // primed / pouring: bottle stays planted at the target; swipe drives the tilt
    const dy = Math.max(0, this.baseY - y);
    const tiltDeg = Math.min(110, dy);
    this.scene.moveRitualGhost(
      ...this.ndc(c.x, c.y - Math.min(40, dy * 0.3)),
      (tiltDeg * Math.PI) / 180
    );
    if (dy >= SWIPE_MIN && this.phase === "primed") {
      this.phase = "pouring";
      this.send({ type: "ritualEngage", on: true });
      $("swipeHint").classList.remove("show");
      $("targetLabel").textContent = "KEEP HOLDING…";
      this.startSpill();
    } else if (dy < SWIPE_MIN && this.phase === "pouring") {
      this.phase = "primed"; // tipped back down: pause the pour, keep progress
      this.send({ type: "ritualEngage", on: false });
      $("swipeHint").classList.add("show");
      $("targetLabel").textContent = "SWIPE BACK UP…";
      this.stopSpill();
    }
    // wandered way off sideways: spill the attempt
    if (Math.abs(x - c.x) > SIDE_CANCEL) this.cancel();
  }

  /* called on every snapshot with our player */
  update(me: PlayerSnap | undefined): void {
    if (!this.active || this.phase === "fling") return;
    const ritual = me?.ritual ?? null;
    if (ritual) {
      this.sawRitual = true;
      this.setRing(ritual.progress);
      // ambient puffs while the cigar takes the flame
      if (this.active === "cigar" && ritual.progress > 0 && Math.random() < 0.35)
        this.scene.emitSmokeAtGhost();
    } else if (this.sawRitual) {
      // sim ended it: completed — meter refilled, empty now in hand
      for (let i = 0; i < 3; i++) this.scene.emitSmokeAtGhost();
      const ghostPos = this.scene.ritualGhostWorldPos();
      if (!this.auto && me?.held && ghostPos) {
        // pointer is still down (the gesture requires it): hand the fresh
        // empty straight into the grab — fling or drop from right here
        this.hideChrome();
        this.scene.held.grabAt(ghostPos);
        this.phase = "fling";
        this.sawRitual = false;
      } else {
        this.cleanup(); // hands-free ritual: the empty idles in the hand
      }
    }
  }

  private cancel(): void {
    this.send({ type: "consumeCancel" });
    this.cleanup();
  }

  /* hide all ritual UI without ending the interaction (fling phase keeps
     routing pointer events) */
  private hideChrome(): void {
    if (this.active) this.items[this.active].classList.remove("held");
    this.stopSpill();
    this.setRing(0);
    this.scene.hideRitualGhost();
    $("dropTarget").classList.remove("show", "armed");
    $("swipeHint").classList.remove("show");
    this.scene.hideRitualLighter();
  }

  private cleanup(): void {
    this.hideChrome();
    this.active = null;
    this.auto = false;
    this.sawRitual = false;
    this.phase = "drag";
  }

  /* ---------------- flourishes ---------------- */
  /* the 3D zippo rises to the cigar's lit end and runs its open/strike/
     burn sequence; the scene keeps it tracked to the ember every frame */
  private showLighter(): void {
    this.scene.showRitualLighter();
  }

  private startSpill(): void {
    if (this.spillTimer) return;
    this.spillTimer = window.setInterval(() => {
      if (Math.random() > 0.65) return;
      const c = this.targetCenter();
      const n = 1 + (Math.random() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const drop = document.createElement("div");
        drop.className = "spill-drop";
        drop.style.left = c.x + (Math.random() * 40 - 20) + "px";
        drop.style.top = c.y - 100 + (Math.random() * 18 - 9) + "px";
        drop.style.setProperty("--sx", Math.random() * 180 - 90 + "px");
        drop.style.setProperty("--sy", 100 + Math.random() * 180 + "px");
        document.body.appendChild(drop);
        setTimeout(() => drop.remove(), 700);
      }
    }, 90);
  }
  private stopSpill(): void {
    if (this.spillTimer) clearInterval(this.spillTimer);
    this.spillTimer = undefined;
  }
}
