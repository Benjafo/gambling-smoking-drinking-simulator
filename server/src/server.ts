/* Multiplayer host, now with lobbies. Each lobby owns its own authoritative
   Simulation, its own client set, and its own tick accumulator — nothing
   crosses between tables. Sockets browse (receive the lobby list, create or
   join a table) until they join; then they talk intents/snapshots exactly
   like the single-room server did. Leaving a lobby drops the socket back to
   browsing on the same connection.

   The in-sim "lobby" phase (players seated, leader starts) is unchanged —
   when the walkable 3D lobby lands later it replaces that phase's rendering
   and adds movement intents; this container layer stays as-is. */
import { WebSocketServer, WebSocket } from "ws";
import { Simulation } from "../../shared/src/sim";
import {
  LOBBY_NAME_MAX,
  LOBBY_PASSWORD_MAX,
  MAX_LOBBIES,
  PLAYER_NAME_MAX,
  SEAT_COUNT,
  SNAPSHOT_EVERY_TICKS,
  TICK_RATE,
} from "../../shared/src/constants";
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
}

interface Conn {
  lobby: Lobby | null;
  playerId: string | null;
}

export interface Server {
  port: number;
  close(): void;
}

export function startServer(port: number): Server {
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

  const seatPlayer = (ws: WebSocket, conn: Conn, lobby: Lobby, playerName: string): void => {
    const playerId = "p" + lobby.nextPlayer++;
    lobby.clients.set(ws, playerId);
    conn.lobby = lobby;
    conn.playerId = playerId;
    const name = playerName.trim().slice(0, PLAYER_NAME_MAX) || "DEGENERATE";
    lobby.sim.applyIntent(playerId, { type: "join", name });
    send(ws, { type: "joined", lobbyId: lobby.id, lobbyName: lobby.name, playerId });
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

  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws) => {
    const conn: Conn = { lobby: null, playerId: null };
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
        case "intent":
          if (conn.lobby && conn.playerId && msg.intent)
            conn.lobby.sim.applyIntent(conn.playerId, msg.intent);
          break;

        case "createLobby": {
          if (conn.lobby) return; // already seated
          if (lobbies.size >= MAX_LOBBIES) {
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
          };
          lobbies.set(id, lobby);
          console.log(`${id} "${name}" opened${password ? " (private)" : ""}`);
          seatPlayer(ws, conn, lobby, msg.playerName);
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
          seatPlayer(ws, conn, lobby, msg.playerName);
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
    for (const lobby of lobbies.values()) {
      lobby.acc = Math.min(lobby.acc + dt, 250);
      while (lobby.acc >= stepMs) {
        lobby.sim.step();
        lobby.acc -= stepMs;
        if (++lobby.sinceSnap >= SNAPSHOT_EVERY_TICKS) {
          lobby.sinceSnap = 0;
          if (lobby.clients.size > 0) {
            const payload = JSON.stringify({ type: "snapshot", snap: lobby.sim.snapshot() });
            for (const ws of lobby.clients.keys())
              if (ws.readyState === WebSocket.OPEN) ws.send(payload);
          }
        }
      }
    }
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
    },
  };
}
