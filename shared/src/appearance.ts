/* Player appearance: what THE MIRROR edits, the join intent carries, and
   every client renders. All fields are palette/style INDICES, never raw
   colors — the sim clamps them through sanitizeAppearance, so a doctored
   client can't paint outside the room's register (an all-black figure in a
   dark bar is an invisibility cheat, not a fashion statement). Palettes
   live here because the client needs the hexes and the sim needs the
   lengths. */

export interface Appearance {
  skin: number; // SKIN_TONES index
  shirt: number; // SHIRT_COLORS index
  pants: number; // PANTS_COLORS index
  hat: number; // hat style, HAT_BARE..; HAT_COLORS picks the color
  hatColor: number;
  accessory: number; // ACC_NONE..
}

export const SKIN_TONES = [
  0xe8c9a6, 0xd1a67e, 0xb08a5e,
  0x8a7560, // the house default — the regulars' washed-out tan
  0x9c6a45, 0x6f4a2e, 0x53341f, 0x3b2417,
];

/* the first five are the legacy seat colors — defaultAppearance deals them
   out by seat so an untouched player looks exactly like they always did */
export const SHIRT_COLORS = [
  0x4a3b2a, 0x2c3c60, 0x6a1f1f, 0x24512f, 0x3a3226,
  0x8a6d1e, 0x1f4f4a, 0x552e44, 0xd9d2c0, 0x262b33,
];
const SEAT_SHIRTS = 5;

export const PANTS_COLORS = [
  0x17130d, // the old shared dark — legs looked like this before pants existed
  0x1e2836, 0x33261a, 0x3c3b2e, 0x46231f, 0x6b5c3f,
];

export const HAT_COLORS = [
  0x17130d, // the old fedora dark
  0x1e3a28, 0x5c2020, 0x24365c, 0x6b5427, 0x413c35,
];

/* hat styles — indices into whatever silhouettes the client builds */
export const HAT_BARE = 0;
export const HAT_FEDORA = 1;
export const HAT_FLATCAP = 2;
export const HAT_COWBOY = 3;
export const HAT_VISOR = 4;
export const HAT_STYLE_COUNT = 5;

export const ACC_NONE = 0;
export const ACC_SHADES = 1;
export const ACC_MUSTACHE = 2;
export const ACC_EAR_CIGAR = 3;
export const ACC_CHAIN = 4;
export const ACCESSORY_COUNT = 5;

export function defaultAppearance(seat = 0): Appearance {
  return {
    skin: 3,
    shirt: ((seat % SEAT_SHIRTS) + SEAT_SHIRTS) % SEAT_SHIRTS,
    pants: 0,
    hat: HAT_FEDORA,
    hatColor: 0,
    accessory: ACC_NONE,
  };
}

const idx = (v: unknown, len: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(len - 1, Math.max(0, Math.floor(v)))
    : fallback;

/* the one choke point for untrusted appearances (wire joins, stale
   localStorage): every field lands inside its palette or on the default */
export function sanitizeAppearance(a: unknown, seat = 0): Appearance {
  const fb = defaultAppearance(seat);
  if (typeof a !== "object" || a === null) return fb;
  const o = a as Record<string, unknown>;
  return {
    skin: idx(o.skin, SKIN_TONES.length, fb.skin),
    shirt: idx(o.shirt, SHIRT_COLORS.length, fb.shirt),
    pants: idx(o.pants, PANTS_COLORS.length, fb.pants),
    hat: idx(o.hat, HAT_STYLE_COUNT, fb.hat),
    hatColor: idx(o.hatColor, HAT_COLORS.length, fb.hatColor),
    accessory: idx(o.accessory, ACCESSORY_COUNT, fb.accessory),
  };
}
