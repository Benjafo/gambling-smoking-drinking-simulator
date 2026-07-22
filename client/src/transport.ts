/* Transport layer: the renderer talks intents/snapshots through a Session
   and doesn't care whether the sim lives in a web worker (solo) or in a
   lobby across a websocket (multiplayer).

   Multiplayer is one socket with two modes: browsing (the server pushes the
   lobby list; createLobby/joinLobby request a seat) and seated (intents up,
   snapshots down). Leaving a lobby drops the same socket back to browsing.

   Which server the menu dials: ?server=… —
     (none) / ?server=auto     ws://<page host>:8081 (same URL works on LAN),
                               or wss://<page host>/ws when the page is https
                               (nginx proxies /ws to the lobby server in prod)
     ?server=8090              ws://<page host>:8090
     ?server=ws://host:port    exactly that
   Every dial carries ?v=<PROTOCOL_VERSION>; a 4400 hangup means the build
   and the house disagree on the wire format ("outdated"). */
import type { Appearance } from "@shared/appearance";
import { PROTOCOL_VERSION, WS_PORT_DEFAULT } from "@shared/constants";
import type { ClientMsg, DebrisSnap, Intent, LobbyInfo, ServerMsg, Snapshot } from "@shared/types";

/* wire snapshots carry only FLYING debris; the settled floor arrives as a
   versioned "debris" message, re-sent only when it changes. This cache is
   the reassembly point: everything above the Session (scene, HUD) keeps
   seeing one complete debris list, exactly as before the split. */
class SettledDebris {
  private items: DebrisSnap[] = [];
  apply(items: DebrisSnap[]): void {
    this.items = items;
  }
  merge(snap: Snapshot): Snapshot {
    return { ...snap, debris: [...this.items, ...snap.debris] };
  }
}

export type ConnStatus = "connecting" | "open" | "unreachable" | "lost" | "outdated";
export type EndReason = "left" | "lost";

/* an active seat at a table — solo worker and remote lobby look identical
   from here up */
export interface Session {
  readonly playerId: string;
  /* null = local worker (solo) */
  readonly serverUrl: string | null;
  readonly tableName: string;
  send(intent: Intent): void;
  onSnapshot(cb: (snap: Snapshot) => void): void;
  onEnd(cb: (reason: EndReason) => void): void;
  /* tear down the seat; fires onEnd("left") */
  leave(): void;
}

export function resolveServerUrl(): string {
  const raw = new URLSearchParams(location.search).get("server") ?? "auto";
  if (raw === "" || raw === "auto") {
    // desktop shell: an app:// page has no meaningful host to derive the
    // server from, so the shell hands us the house address instead
    if (window.desktop?.serverUrl) return window.desktop.serverUrl;
    if (location.protocol === "https:") return `wss://${location.host}/ws`;
    return `ws://${location.hostname}:${WS_PORT_DEFAULT}`;
  }
  if (/^\d+$/.test(raw)) return `ws://${location.hostname}:${raw}`;
  return raw;
}

/* ---------------- solo: sim in a web worker ---------------- */
export class LocalSession implements Session {
  readonly playerId = "local";
  readonly serverUrl = null;
  readonly tableName = "PRIVATE TABLE";
  private worker: Worker;
  private snapCb: ((snap: Snapshot) => void) | null = null;
  private endCb: ((reason: EndReason) => void) | null = null;
  private settled = new SettledDebris();

  constructor(name: string, appearance?: Appearance) {
    this.worker = new Worker(new URL("./simWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<ServerMsg>) => {
      if (e.data.type === "debris") this.settled.apply(e.data.items);
      else if (e.data.type === "snapshot") this.snapCb?.(this.settled.merge(e.data.snap));
    };
    this.worker.postMessage({
      type: "init",
      seed: Date.now() & 0xffffffff,
      playerId: this.playerId,
    });
    // the worker queues intents until the sim is up
    this.send({ type: "join", name, appearance });
  }
  send(intent: Intent): void {
    this.worker.postMessage({ type: "intent", playerId: this.playerId, intent });
  }
  onSnapshot(cb: (snap: Snapshot) => void): void {
    this.snapCb = cb;
  }
  onEnd(cb: (reason: EndReason) => void): void {
    this.endCb = cb;
  }
  leave(): void {
    this.worker.terminate();
    this.endCb?.("left");
  }
}

/* ---------------- multiplayer: lobby browser + remote seat ---------------- */
class RemoteSession implements Session {
  readonly serverUrl: string;
  private snapCb: ((snap: Snapshot) => void) | null = null;
  private endCb: ((reason: EndReason) => void) | null = null;
  private ended = false;
  private settled = new SettledDebris();

  constructor(
    private conn: ServerConnection,
    readonly playerId: string,
    readonly tableName: string
  ) {
    this.serverUrl = conn.url;
  }
  send(intent: Intent): void {
    this.conn.post({ type: "intent", intent });
  }
  onSnapshot(cb: (snap: Snapshot) => void): void {
    this.snapCb = cb;
  }
  onEnd(cb: (reason: EndReason) => void): void {
    this.endCb = cb;
  }
  leave(): void {
    this.conn.release(this);
    this.end("left");
  }
  /* internal: routed by the connection */
  deliver(snap: Snapshot): void {
    this.snapCb?.(this.settled.merge(snap));
  }
  deliverDebris(items: DebrisSnap[]): void {
    this.settled.apply(items);
  }
  end(reason: EndReason): void {
    if (this.ended) return;
    this.ended = true;
    this.endCb?.(reason);
  }
}

export class ServerConnection {
  readonly url: string;
  status: ConnStatus = "connecting";
  lobbies: LobbyInfo[] = [];
  private ws: WebSocket | null = null;
  private changeCb: (() => void) | null = null;
  private session: RemoteSession | null = null;
  private pendingJoin: { resolve: (s: Session) => void; reject: (e: Error) => void } | null = null;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  /* fires on any status or lobby-list change — the menu re-renders off it */
  onChange(cb: () => void): void {
    this.changeCb = cb;
    cb();
  }

  /* (re)dial; safe to call while already connecting or open */
  connect(): void {
    if (this.ws) return;
    this.status = "connecting";
    this.emit();
    // the server hangs up (4400) on any other protocol version
    const sep = this.url.includes("?") ? "&" : "?";
    const ws = new WebSocket(`${this.url}${sep}v=${PROTOCOL_VERSION}`);
    this.ws = ws;
    ws.onopen = () => {
      this.status = "open";
      this.emit();
    };
    ws.onmessage = (e) => this.handle(JSON.parse(e.data as string) as ServerMsg);
    // dead sockets must be LOUD: a client rendering defaults with no room
    // behind it looks exactly like a real game
    ws.onclose = (e) => {
      // 4400 = the house speaks a different protocol; redialing can't fix
      // a stale build, so this status is terminal (the menu's retry loop
      // only redials unreachable/lost)
      if (e.code === 4400) this.status = "outdated";
      else this.status = this.status === "open" ? "lost" : "unreachable";
      this.ws = null;
      this.pendingJoin?.reject(new Error("CONNECTION LOST."));
      this.pendingJoin = null;
      const s = this.session;
      this.session = null;
      s?.end("lost");
      this.emit();
    };
  }

  createLobby(
    name: string,
    password: string | null,
    playerName: string,
    appearance?: Appearance
  ): Promise<Session> {
    return this.requestSeat({ type: "createLobby", name, password, playerName, appearance });
  }
  joinLobby(
    lobbyId: string,
    password: string | null,
    playerName: string,
    appearance?: Appearance
  ): Promise<Session> {
    return this.requestSeat({ type: "joinLobby", lobbyId, password, playerName, appearance });
  }

  private requestSeat(msg: ClientMsg): Promise<Session> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("NO CONNECTION TO THE HOUSE."));
    if (this.session || this.pendingJoin) return Promise.reject(new Error("ALREADY SEATED."));
    return new Promise((resolve, reject) => {
      this.pendingJoin = { resolve, reject };
      this.post(msg);
    });
  }

  private handle(msg: ServerMsg): void {
    switch (msg.type) {
      case "lobbies":
        this.lobbies = msg.lobbies;
        this.emit();
        break;
      case "joined": {
        const s = new RemoteSession(this, msg.playerId, msg.lobbyName);
        this.session = s;
        this.pendingJoin?.resolve(s);
        this.pendingJoin = null;
        break;
      }
      case "joinError":
        this.pendingJoin?.reject(new Error(msg.reason));
        this.pendingJoin = null;
        break;
      case "snapshot":
        this.session?.deliver(msg.snap);
        break;
      case "debris":
        this.session?.deliverDebris(msg.items);
        break;
      case "left":
        break; // release() already tore the session down
    }
  }

  /* internal, for RemoteSession */
  post(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  release(s: RemoteSession): void {
    if (this.session !== s) return;
    this.session = null;
    this.post({ type: "leaveLobby" });
  }

  private emit(): void {
    this.changeCb?.();
  }
}
