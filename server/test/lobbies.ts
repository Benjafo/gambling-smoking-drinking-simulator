/* Lobby-layer integration test against a real server on a real socket:
   browse → create (public + private) → password gate → full isolation
   between tables → leave → empty-table cleanup.
   Run with: npm run test:server */
import { WebSocket } from "ws";
import { startServer } from "../src/server";
import type { ClientMsg, ServerMsg, Snapshot } from "../../shared/src/types";

const PORT = 8191;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  :", msg);
}

/* buffered client: every ServerMsg lands in a queue; waitFor() consumes the
   first match or waits for one (snapshots stream, so tests that care about
   "state after X" clear the queue first) */
class Client {
  private queue: ServerMsg[] = [];
  private waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];

  private constructor(private ws: WebSocket) {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMsg;
      const i = this.waiters.findIndex((w) => w.pred(msg));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg);
      else this.queue.push(msg);
    });
  }

  static connect(): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}`);
      ws.on("open", () => resolve(new Client(ws)));
      ws.on("error", reject);
    });
  }

  send(msg: ClientMsg): void {
    this.ws.send(JSON.stringify(msg));
  }

  clear(): void {
    this.queue.length = 0;
  }

  waitFor<T extends ServerMsg>(pred: (m: ServerMsg) => m is T, label: string): Promise<T> {
    const i = this.queue.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0] as T);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for " + label)), 5000);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as T);
        },
      });
    });
  }

  lobbies() {
    return this.waitFor(
      (m): m is Extract<ServerMsg, { type: "lobbies" }> => m.type === "lobbies",
      "lobbies"
    );
  }
  snapshot(): Promise<Snapshot> {
    return this.waitFor(
      (m): m is Extract<ServerMsg, { type: "snapshot" }> => m.type === "snapshot",
      "snapshot"
    ).then((m) => m.snap);
  }
  close(): void {
    this.ws.close();
  }
}

const server = startServer(PORT);
const bail = setTimeout(() => {
  console.error("FAIL: test suite timed out");
  process.exit(1);
}, 30000);

/* ---- browse: a fresh connection sees the (empty) floor ---- */
const anna = await Client.connect();
let list = await anna.lobbies();
assert(list.lobbies.length === 0, "fresh server has no tables");

/* ---- create a public table; creator is seated and streamed ---- */
anna.send({ type: "createLobby", name: "ALPHA", password: null, playerName: "ANNA" });
const annaJoin = await anna.waitFor(
  (m): m is Extract<ServerMsg, { type: "joined" }> => m.type === "joined",
  "joined(ALPHA)"
);
assert(annaJoin.lobbyName === "ALPHA" && annaJoin.playerId === "p1", "creator seated at ALPHA as p1");
let snap = await anna.snapshot();
assert(snap.players.length === 1 && snap.players[0].name === "ANNA", "ALPHA sim holds only ANNA");

/* ---- second connection browses the live list ---- */
const bob = await Client.connect();
list = await bob.lobbies();
assert(
  list.lobbies.length === 1 && list.lobbies[0].name === "ALPHA" && list.lobbies[0].players === 1,
  "browser sees ALPHA with one player"
);
assert(list.lobbies[0].locked === false, "ALPHA reads as unlocked");
assert(!("password" in list.lobbies[0]), "lobby list never carries a password field");

/* ---- create a private table ---- */
bob.send({ type: "createLobby", name: "BRAVO", password: "hunter2", playerName: "BOB" });
await bob.waitFor((m): m is Extract<ServerMsg, { type: "joined" }> => m.type === "joined", "joined(BRAVO)");

const cleo = await Client.connect();
list = await cleo.lobbies();
const bravo = list.lobbies.find((l) => l.name === "BRAVO")!;
assert(list.lobbies.length === 2 && bravo.locked, "two tables on the floor, BRAVO locked");

/* ---- password gate ---- */
cleo.send({ type: "joinLobby", lobbyId: bravo.id, password: "wrong", playerName: "CLEO" });
const err = await cleo.waitFor(
  (m): m is Extract<ServerMsg, { type: "joinError" }> => m.type === "joinError",
  "joinError"
);
assert(/PASSWORD/.test(err.reason), "wrong password is refused");
cleo.send({ type: "joinLobby", lobbyId: bravo.id, password: "hunter2", playerName: "CLEO" });
await cleo.waitFor((m): m is Extract<ServerMsg, { type: "joined" }> => m.type === "joined", "joined(BRAVO)");
snap = await cleo.snapshot();
assert(
  snap.players.map((p) => p.name).sort().join() === "BOB,CLEO",
  "BRAVO seats BOB and CLEO only"
);

/* ---- isolation: ALPHA starts its game; BRAVO must not notice ----
   (the start queues a 10s countdown — waiting it out in real time would
   drag the suite, so the queued countdown is the proof of the start) */
anna.send({ type: "intent", intent: { type: "startGame" } });
anna.clear();
for (let i = 0; i < 100; i++) {
  snap = await anna.snapshot();
  if (snap.startsIn !== null) break;
}
assert(snap.startsIn !== null, "ALPHA's leader queued ALPHA's start countdown");
bob.clear();
const bravoSnap = await bob.snapshot();
assert(
  bravoSnap.phase === "lobby" && bravoSnap.startsIn === null,
  "BRAVO still sits in its lobby, no countdown — other tables don't leak"
);
assert(
  bravoSnap.players.every((p) => p.name !== "ANNA"),
  "no cross-lobby players in BRAVO's snapshots"
);
anna.clear();
snap = await anna.snapshot();
assert(snap.players.length === 1, "no cross-lobby players in ALPHA's snapshots");

/* ---- leave returns the socket to browsing; counts update ---- */
cleo.send({ type: "leaveLobby" });
await cleo.waitFor((m): m is Extract<ServerMsg, { type: "left" }> => m.type === "left", "left");
list = await cleo.lobbies();
assert(
  list.lobbies.find((l) => l.name === "BRAVO")!.players === 1,
  "leaving frees the seat in the list"
);

/* ---- an emptied table folds ---- */
anna.close();
for (let i = 0; i < 10; i++) {
  list = await cleo.lobbies();
  if (!list.lobbies.some((l) => l.name === "ALPHA")) break;
}
assert(!list.lobbies.some((l) => l.name === "ALPHA"), "ALPHA closed once its last player left");
assert(list.lobbies.some((l) => l.name === "BRAVO"), "BRAVO (still seated) survives");

console.log("\nALL LOBBY-SERVER TESTS PASSED");
clearTimeout(bail);
bob.close();
cleo.close();
server.close();
process.exit(0);
