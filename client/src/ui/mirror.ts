/* THE MIRROR: the character customizer, wearing two hats of its own.
   From the title screen (CUSTOMIZE) it edits the localStorage look that
   rides every join. From the waiting-room closet it edits the CURRENT
   stay's look instead — each change goes out as a setAppearance intent and
   localStorage is left alone, so the restyle lasts exactly until you leave
   the table. Either way the sim re-sanitizes whatever arrives. */
import {
  ACCESSORY_COUNT,
  HAT_BARE,
  HAT_COLORS,
  HAT_STYLE_COUNT,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  defaultAppearance,
  sanitizeAppearance,
  type Appearance,
} from "@shared/appearance";
import { MirrorView } from "../render/mirror";

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const STORE_KEY = "degen-look";

/* stale or hand-mangled storage must never break boot: parse, then clamp */
export function loadAppearance(): Appearance {
  try {
    return sanitizeAppearance(JSON.parse(localStorage.getItem(STORE_KEY) ?? "null"));
  } catch {
    return defaultAppearance();
  }
}

const HAT_NAMES = ["BARE HEAD", "FEDORA", "FLAT CAP", "COWBOY", "VISOR"];
const ACC_NAMES = ["NOTHING", "SHADES", "MUSTACHE", "EAR CIGAR", "GOLD CHAIN"];

/* one option row: either a strip of color swatches or a ◀ NAME ▶ stepper */
type Field = keyof Appearance;

export class MirrorControl {
  private look = loadAppearance();
  private view: MirrorView | null = null;
  private syncs: (() => void)[] = [];

  private spinOn = true;
  /* "menu" edits localStorage; "lobby" streams setAppearance intents */
  private mode: "menu" | "lobby" = "menu";
  private applyCb: ((a: Appearance) => void) | null = null;
  private closeCb: (() => void) | null = null;

  constructor() {
    this.buildRows();
    $("titleMirrorBtn").addEventListener("click", () => this.show());
    $("mirrorBackBtn").addEventListener("click", () => this.hide());
    $("mirrorSpinBtn").addEventListener("click", () => {
      this.spinOn = !this.spinOn;
      if (this.view) this.view.spin = this.spinOn;
      $("mirrorSpinBtn").textContent = this.spinOn ? "SPIN: ON" : "SPIN: OFF";
    });
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.open()) {
        this.hide();
        // registered before main.ts's Esc handler: a close must stay a
        // close, not become an options toggle on the same press
        e.stopImmediatePropagation();
      }
    });
  }

  open(): boolean {
    return $("mirrorScreen").classList.contains("active");
  }

  /* title-screen CUSTOMIZE: edit the saved look that rides future joins */
  private show(): void {
    this.mode = "menu";
    this.applyCb = this.closeCb = null;
    this.look = loadAppearance(); // a lobby restyle must not bleed in here
    $("titleScreen").classList.remove("active");
    this.openScreen();
  }

  /* waiting-room closet: edit this stay's look, live on everyone's screen */
  showForLobby(current: Appearance, apply: (a: Appearance) => void, onClose: () => void): void {
    this.mode = "lobby";
    this.applyCb = apply;
    this.closeCb = onClose;
    this.look = sanitizeAppearance(current);
    this.openScreen();
  }

  private openScreen(): void {
    $("mirrorScreen").classList.add("active");
    // the glass warms up on first open and stays for the app's lifetime
    if (!this.view) this.view = new MirrorView($("mirrorStage"));
    this.view.spin = this.spinOn;
    this.view.setLook(this.look);
    this.view.start();
    for (const s of this.syncs) s();
  }

  private hide(): void {
    this.view?.stop();
    $("mirrorScreen").classList.remove("active");
    if (this.mode === "menu") $("titleScreen").classList.add("active");
    else this.closeCb?.();
  }

  private set(field: Field, value: number): void {
    this.look = sanitizeAppearance({ ...this.look, [field]: value });
    if (this.mode === "menu") localStorage.setItem(STORE_KEY, JSON.stringify(this.look));
    else this.applyCb?.(this.look);
    this.view?.setLook(this.look);
    for (const s of this.syncs) s();
  }

  /* ---------------- rows ---------------- */
  private buildRows(): void {
    const rows = $("mirrorRows");
    this.swatchRow(rows, "SKIN", "skin", SKIN_TONES);
    this.swatchRow(rows, "SHIRT", "shirt", SHIRT_COLORS);
    this.swatchRow(rows, "PANTS", "pants", PANTS_COLORS);
    this.stepRow(rows, "HAT", "hat", HAT_NAMES, HAT_STYLE_COUNT);
    // no hat, no felt to color — the row greys out
    const felt = this.swatchRow(rows, "HAT FELT", "hatColor", HAT_COLORS);
    this.syncs.push(() => felt.classList.toggle("dim", this.look.hat === HAT_BARE));
    this.stepRow(rows, "EXTRAS", "accessory", ACC_NAMES, ACCESSORY_COUNT);
    for (const s of this.syncs) s();
  }

  private swatchRow(
    parent: HTMLElement,
    label: string,
    field: Field,
    palette: number[]
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "mirror-row";
    row.innerHTML = `<span class="field-label">${label}</span><div class="swatch-row"></div>`;
    const strip = row.lastElementChild as HTMLElement;
    const btns = palette.map((hex, i) => {
      const b = document.createElement("button");
      b.className = "swatch";
      b.style.background = "#" + hex.toString(16).padStart(6, "0");
      b.setAttribute("aria-label", `${label} option ${i + 1}`);
      b.addEventListener("click", () => this.set(field, i));
      strip.appendChild(b);
      return b;
    });
    this.syncs.push(() => btns.forEach((b, i) => b.classList.toggle("sel", this.look[field] === i)));
    parent.appendChild(row);
    return row;
  }

  private stepRow(
    parent: HTMLElement,
    label: string,
    field: Field,
    names: string[],
    count: number
  ): void {
    const row = document.createElement("div");
    row.className = "mirror-row";
    row.innerHTML =
      `<span class="field-label">${label}</span>` +
      `<div class="step-row">` +
      `<button class="menu-btn" data-dir="-1" aria-label="previous ${label}">&#9664;</button>` +
      `<span class="step-name"></span>` +
      `<button class="menu-btn" data-dir="1" aria-label="next ${label}">&#9654;</button>` +
      `</div>`;
    const name = row.querySelector(".step-name") as HTMLElement;
    row.querySelectorAll<HTMLButtonElement>("[data-dir]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const dir = Number(btn.dataset.dir);
        this.set(field, (this.look[field] + dir + count) % count);
      })
    );
    this.syncs.push(() => (name.textContent = names[this.look[field]]));
    parent.appendChild(row);
  }
}
