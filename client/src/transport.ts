/* Transport abstraction: the renderer talks intents/snapshots and doesn't
   care whether the sim lives in a web worker (single player) or across a
   websocket (multiplayer). Swap with ?server=… —
     ?server=auto            ws://<page host>:8081 (same URL works on LAN)
     ?server=8090            ws://<page host>:8090
     ?server=ws://host:port  exactly that */
import { WS_PORT_DEFAULT } from "@shared/constants";
import type { Intent, ServerMsg, Snapshot } from "@shared/types";

export type ConnStatus = "connecting" | "open" | "unreachable" | "lost";

export interface Transport {
  playerId: string;
  ready: Promise<void>;
  /* null = local worker (single player) */
  serverUrl: string | null;
  send(intent: Intent): void;
  onSnapshot(cb: (snap: Snapshot) => void): void;
  onStatus(cb: (s: ConnStatus) => void): void;
}

export class LocalTransport implements Transport {
  playerId = "local";
  ready: Promise<void>;
  serverUrl: string | null = null;
  private worker: Worker;
  private cb: ((snap: Snapshot) => void) | null = null;
  private status: ConnStatus = "connecting";
  private statusCb: ((s: ConnStatus) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL("./simWorker.ts", import.meta.url), { type: "module" });
    this.ready = new Promise((resolve) => {
      this.worker.onmessage = (e: MessageEvent<ServerMsg>) => {
        const msg = e.data;
        if (msg.type === "welcome") {
          this.setStatus("open");
          resolve();
        } else if (msg.type === "snapshot") this.cb?.(msg.snap);
      };
    });
    this.worker.postMessage({
      type: "init",
      seed: Date.now() & 0xffffffff,
      playerId: this.playerId,
    });
  }
  send(intent: Intent): void {
    this.worker.postMessage({ type: "intent", playerId: this.playerId, intent });
  }
  onSnapshot(cb: (snap: Snapshot) => void): void {
    this.cb = cb;
  }
  onStatus(cb: (s: ConnStatus) => void): void {
    this.statusCb = cb;
    cb(this.status); // replay: the worker may have welcomed before wiring
  }
  private setStatus(s: ConnStatus): void {
    this.status = s;
    this.statusCb?.(s);
  }
}

export class WsTransport implements Transport {
  playerId = "";
  ready: Promise<void>;
  serverUrl: string;
  private ws: WebSocket;
  private cb: ((snap: Snapshot) => void) | null = null;
  private queue: Intent[] = [];
  private status: ConnStatus = "connecting";
  private statusCb: ((s: ConnStatus) => void) | null = null;

  constructor(url: string) {
    this.serverUrl = url;
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve) => {
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as ServerMsg;
        if (msg.type === "welcome") {
          this.playerId = msg.playerId;
          this.setStatus("open");
          for (const i of this.queue) this.send(i);
          this.queue = [];
          resolve();
        } else if (msg.type === "snapshot") {
          this.cb?.(msg.snap);
        }
      };
    });
    // dead sockets must be LOUD: a client rendering defaults with no room
    // behind it looks exactly like a real game
    this.ws.onclose = () => this.setStatus(this.status === "open" ? "lost" : "unreachable");
    this.ws.onerror = () => {
      if (this.status !== "open") this.setStatus("unreachable");
    };
  }
  send(intent: Intent): void {
    if (this.ws.readyState !== WebSocket.OPEN) {
      this.queue.push(intent);
      return;
    }
    this.ws.send(JSON.stringify({ type: "intent", intent }));
  }
  onSnapshot(cb: (snap: Snapshot) => void): void {
    this.cb = cb;
  }
  onStatus(cb: (s: ConnStatus) => void): void {
    this.statusCb = cb;
    cb(this.status);
  }
  private setStatus(s: ConnStatus): void {
    this.status = s;
    this.statusCb?.(s);
  }
}

export function createTransport(): Transport {
  const raw = new URLSearchParams(location.search).get("server");
  if (raw === null) return new LocalTransport();
  let url = raw;
  if (raw === "" || raw === "auto") url = `ws://${location.hostname}:${WS_PORT_DEFAULT}`;
  else if (/^\d+$/.test(raw)) url = `ws://${location.hostname}:${raw}`;
  return new WsTransport(url);
}
