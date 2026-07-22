/* Multiplayer host, now with lobbies. Each lobby owns its own authoritative
   Simulation, its own client set, and its own tick accumulator — nothing
   crosses between tables. Sockets browse (receive the lobby list, create or
   join a table) until they join; then they talk intents/snapshots exactly
   like the single-room server did. Leaving a lobby drops the socket back to
   browsing on the same connection.

   The in-sim "lobby" phase (players seated, leader starts) is unchanged —
   when the walkable 3D lobby lands later it replaces that phase's rendering
   and adds movement intents; this container layer stays as-is. */
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { Simulation } from "../../shared/src/sim";
import {
  LOBBY_NAME_MAX,
  LOBBY_PASSWORD_MAX,
  PLAYER_NAME_MAX,
  PROTOCOL_VERSION,
  SEAT_COUNT,
  SNAPSHOT_EVERY_TICKS,
  TICK_RATE,
} from "../../shared/src/constants";
import type { Appearance } from "../../shared/src/appearance";
import type { ClientMsg, LobbyInfo, ServerMsg } from "../../shared/src/types";

interface Lobby {
  id: string;
  name: string;
  password: string | null;
  sim: Simulation;
  clients: Map<WebSocket, string>;
  nextPlayer: number;
  /* per-lobby stepping state: tables opened at different times must not
     share a backlog */
  acc: number;
  sinceSnap: number;
  /* last settled-debris version broadcast to this table — the settled set
     is re-shipped only when the sim's version moves (see types.ts) */
  sentDebrisV: number;
}

interface Conn {
  lobby: Lobby | null;
  playerId: string | null;
  /* intent flood gate (token bucket) — see INTENT_PER_SEC */
  tokens: number;
  lastRefill: number;
}

/* Per-connection intent budget. An honest client peaks around 20/s (look
   beats every 100ms, move on direction change + a 150ms yaw beat, plus
   clicks); a modified client can babble thousands. Over-budget intents are
   dropped, not disconnected — a laggy client flushing a burst after a stall
   must not lose its seat. */
const INTENT_PER_SEC = 30;
const INTENT_BURST = 60;

/* rolling minute of pump-health samples for /healthz. Saturation here is
   silent by design — the 250ms accumulator cap makes overloaded sims run
   SLOW rather than crash — so ops need `busy` (ms spent stepping sims per
   pump run, budget ~8) and `gap` (ms between pump runs, ideal 8; spikes =
   event-loop stalls) to see the ceiling coming. */
class PumpStats {
  private cur: number[] = [];
  private prev: number[] = [];
  private rotatedAt = performance.now();
  push(v: number): void {
    const now = performance.now();
    if (now - this.rotatedAt > 60_000) {
      this.prev = this.cur;
      this.cur = [];
      this.rotatedAt = now;
    }
    this.cur.push(v);
  }
  report(): { p50: number; p95: number; max: number } | null {
    const all = this.prev.concat(this.cur);
    if (all.length === 0) return null;
    const s = [...all].sort((a, b) => a - b);
    const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    const round = (v: number) => Math.round(v * 100) / 100;
    return { p50: round(at(0.5)), p95: round(at(0.95)), max: round(s[s.length - 1]) };
  }
}

export interface Server {
  port: number;
  close(): void;
}

/* maxLobbies is the box's measured table capacity — deliberately a required
   argument (and a required MAX_LOBBIES env var in index.ts), not a shared
   constant: the number belongs to the hardware, and the load test
   (src/loadtest.ts) is how you find it */
export function startServer(port: number, maxLobbies: number): Server {
  const lobbies = new Map<string, Lobby>();
  const conns = new Map<WebSocket, Conn>();
  let nextLobbyId = 1;

  const send = (ws: WebSocket, msg: ServerMsg): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const lobbyList = (): LobbyInfo[] =>
    [...lobbies.values()].map((l) => ({
      id: l.id,
      name: l.name,
      players: l.clients.size,
      maxPlayers: SEAT_COUNT,
      locked: l.password !== null,
      // NOT snapshot().phase — snapshot() drains the sim's event queue
      phase: l.sim.phase,
    }));

  /* browsers = sockets not seated at a table; they see the list live */
  const broadcastLobbies = (): void => {
    const msg: ServerMsg = { type: "lobbies", lobbies: lobbyList() };
    const payload = JSON.stringify(msg);
    for (const [ws, conn] of conns)
      if (conn.lobby === null && ws.readyState === WebSocket.OPEN) ws.send(payload);
  };

  const seatPlayer = (
    ws: WebSocket,
    conn: Conn,
    lobby: Lobby,
    playerName: string,
    appearance?: Appearance
  ): void => {
    const playerId = "p" + lobby.nextPlayer++;
    lobby.clients.set(ws, playerId);
    conn.lobby = lobby;
    conn.playerId = playerId;
    const name = playerName.trim().slice(0, PLAYER_NAME_MAX) || "GAMBLER";
    // appearance rides through unchecked — the sim sanitizes it at join
    lobby.sim.applyIntent(playerId, { type: "join", name, appearance });
    send(ws, { type: "joined", lobbyId: lobby.id, lobbyName: lobby.name, playerId });
    // the settled floor, before the first (flying-only) snapshot arrives
    const settled = lobby.sim.settledDebris();
    send(ws, { type: "debris", v: settled.v, items: settled.items });
    console.log(`${playerId} "${name}" joined ${lobby.id} "${lobby.name}" (${lobby.clients.size} seated)`);
    broadcastLobbies();
  };

  const unseatPlayer = (ws: WebSocket, conn: Conn): void => {
    const lobby = conn.lobby;
    if (!lobby || !conn.playerId) return;
    lobby.sim.applyIntent(conn.playerId, { type: "leave" });
    lobby.clients.delete(ws);
    console.log(`${conn.playerId} left ${lobby.id} "${lobby.name}" (${lobby.clients.size} seated)`);
    conn.lobby = null;
    conn.playerId = null;
    // an empty table folds immediately — nothing persists between runs
    if (lobby.clients.size === 0) {
      lobbies.delete(lobby.id);
      console.log(`${lobby.id} "${lobby.name}" closed (empty)`);
    }
    broadcastLobbies();
  };

  /* the socket rides an http server so ops can probe it: /healthz answers
     with live counts (docker healthcheck, uptime monitors), everything else
     404s — game traffic is websocket-only */
  const pumpBusy = new PumpStats();
  const pumpGap = new PumpStats();

  const http = createServer((req, res) => {
    if (req.url === "/healthz") {
      let players = 0;
      for (const l of lobbies.values()) players += l.clients.size;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          lobbies: lobbies.size,
          maxLobbies,
          connections: conns.size,
          players,
          tickRate: TICK_RATE,
          pump: { busyMs: pumpBusy.report(), gapMs: pumpGap.report() },
        })
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server: http });
  http.listen(port);

  wss.on("connection", (ws, req) => {
    // wire-compat gate: a client built against another protocol gets a
    // clean hangup it can name, not a table that quietly desyncs
    const v = new URLSearchParams(req.url?.split("?")[1] ?? "").get("v");
    if (v !== String(PROTOCOL_VERSION)) {
      ws.close(4400, "PROTOCOL MISMATCH — UPDATE THE GAME");
      return;
    }
    const conn: Conn = {
      lobby: null,
      playerId: null,
      tokens: INTENT_BURST,
      lastRefill: performance.now(),
    };
    conns.set(ws, conn);
    send(ws, { type: "lobbies", lobbies: lobbyList() });

    ws.on("message", async (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw)) as ClientMsg;
      } catch {
        return;
      }

      switch (msg.type) {
        case "intent": {
          if (!conn.lobby || !conn.playerId || !msg.intent) break;
          const now = performance.now();
          conn.tokens = Math.min(
            INTENT_BURST,
            conn.tokens + ((now - conn.lastRefill) / 1000) * INTENT_PER_SEC
          );
          conn.lastRefill = now;
          if (conn.tokens < 1) break; // over budget — dropped on the floor
          conn.tokens -= 1;
          conn.lobby.sim.applyIntent(conn.playerId, msg.intent);
          break;
        }

        case "createLobby": {
          if (conn.lobby) return; // already seated
          if (lobbies.size >= maxLobbies) {
            send(ws, { type: "joinError", reason: "THE HOUSE IS FULL — NO NEW TABLES." });
            return;
          }
          const name =
            String(msg.name ?? "").trim().slice(0, LOBBY_NAME_MAX) || "TABLE " + nextLobbyId;
          const password = msg.password
            ? String(msg.password).slice(0, LOBBY_PASSWORD_MAX)
            : null;
          const id = "L" + nextLobbyId++;
          const sim = await Simulation.create(Date.now() & 0xffffffff);
          // the socket may have died or joined elsewhere while Rapier loaded
          if (conn.lobby || ws.readyState !== WebSocket.OPEN) return;
          const lobby: Lobby = {
            id,
            name,
            password,
            sim,
            clients: new Map(),
            nextPlayer: 1,
            acc: 0,
            sinceSnap: 0,
            sentDebrisV: sim.settledV,
          };
          lobbies.set(id, lobby);
          console.log(`${id} "${name}" opened${password ? " (private)" : ""}`);
          seatPlayer(ws, conn, lobby, msg.playerName, msg.appearance);
          break;
        }

        case "joinLobby": {
          if (conn.lobby) return;
          const lobby = lobbies.get(msg.lobbyId);
          if (!lobby) {
            send(ws, { type: "joinError", reason: "THAT TABLE IS GONE." });
            broadcastLobbies();
            return;
          }
          if (lobby.password !== null && msg.password !== lobby.password) {
            send(ws, { type: "joinError", reason: "WRONG PASSWORD." });
            return;
          }
          if (lobby.clients.size >= SEAT_COUNT) {
            send(ws, { type: "joinError", reason: "TABLE FULL — FIVE STOOLS, NO STANDING." });
            return;
          }
          seatPlayer(ws, conn, lobby, msg.playerName, msg.appearance);
          break;
        }

        case "leaveLobby":
          if (!conn.lobby) return;
          unseatPlayer(ws, conn);
          send(ws, { type: "left" });
          send(ws, { type: "lobbies", lobbies: lobbyList() });
          break;
      }
    });

    ws.on("close", () => {
      unseatPlayer(ws, conn);
      conns.delete(ws);
    });
  });

  /* one fixed-step pump drives every table; each keeps its own backlog.
     The 250ms cap stays per-lobby: a stalled event loop must not
     fast-forward any sim in a burst. */
  const stepMs = 1000 / TICK_RATE;
  let last = performance.now();
  const pump = setInterval(() => {
    const now = performance.now();
    const dt = now - last;
    last = now;
    pumpGap.push(dt);
    for (const lobby of lobbies.values()) {
      lobby.acc = Math.min(lobby.acc + dt, 250);
      while (lobby.acc >= stepMs) {
        lobby.sim.step();
        lobby.acc -= stepMs;
        if (++lobby.sinceSnap >= SNAPSHOT_EVERY_TICKS) {
          lobby.sinceSnap = 0;
          if (lobby.clients.size > 0) {
            // settled set first when it changed, so no client ever holds a
            // snapshot whose settledV it hasn't seen (ws delivery is ordered)
            if (lobby.sim.settledV !== lobby.sentDebrisV) {
              const settled = lobby.sim.settledDebris();
              lobby.sentDebrisV = settled.v;
              const dPayload = JSON.stringify({ type: "debris", v: settled.v, items: settled.items });
              for (const ws of lobby.clients.keys())
                if (ws.readyState === WebSocket.OPEN) ws.send(dPayload);
            }
            const payload = JSON.stringify({ type: "snapshot", snap: lobby.sim.snapshot(true) });
            for (const ws of lobby.clients.keys())
              if (ws.readyState === WebSocket.OPEN) ws.send(payload);
          }
        }
      }
    }
    pumpBusy.push(performance.now() - now);
  }, 8);

  /* browsers also want to see phase/count drift (a table starting its game,
     someone joining) without any join/leave edge — refresh on a slow beat,
     only when something changed */
  let listSig = "";
  const listBeat = setInterval(() => {
    const sig = JSON.stringify(lobbyList());
    if (sig !== listSig) {
      listSig = sig;
      broadcastLobbies();
    }
  }, 1000);

  return {
    port,
    close(): void {
      clearInterval(pump);
      clearInterval(listBeat);
      for (const ws of conns.keys()) ws.close();
      wss.close();
      http.close();
    },
  };
}
