import type { Intent, Snapshot } from "@shared/types";
import type { Session } from "./transport";
import {
  getMuted,
  getVolume,
  pickupSound,
  setMuted,
  setVolume,
} from "./render/effects";
import { SceneView } from "./render/scene";
import { Hud } from "./ui/hud";
import { MenuControl } from "./ui/menu";
import { MirrorControl } from "./ui/mirror";
import { RitualControl } from "./ui/ritual";

const $ = (id: string): HTMLElement => document.getElementById(id)!;

/* the 3D room bakes its signs into canvas textures at construction, so the
   pixel fonts must be resolvable first; the race keeps a busted font file
   from ever blocking boot */
await Promise.race([
  Promise.all([
    document.fonts.load('700 64px "Pixelify Sans"'),
    document.fonts.load('32px "VT323"'),
    document.fonts.load('9px "Silkscreen"'),
    document.fonts.load('700 9px "Silkscreen"'),
  ]),
  new Promise((resolve) => setTimeout(resolve, 2500)),
]).catch(() => undefined);

/* one scene/hud/ritual for the app's lifetime; sessions come and go and the
   send indirection routes intents to whichever one is live */
let session: Session | null = null;
const send = (i: Intent) => session?.send(i);
const scene = new SceneView($("stage"), send);
const hud = new Hud(send);
const ritual = new RitualControl(send, scene, (why, kind) => {
  if (why === "handsFull") hud.handsFull();
  else if (why === "machineFirst") hud.machineFirst();
  else hud.outOfStock(kind);
});
const menu = new MenuControl(startSession);
const mirror = new MirrorControl();
let latestSnap: Snapshot | null = null;

/* E at the waiting-room closet: the same customizer, but editing THIS
   stay's look — changes stream to the table as setAppearance intents and
   the saved menu look stays untouched */
scene.lobbyRoom.onOpenCloset = () => {
  const me = latestSnap?.players.find((p) => p.id === session?.playerId);
  if (!me) return;
  document.exitPointerLock?.();
  mirror.showForLobby(
    me.appearance,
    (a) => send({ type: "setAppearance", appearance: a }),
    // arm the pending-look recapture rather than raw-requesting a lock: a
    // BACK click's activation upgrades it instantly, and an Esc close gets
    // the same hidden-cursor free look as an Esc-closed menu
    () => armRecapture()
  );
};

function startSession(s: Session): void {
  session = s;
  // the menu stays on stage until the first snapshot has routed the scene
  // (table vs waiting room) — hiding it on join would flash the den for a
  // beat before a lobby join lands in the waiting room
  let arrived = false;

  s.onSnapshot((snap) => {
    latestSnap = snap;
    // the run ending puts buttons on screen — pending free look mustn't
    // keep the cursor hidden over the leaderboard
    if (recaptureArmed && snap.phase === "over") disarmRecapture();
    scene.apply(snap, s.playerId);
    if (!arrived) {
      arrived = true;
      hud.sessionStart(s.tableName);
      $("optionsBtn").classList.add("active");
      menu.hide();
    }
    hud.apply(snap, s.playerId);
    ritual.update(snap.players.find((p) => p.id === s.playerId));
    // debugging/testing hook: latest authoritative state, read-only by convention
    (window as unknown as { __snap: unknown }).__snap = snap;
  });

  s.onEnd((reason) => {
    session = null;
    latestSnap = null;
    disarmRecapture(); // ...nor a hidden one
    document.exitPointerLock?.(); // a lost connection mustn't strand a locked cursor
    ritual.update(undefined); // cancel any half-finished gesture overlay
    hud.sessionEnd();
    scene.sessionEnded(); // menu backdrop = the boot den: default chair, no leftovers
    $("optionsBtn").classList.remove("active");
    $("optionsScreen").classList.remove("active");
    menu.show(reason === "lost" ? "CONNECTION TO THE TABLE LOST." : undefined);
  });
}

/* ---------------- options ----------------
   reachable from the title screen too; "from-menu" swaps the in-game
   resume/leave slabs for a plain BACK */
const optionsOpen = () => $("optionsScreen").classList.contains("active");
const toggleOptions = (on: boolean) => {
  if (on) disarmRecapture(); // an opening menu wants the cursor back
  $("optionsScreen").classList.toggle("active", on);
  $("optionsScreen").classList.toggle("from-menu", !session);
  // a fresh open always starts at the top, not wherever it was left
  if (on) $("optionsScreen").scrollTop = 0;
};

$("optionsBtn").addEventListener("click", () => toggleOptions(!optionsOpen()));
$("titleOptionsBtn").addEventListener("click", () => toggleOptions(true));
$("resumeBtn").addEventListener("click", () => {
  toggleOptions(false);
  scene.capturePointer(); // straight back into mouse-look, either room
});
$("optionsBackBtn").addEventListener("click", () => toggleOptions(false));
$("leaveBtn").addEventListener("click", () => session?.leave()); // onEnd does the rest

/* Esc carries no user activation, so the relock after an Esc-close usually
   bounces off the browser. armRecapture() doesn't wait for one: it hides
   the cursor and flips the rooms' lookPending flag, so free look runs on
   raw mouse deltas IMMEDIATELY — then it shops for a gesture the browser
   will sell a real lock for (once right away, in case a menu click's
   activation is still spendable; once after the ~1.3s post-Esc cooldown
   some engines enforce; and on the next key or non-UI click). Disarms the
   moment a real lock lands or a screen takes the cursor back. */
let recaptureArmed = false;
let recaptureTimer = 0;
const disarmRecapture = () => {
  recaptureArmed = false;
  clearTimeout(recaptureTimer);
  document.body.classList.remove("look-pending");
  scene.setLookPending(false);
};
const tryRecapture = () => {
  if (!recaptureArmed) return;
  const wanted =
    session &&
    !optionsOpen() &&
    !mirror.open() &&
    !$("overScreen").classList.contains("active");
  if (!wanted) return disarmRecapture();
  if (!document.pointerLockElement) scene.capturePointer();
};
const armRecapture = () => {
  recaptureArmed = true;
  document.body.classList.add("look-pending");
  scene.setLookPending(true);
  tryRecapture();
  clearTimeout(recaptureTimer);
  recaptureTimer = window.setTimeout(tryRecapture, 1400);
};
addEventListener(
  "pointerdown",
  (e) => {
    if ((e.target as HTMLElement)?.closest?.("button,input,label,a,select")) return;
    tryRecapture();
  },
  true
);

/* Esc wears two hats and the browser gets first grab: while the pointer
   is locked, Esc only exits the lock (the keydown never reaches us), so a
   lock loss over either room IS the menu request */
let lastLockExit = 0;
let lastEscClose = 0;
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement) {
    disarmRecapture(); // look is live again — stop hunting for a gesture
    return;
  }
  lastLockExit = performance.now();
  // the lock exit rode the same Esc press that just closed the menu — a
  // close must stay a close, not bounce the menu straight back open
  if (performance.now() - lastEscClose < 350) return;
  // the closet customizer releases the lock on purpose — not a menu request
  if (mirror.open()) return;
  // ...and so does the sim when the run ends (the leaderboard needs a cursor)
  if ($("overScreen").classList.contains("active")) return;
  // mid-recapture, a lock can be granted off lingering click activation and
  // torn straight back down by the same Esc press — that transient loss is
  // collateral of the chase, never a menu request
  if (recaptureArmed) return;
  if (session && !optionsOpen()) toggleOptions(true);
});
addEventListener("keydown", (e) => {
  if (e.key !== "Escape") {
    // any other key is a real gesture — the armed recapture can spend it
    if ((e.target as HTMLElement)?.tagName !== "INPUT") tryRecapture();
    return;
  }
  // an engine that DOES deliver the lock-exiting Esc mustn't double-toggle
  if (optionsOpen() && performance.now() - lastLockExit < 350) return;
  // the mirror fields its own Esc (and stops propagation) — this guard is
  // the backstop so a close can never double as an options toggle
  if (mirror.open()) return;
  if (session) {
    const opening = !optionsOpen();
    toggleOptions(opening);
    if (!opening) {
      lastEscClose = performance.now();
      armRecapture(); // Esc grants no gesture — chase the next one
    }
  } else if (optionsOpen()) toggleOptions(false);
});
// an Esc that closed the mirror gets the same bounce guard as an Esc that
// closed the menu: any transient lock loss it causes must stay quiet
mirror.onEscClose = () => {
  lastEscClose = performance.now();
};

/* audio: per-category volume (master / music / effects) + mute, persisted
   by effects.ts */
const audioRows: Element[] = [];
for (const [inputId, valId, channel] of [
  ["masterVolInput", "masterVolVal", "master"],
  ["musicVolInput", "musicVolVal", "music"],
  ["sfxVolInput", "sfxVolVal", "effects"],
] as const) {
  const input = $(inputId) as HTMLInputElement;
  const val = $(valId);
  audioRows.push(input.closest(".audio-row")!);
  input.value = String(Math.round(getVolume(channel) * 100));
  val.textContent = input.value + "%";
  input.addEventListener("input", () => {
    setVolume(channel, Number(input.value) / 100);
    val.textContent = input.value + "%";
  });
  // preview blip on release so you hear where you landed — not for MUSIC,
  // whose bus a blip effect wouldn't pass through
  if (channel !== "music")
    input.addEventListener("change", () => {
      if (!getMuted()) pickupSound();
    });
}
const muteChk = $("sfxMuteChk") as HTMLInputElement;
// mute greys the whole mixer so the sliders themselves say nobody's listening
const syncMuteUi = () =>
  audioRows.forEach((r) => r.classList.toggle("muted", getMuted()));
muteChk.checked = getMuted();
syncMuteUi();
muteChk.addEventListener("change", () => {
  setMuted(muteChk.checked);
  syncMuteUi();
  if (!muteChk.checked) pickupSound();
});

// testing hook: lets headless UI tests project world coords to screen px
(window as unknown as { __scene: unknown }).__scene = scene;
// testing hook: drive intents without synthesizing drag gestures
(window as unknown as { __send: unknown }).__send = send;
