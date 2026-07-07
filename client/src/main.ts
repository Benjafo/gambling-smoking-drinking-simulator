import { createTransport } from "./transport";
import { SceneView } from "./render/scene";
import { Hud } from "./ui/hud";
import { RitualControl } from "./ui/ritual";

const transport = createTransport();
const send = (i: Parameters<typeof transport.send>[0]) => transport.send(i);
const scene = new SceneView(document.getElementById("stage")!, send);
const hud = new Hud(send);
const ritual = new RitualControl(send, scene);

transport.onSnapshot((snap) => {
  scene.apply(snap, transport.playerId);
  hud.apply(snap, transport.playerId);
  ritual.update(snap.players.find((p) => p.id === transport.playerId));
  // debugging/testing hook: latest authoritative state, read-only by convention
  (window as unknown as { __snap: unknown }).__snap = snap;
});
// testing hook: lets headless UI tests project world coords to screen px
(window as unknown as { __scene: unknown }).__scene = scene;
