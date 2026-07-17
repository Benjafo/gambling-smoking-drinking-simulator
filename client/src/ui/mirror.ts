/* THE MIRROR: the bar restroom's character creator, off the title screen.
   Edits an Appearance (palette indices — see shared/appearance.ts), shows
   it on a live figure, and keeps it in localStorage; the menu reads it back
   with loadAppearance() whenever a seat is taken. Purely front-of-house:
   nothing here talks to a session, and the sim re-sanitizes whatever
   eventually arrives in a join. */
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

  constructor() {
    this.buildRows();
    $("titleMirrorBtn").addEventListener("click", () => this.show());
    $("mirrorBackBtn").addEventListener("click", () => this.hide());
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $("mirrorScreen").classList.contains("active")) this.hide();
    });
  }

  private show(): void {
    $("titleScreen").classList.remove("active");
    $("mirrorScreen").classList.add("active");
    // the glass warms up on first open and stays for the app's lifetime
    if (!this.view) this.view = new MirrorView($("mirrorStage"));
    this.view.setLook(this.look);
    this.view.start();
  }

  private hide(): void {
    this.view?.stop();
    $("mirrorScreen").classList.remove("active");
    $("titleScreen").classList.add("active");
  }

  private set(field: Field, value: number): void {
    this.look = sanitizeAppearance({ ...this.look, [field]: value });
    localStorage.setItem(STORE_KEY, JSON.stringify(this.look));
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
