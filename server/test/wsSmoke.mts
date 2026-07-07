/* Connects to the running ws server as a real client, plays a hand, flings
   a bottle. Verifies the whole network path: welcome, intents, snapshots. */
import WebSocket from "ws";
import type { Snapshot } from "../../shared/src/types";

const url = process.env.WS_URL ?? "ws://localhost:8081";
const ws = new WebSocket(url);
let playerId = "";
let stage = 0;
const done = (msg: string) => {
  console.log("ok  :", msg);
};
const fail = (msg: string) => {
  console.error("FAIL:", msg);
  process.exit(1);
};
setTimeout(() => fail("timed out at stage " + stage), 30000);

ws.on("open", () => done("connected"));
ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.type === "welcome") {
    playerId = msg.playerId;
    done("welcomed as " + playerId);
    send({ type: "join", name: "WSTEST" });
    return;
  }
  if (msg.type !== "snapshot") return;
  const snap: Snapshot = msg.snap;
  const me = snap.players.find((p) => p.id === playerId);
  if (!me) return;

  if (stage === 0) {
    done("joined, seat " + me.seat + ", phase " + snap.phase);
    stage = 1;
    send({ type: "setBet", amount: 50 });
    send({ type: "commitBet" });
  } else if (stage === 1 && me.hand.length === 2) {
    done("cards dealt over the wire");
    stage = 2;
  } else if (stage === 2 && snap.phase === "acting" && snap.turnPlayerId === playerId) {
    send({ type: "stand" });
    stage = 3;
  } else if ((stage === 2 || stage === 3) && snap.phase === "betting" && snap.handsPlayed >= 1) {
    done("hand settled over the wire, money now " + me.money);
    stage = 4;
    send({ type: "consumeStart", kind: "beer" });
    send({ type: "ritualEngage", on: true });
  } else if (stage === 4 && me.held) {
    done("beer ritual completed, holding empty #" + me.held.id);
    stage = 5;
    send({
      type: "fling",
      itemId: me.held.id,
      origin: { x: 0, y: 1.3, z: 1.6 },
      vel: { x: -2, y: 3, z: -5 },
      angVel: { x: 5, y: 1, z: 4 },
    });
  } else if (stage === 5 && snap.debris.some((d) => d.kind === "beer")) {
    done("flung bottle visible in snapshots");
    stage = 6;
  } else if (stage === 6 && snap.debris.some((d) => d.kind === "beer" && d.phase === "settled")) {
    done("bottle settled on the server");
    console.log("\nALL WS SMOKE TESTS PASSED");
    process.exit(0);
  }
});

function send(intent: unknown): void {
  ws.send(JSON.stringify({ type: "intent", intent }));
}
