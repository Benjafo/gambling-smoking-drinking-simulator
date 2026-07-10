import type { Intent } from "@shared/types";
import type { Session } from "./transport";
import { SceneView } from "./render/scene";
import { Hud } from "./ui/hud";
import { MenuControl } from "./ui/menu";
import { RitualControl } from "./ui/ritual";

const $ = (id: string): HTMLElement => document.getElementById(id)!;

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

/* ---------------- settings ---------------- */
const settingsOpen = () => $("settingsScreen").classList.contains("active");
const toggleSettings = (on: boolean) => $("settingsScreen").classList.toggle("active", on);

$("settingsBtn").addEventListener("click", () => toggleSettings(!settingsOpen()));
$("resumeBtn").addEventListener("click", () => toggleSettings(false));
$("leaveBtn").addEventListener("click", () => session?.leave()); // onEnd does the rest
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && session) toggleSettings(!settingsOpen());
});

// testing hook: lets headless UI tests project world coords to screen px
(window as unknown as { __scene: unknown }).__scene = scene;
