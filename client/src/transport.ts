/* Transport abstraction: the renderer talks intents/snapshots and doesn't
   care whether the sim lives in a web worker (single player) or across a
   websocket (multiplayer). Swap with ?server=ws://host:8081 */
import type { Intent, ServerMsg, Snapshot } from "@shared/types";

export interface Transport {
  playerId: string;
  ready: Promise<void>;
  send(intent: Intent): void;
  onSnapshot(cb: (snap: Snapshot) => void): void;
}

export class LocalTransport implements Transport {
  playerId = "local";
  ready: Promise<void>;
  private worker: Worker;
  private cb: ((snap: Snapshot) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL("./simWorker.ts", import.meta.url), { type: "module" });
    this.ready = new Promise((resolve) => {
      this.worker.onmessage = (e: MessageEvent<ServerMsg>) => {
        const msg = e.data;
        if (msg.type === "welcome") resolve();
        else if (msg.type === "snapshot") this.cb?.(msg.snap);
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
}

export class WsTransport implements Transport {
  playerId = "";
  ready: Promise<void>;
  private ws: WebSocket;
  private cb: ((snap: Snapshot) => void) | null = null;
  private queue: Intent[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve) => {
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as ServerMsg;
        if (msg.type === "welcome") {
          this.playerId = msg.playerId;
          for (const i of this.queue) this.send(i);
          this.queue = [];
          resolve();
        } else if (msg.type === "snapshot") {
          this.cb?.(msg.snap);
        }
      };
    });
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
}

export function createTransport(): Transport {
  const server = new URLSearchParams(location.search).get("server");
  return server ? new WsTransport(server) : new LocalTransport();
}
