import type { Intent } from "@shared/types";
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
const ritual = new RitualControl(send, scene);
const menu = new MenuControl(startSession);

function startSession(s: Session): void {
  session = s;
  // the menu stays on stage until the first snapshot has routed the scene
  // (table vs waiting room) — hiding it on join would flash the den for a
  // beat before a lobby join lands in the waiting room
  let arrived = false;

  s.onSnapshot((snap) => {
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
  $("optionsScreen").classList.toggle("active", on);
  $("optionsScreen").classList.toggle("from-menu", !session);
};

$("optionsBtn").addEventListener("click", () => toggleOptions(!optionsOpen()));
$("titleOptionsBtn").addEventListener("click", () => toggleOptions(true));
$("resumeBtn").addEventListener("click", () => {
  toggleOptions(false);
  scene.capturePointer(); // straight back into mouse-look, either room
});
$("optionsBackBtn").addEventListener("click", () => toggleOptions(false));
$("leaveBtn").addEventListener("click", () => session?.leave()); // onEnd does the rest

/* Esc in the lobby wears two hats and the browser gets first grab: while
   the pointer is locked, Esc only exits the lock (the keydown never
   reaches us), so a lock loss over the lobby IS the menu request */
let lastLockExit = 0;
let lastEscClose = 0;
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement) return;
  lastLockExit = performance.now();
  // the lock exit rode the same Esc press that just closed the menu — a
  // close must stay a close, not bounce the menu straight back open
  if (performance.now() - lastEscClose < 350) return;
  if (session && scene.inLobby && !optionsOpen()) toggleOptions(true);
});
addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // an engine that DOES deliver the lock-exiting Esc mustn't double-toggle
  if (optionsOpen() && performance.now() - lastLockExit < 350) return;
  if (session) {
    const opening = !optionsOpen();
    toggleOptions(opening);
    if (!opening) {
      lastEscClose = performance.now();
      scene.capturePointer(); // best effort — Esc grants no gesture
    }
  } else if (optionsOpen()) toggleOptions(false);
});

/* audio: per-category volume (master / music / effects) + mute, persisted
   by effects.ts */
for (const [inputId, valId, channel] of [
  ["masterVolInput", "masterVolVal", "master"],
  ["musicVolInput", "musicVolVal", "music"],
  ["sfxVolInput", "sfxVolVal", "effects"],
] as const) {
  const input = $(inputId) as HTMLInputElement;
  const val = $(valId);
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
muteChk.checked = getMuted();
muteChk.addEventListener("change", () => {
  setMuted(muteChk.checked);
  if (!muteChk.checked) pickupSound();
});

// testing hook: lets headless UI tests project world coords to screen px
(window as unknown as { __scene: unknown }).__scene = scene;
// testing hook: drive intents without synthesizing drag gestures
(window as unknown as { __send: unknown }).__send = send;
