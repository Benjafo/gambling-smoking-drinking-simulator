import type { Intent } from "@shared/types";
import type { Session } from "./transport";
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
  hud.sessionStart(s.tableName);
  $("settingsBtn").classList.add("active");

  s.onSnapshot((snap) => {
    scene.apply(snap, s.playerId);
    hud.apply(snap, s.playerId);
    ritual.update(snap.players.find((p) => p.id === s.playerId));
    // debugging/testing hook: latest authoritative state, read-only by convention
    (window as unknown as { __snap: unknown }).__snap = snap;
  });

  s.onEnd((reason) => {
    session = null;
    ritual.update(undefined); // cancel any half-finished gesture overlay
    hud.sessionEnd();
    $("settingsBtn").classList.remove("active");
    $("settingsScreen").classList.remove("active");
    menu.show(reason === "lost" ? "CONNECTION TO THE TABLE LOST." : undefined);
  });
}

/* ---------------- settings ----------------
   reachable from the title screen too; "from-menu" swaps the in-game
   resume/leave slabs for a plain BACK */
const settingsOpen = () => $("settingsScreen").classList.contains("active");
const toggleSettings = (on: boolean) => {
  $("settingsScreen").classList.toggle("active", on);
  $("settingsScreen").classList.toggle("from-menu", !session);
};

$("settingsBtn").addEventListener("click", () => toggleSettings(!settingsOpen()));
$("titleSettingsBtn").addEventListener("click", () => toggleSettings(true));
$("resumeBtn").addEventListener("click", () => toggleSettings(false));
$("settingsBackBtn").addEventListener("click", () => toggleSettings(false));
$("leaveBtn").addEventListener("click", () => session?.leave()); // onEnd does the rest
addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (session) toggleSettings(!settingsOpen());
  else if (settingsOpen()) toggleSettings(false);
});

// testing hook: lets headless UI tests project world coords to screen px
(window as unknown as { __scene: unknown }).__scene = scene;
