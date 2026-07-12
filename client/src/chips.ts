/* The house chip standard: one paint per denomination, the same everywhere
   money shows — the HUD rack, the bet stacks on the felt, the payout slide.
   Casino convention where one exists ($5 red, $25 green, $100 black, $500
   purple, $1K gold), invented-but-fixed above that, all muted to the den's
   palette. */

export interface ChipStyle {
  value: number;
  color: string; // body paint
  edge: string; // the stripes on the rim and the dashed ring on the face
  ink: string; // the printed denomination
}

const PAPER = "#ded8c2";
const DARK = "#241f12";

/* largest first — chipBreakdown walks this greedily, which is also stack
   order (big chips cut to the bottom) */
export const CHIP_STYLES: ChipStyle[] = [
  { value: 1_000_000, color: "#33121a", edge: "#ffc832", ink: "#ffc832" },
  { value: 500_000, color: "#4a4266", edge: PAPER, ink: PAPER },
  { value: 250_000, color: "#8a5a52", edge: DARK, ink: PAPER },
  { value: 100_000, color: "#23303c", edge: PAPER, ink: PAPER },
  { value: 50_000, color: "#6e1a2e", edge: PAPER, ink: PAPER },
  { value: 25_000, color: "#5d6b2b", edge: DARK, ink: PAPER },
  { value: 10_000, color: "#46525c", edge: PAPER, ink: PAPER },
  { value: 5_000, color: "#6b4226", edge: PAPER, ink: PAPER },
  { value: 2_500, color: "#2f6b68", edge: PAPER, ink: PAPER },
  { value: 1_000, color: "#a8862c", edge: DARK, ink: DARK },
  { value: 500, color: "#5a3a72", edge: PAPER, ink: PAPER },
  { value: 250, color: "#92485e", edge: PAPER, ink: PAPER },
  { value: 100, color: "#1c1c1c", edge: "#ffc832", ink: PAPER },
  { value: 50, color: "#a8622a", edge: PAPER, ink: PAPER },
  { value: 25, color: "#37704a", edge: PAPER, ink: PAPER },
  { value: 10, color: "#31517e", edge: PAPER, ink: PAPER },
  { value: 5, color: "#8e3231", edge: PAPER, ink: PAPER },
  { value: 1, color: "#b8b09a", edge: DARK, ink: DARK },
];

export function chipLabel(n: number): string {
  return n >= 1000 ? n / 1000 + "K" : "$" + n;
}

/* the paint for a denomination (exact rungs in practice; anything odd wears
   the biggest chip that fits it) */
export function chipStyle(value: number): ChipStyle {
  return CHIP_STYLES.find((s) => s.value <= value) ?? CHIP_STYLES[CHIP_STYLES.length - 1];
}

/* make change the way the cage would: greedy, big chips first. Capped so a
   whale's bet stays a plausible tower instead of a chimney — the small
   change is what gets waved off. */
export function chipBreakdown(amount: number, cap = 14): ChipStyle[] {
  const out: ChipStyle[] = [];
  let left = Math.floor(amount);
  for (const s of CHIP_STYLES) {
    while (left >= s.value && out.length < cap) {
      out.push(s);
      left -= s.value;
    }
    if (out.length >= cap) break;
  }
  return out;
}
