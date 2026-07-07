import { createTransport } from "./transport";
import { SceneView } from "./render/scene";
import { Hud } from "./ui/hud";

const transport = createTransport();
const scene = new SceneView(document.getElementById("stage")!, (i) => transport.send(i));
const hud = new Hud((i) => transport.send(i));

transport.onSnapshot((snap) => {
  scene.apply(snap, transport.playerId);
  hud.apply(snap, transport.playerId);
  // debugging/testing hook: latest authoritative state, read-only by convention
  (window as unknown as { __snap: unknown }).__snap = snap;
});
