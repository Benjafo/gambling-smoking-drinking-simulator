/* Appearance: sanitization clamps whatever the wire delivers, joins without
   a look get the legacy seat-dealt default, and snapshots carry the result.
   Run with: npm run test:sim */
import {
  ACC_NONE,
  HAT_COLORS,
  HAT_FEDORA,
  HAT_STYLE_COUNT,
  SHIRT_COLORS,
  SKIN_TONES,
  defaultAppearance,
  sanitizeAppearance,
  type Appearance,
} from "../src/appearance";
import { Simulation } from "../src/sim";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

/* ---- sanitize: garbage in, defaults out ---- */
for (const garbage of [null, undefined, 42, "hat", [1, 2, 3]]) {
  const a = sanitizeAppearance(garbage, 1);
  assert(
    JSON.stringify(a) === JSON.stringify(defaultAppearance(1)),
    `non-object (${JSON.stringify(garbage) ?? "undefined"}) falls back to the seat default`
  );
}

/* ---- sanitize: every field clamped into its palette ---- */
const hostile = sanitizeAppearance({
  skin: 999,
  shirt: -5,
  pants: 2.9,
  hat: NaN,
  hatColor: HAT_COLORS.length,
  accessory: "chain",
});
assert(hostile.skin === SKIN_TONES.length - 1, "over-range index clamps to the last entry");
assert(hostile.shirt === 0, "negative index clamps to zero");
assert(hostile.pants === 2, "fractional index floors");
assert(hostile.hat === defaultAppearance().hat, "NaN falls back to the default");
assert(hostile.hatColor === HAT_COLORS.length - 1, "one-past-the-end clamps");
assert(hostile.accessory === defaultAppearance().accessory, "wrong type falls back");
assert(hostile.hat >= 0 && hostile.hat < HAT_STYLE_COUNT, "hat style lands in range");

/* ---- default look deals the legacy seat shirts ---- */
assert(defaultAppearance(0).shirt === 0 && defaultAppearance(4).shirt === 4, "seat picks the shirt");
assert(defaultAppearance(7).shirt === 2, "seats past the palette wrap");
assert(defaultAppearance().hat === HAT_FEDORA, "the house default wears the fedora");
assert(SKIN_TONES[defaultAppearance().skin] === 0x8a7560, "default skin is the legacy tan");
assert(
  JSON.stringify(SHIRT_COLORS.slice(0, 5)) ===
    JSON.stringify([0x4a3b2a, 0x2c3c60, 0x6a1f1f, 0x24512f, 0x3a3226]),
  "first five shirts are the legacy seat colors"
);

/* ---- through the sim: join carries it, snapshot echoes it ---- */
const sim = await Simulation.create(1234);
const picked: Appearance = { skin: 6, shirt: 8, pants: 3, hat: 3, hatColor: 2, accessory: 4 };
sim.applyIntent("p1", { type: "join", name: "DAPPER", appearance: picked });
sim.applyIntent("p2", { type: "join", name: "PLAIN" });
sim.applyIntent("p3", {
  type: "join",
  name: "CHEATER",
  appearance: { skin: -1, shirt: 1e9, pants: 0, hat: 0, hatColor: 0, accessory: 0 },
});
const snap = sim.snapshot();
const byName = (n: string) => snap.players.find((p) => p.name === n)!;
assert(
  JSON.stringify(byName("DAPPER").appearance) === JSON.stringify(picked),
  "a legal look survives the join untouched"
);
const plain = byName("PLAIN");
assert(
  JSON.stringify(plain.appearance) === JSON.stringify(defaultAppearance(plain.seat)),
  "no look at join means the seat-dealt default"
);
const cheat = byName("CHEATER").appearance;
assert(
  cheat.skin === 0 && cheat.shirt === SHIRT_COLORS.length - 1 && cheat.accessory === ACC_NONE,
  "a doctored look is clamped, not trusted"
);

console.log("\nALL APPEARANCE TESTS PASSED");
