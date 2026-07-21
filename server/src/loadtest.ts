/* Headless load driver: fills a running server with whole tables of
   wire-honest bots and reports the numbers that size a launch box —
   whether the 60Hz sim rate holds, snapshot bytes on the wire, and egress
   at scale. The bots are a port of the sim's own BotBrain policy (bots.ts)
   driven purely through the websocket protocol: they bet, play blackjack,
   keep their meters fed (buy → ritual → fling the empty), wander the
   waiting room, and the leader starts runs and restarts dead tables — so
   every table stays in ACTIVE play for as long as the test holds.

   Server first (any box; prod is the one whose numbers matter):
     MAX_LOBBIES=200 npm run server
   Then:
     npm run loadtest -- --tables 10,25,50 --hold 90
     npm run loadtest -- --url wss://blackjack.benjafo.com/ws --tables 25

   Reading the report: simRate pinned at ~60 = healthy. Sagging simRate
   means the box is past capacity — overloaded sims run SLOW by design
   (the 250ms accumulator cap), they don't crash. /healthz `busy` shows
   how close the pump is to its 8ms budget before that point. If driver
   CPU reads high, the test rig itself is the bottleneck: run fewer tables
   per driver and fan out across machines (each invocation makes its own
   tables, so drivers compose). */
import { WebSocket } from "ws";
import { cardValue, handValue, type Card } from "../../shared/src/blackjack";
import {
  EYE_HEIGHT,
  MAX_FLING_SPEED,
  MIN_BET,
  PROTOCOL_VERSION,
  SEAT_COUNT,
  TABLE,
  seatPosition,
  type V3,
} from "../../shared/src/constants";
import { LOBBY_EYE_HEIGHT, LOBBY_ROOM } from "../../shared/src/lobbyRoom";
import type { ClientMsg, PlayerSnap, ServerMsg, Snapshot } from "../../shared/src/types";

const GRAVITY = 9.81; // matches physics.ts createWorld

/* ---------------- args ---------------- */

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const URL_BASE = arg("url", "ws://localhost:8081");
const STAGES = arg("tables", "10,25,50")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isInteger(n) && n > 0)
  .sort((a, b) => a - b);
const HOLD_S = Math.max(15, parseInt(arg("hold", "90"), 10) || 90);
const HEALTHZ = arg("healthz", deriveHealthz(URL_BASE));

function deriveHealthz(ws: string): string {
  try {
    const u = new URL(ws);
    u.protocol = u.protocol === "wss:" ? "https:" : "http:";
    u.pathname = "/healthz";
    u.search = "";
    return u.toString();
  } catch {
    return "";
  }
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ---------------- stage-wide counters ---------------- */

let txCount = 0;
let disconnects = 0;
let shuttingDown = false;

/* ---------------- the bot ---------------- */

class Bot {
  ws: WebSocket | null = null;
  playerId: string | null = null;
  lobbyId: string | null = null;
  snap: Snapshot | null = null;
  dead = false;

  // wire stats, reset each stage
  rxBytes = 0;
  // leader-only observer stats (leaders parse every snapshot)
  snapBytes: number[] = [];
  snapGaps: number[] = [];
  private lastSnapAt = 0;
  baseTick = -1;
  baseTickAt = 0;
  lastTick = 0;
  lastTickAt = 0;
  baseHands = 0;

  private sinceParse = 0;
  private joinWaiter: { resolve: (v: void) => void; reject: (e: Error) => void } | null = null;

  // policy timers (performance.now ms), a straight port of BotBrain's beats
  private betAt = -1;
  private actAt = -1;
  private flingAt = -1;
  private ritualAt = 0;
  private viceAt = 0;
  private shopAt = 0;
  private lookAt = 0;
  private moveAt = 0;
  private startGameAt = -1;
  private restartAt = -1;
  private lookYaw = 0;
  private lookPitch = 0;
  private lastPhase = "";

  constructor(readonly isLeader: boolean) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sep = URL_BASE.includes("?") ? "&" : "?";
      const ws = new WebSocket(`${URL_BASE}${sep}v=${PROTOCOL_VERSION}`);
      this.ws = ws;
      ws.on("open", () => resolve());
      ws.on("error", (e) => reject(e instanceof Error ? e : new Error(String(e))));
      ws.on("message", (raw) => this.onMessage(raw as Buffer));
      ws.on("close", () => {
        if (!this.dead && this.playerId && !shuttingDown) disconnects++;
        this.dead = true;
      });
    });
  }

  waitJoined(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.joinWaiter = { resolve, reject };
      setTimeout(() => {
        if (this.joinWaiter) {
          this.joinWaiter = null;
          reject(new Error("timed out waiting to be seated"));
        }
      }, 15000);
    });
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      txCount++;
    }
  }

  resetStats(): void {
    this.rxBytes = 0;
    this.snapBytes = [];
    this.snapGaps = [];
    this.lastSnapAt = 0;
    this.baseTick = -1;
    this.baseHands = this.snap?.handsPlayed ?? 0;
  }

  private onMessage(raw: Buffer): void {
    this.rxBytes += raw.length;
    /* parse throttling keeps the driver honest at scale: leaders parse every
       message (they carry the table's stats and duties), followers only every
       3rd — a ~150ms view of the world, well inside every think delay */
    if (!this.isLeader && this.playerId && this.snap && ++this.sinceParse < 3) return;
    this.sinceParse = 0;
    let msg: ServerMsg;
    try {
      msg = JSON.parse(String(raw)) as ServerMsg;
    } catch {
      return;
    }
    if (msg.type === "joined") {
      this.playerId = msg.playerId;
      this.lobbyId = msg.lobbyId;
      this.joinWaiter?.resolve();
      this.joinWaiter = null;
    } else if (msg.type === "joinError") {
      this.joinWaiter?.reject(new Error(msg.reason));
      this.joinWaiter = null;
    } else if (msg.type === "snapshot") {
      if (this.isLeader) {
        const now = performance.now();
        if (this.lastSnapAt > 0) this.snapGaps.push(now - this.lastSnapAt);
        this.lastSnapAt = now;
        this.snapBytes.push(raw.length);
        this.lastTick = msg.snap.tick;
        this.lastTickAt = now;
        if (this.baseTick < 0) {
          this.baseTick = msg.snap.tick;
          this.baseTickAt = now;
        }
      }
      this.snap = msg.snap;
    }
  }

  /* driven at 10Hz by the global loop — every send below is throttled far
     under the server's 30/s intent budget */
  tick(now: number): void {
    if (this.dead || !this.snap || !this.playerId) return;
    const snap = this.snap;
    const me = snap.players.find((p) => p.id === this.playerId);
    if (!me) return;

    if (snap.phase !== this.lastPhase) {
      this.lastPhase = snap.phase;
      this.betAt = this.actAt = this.flingAt = -1;
      this.startGameAt = this.restartAt = -1;
    }

    // leader duties: open the run, and re-open it when the table dies out
    if (this.isLeader && snap.leaderId === this.playerId) {
      if (snap.phase === "lobby" && snap.startsIn == null) {
        if (this.startGameAt < 0) this.startGameAt = now + rand(3000, 6000);
        else if (now >= this.startGameAt) {
          this.send({ type: "intent", intent: { type: "startGame" } });
          this.startGameAt = now + 3000; // retry beat in case it didn't take
        }
      }
      if (snap.phase === "over") {
        if (this.restartAt < 0) this.restartAt = now + rand(2000, 4000);
        else if (now >= this.restartAt) {
          this.send({ type: "intent", intent: { type: "restart" } });
          this.restartAt = now + 3000;
        }
      }
    }

    if (snap.phase === "lobby") return this.lobbyTick(now, me);
    if (snap.phase === "over") return;

    // seated at the table: the idle look beat every real client sends
    if (now >= this.lookAt) {
      this.lookAt = now + 100;
      this.lookYaw = Math.max(-1.1, Math.min(1.1, this.lookYaw + rand(-0.15, 0.15)));
      this.lookPitch = Math.max(-0.3, Math.min(0.15, this.lookPitch + rand(-0.05, 0.05)));
      this.send({ type: "intent", intent: { type: "look", yaw: this.lookYaw, pitch: this.lookPitch } });
    }
    if (!me.alive || me.waiting) return;

    this.viceTick(now, me);

    if (snap.phase === "betting" && !me.committed && me.money >= MIN_BET) {
      if (me.sittingOut) {
        this.send({ type: "intent", intent: { type: "sitOut", on: false } });
      } else if (this.betAt < 0) this.betAt = now + rand(1000, 3000);
      else if (now >= this.betAt) {
        this.betAt = now + 2000; // resend window until `committed` shows
        const amount = Math.max(MIN_BET, Math.floor((me.money * rand(0.05, 0.15)) / 10) * 10);
        this.send({ type: "intent", intent: { type: "setBet", amount } });
        this.send({ type: "intent", intent: { type: "commitBet" } });
      }
    }

    if (snap.phase === "acting" && snap.turnPlayerId === this.playerId) {
      if (this.actAt < 0) this.actAt = now + rand(800, 2000);
      else if (now >= this.actAt) {
        this.actAt = -1; // turn still ours next tick → fresh think
        this.send({ type: "intent", intent: { type: this.decide(me) } });
      }
    } else this.actAt = -1;
  }

  /* BotBrain's "medium" blackjack policy, verbatim */
  private decide(me: PlayerSnap): "hit" | "stand" | "double" {
    const { total, soft } = handValue(me.hand);
    const up: Card | undefined = this.snap!.dealerHand[0];
    const u = up ? cardValue(up.r) : 10;
    const canDouble = me.hand.length === 2 && me.money >= me.bet;
    if (soft) return total <= 17 ? "hit" : "stand";
    if ((total === 10 || total === 11) && canDouble && Math.random() < 0.5) return "double";
    if (u >= 7) return total < 17 ? "hit" : "stand";
    return total < 13 ? "hit" : "stand";
  }

  /* keep the meters fed and the empties flying — the part that makes a
     load-test table physically resemble a real one (rituals mint empties,
     empties become debris, debris is Rapier work) */
  private viceTick(now: number, me: PlayerSnap): void {
    if (me.held) {
      if (this.flingAt < 0) this.flingAt = now + rand(600, 2000);
      else if (now >= this.flingAt) {
        this.flingAt = -1;
        this.flingDen(me);
      }
      return;
    }
    this.flingAt = -1;
    if (me.ritual) {
      if (now >= this.ritualAt) {
        this.ritualAt = now + 700;
        this.send({ type: "intent", intent: { type: "ritualEngage", on: true } });
      }
      return;
    }
    if (now < this.viceAt) return;
    const kind = me.cigarMeter <= me.beerMeter ? "cigar" : "beer";
    const meter = kind === "cigar" ? me.cigarMeter : me.beerMeter;
    const inv = kind === "cigar" ? me.cigarInv : me.beerInv;
    if (meter < 45) {
      if (inv > 0) {
        this.viceAt = now + 500; // snapshot lag guard — don't double-start
        this.send({ type: "intent", intent: { type: "consumeStart", kind } });
        this.send({ type: "intent", intent: { type: "ritualEngage", on: true } });
      } else if (now >= this.shopAt) {
        this.shopAt = now + 1000;
        this.send({ type: "intent", intent: { type: "buy", item: kind, qty: 1 } });
      }
      return;
    }
    if (now >= this.shopAt) {
      this.shopAt = now + rand(4000, 9000);
      const price = kind === "cigar" ? this.snap!.cigarPrice : this.snap!.beerPrice;
      if (inv < 2 && me.money > price * 4)
        this.send({ type: "intent", intent: { type: "buy", item: kind, qty: 1 + Math.floor(rand(0, 3)) } });
    }
  }

  /* waiting-room loitering: wander, hop, hurl whatever's in hand */
  private lobbyTick(now: number, me: PlayerSnap): void {
    if (me.held) {
      if (this.flingAt < 0) this.flingAt = now + rand(500, 1500);
      else if (now >= this.flingAt) {
        this.flingAt = -1;
        this.flingLobby(me);
      }
      return;
    }
    if (now < this.moveAt) return;
    this.moveAt = now + rand(300, 900);
    const r = Math.random();
    if (r < 0.15) {
      this.send({ type: "intent", intent: { type: "jump" } });
    } else if (r < 0.45) {
      this.send({ type: "intent", intent: { type: "move", dirX: 0, dirZ: 0, yaw: rand(-Math.PI, Math.PI) } });
    } else {
      const a = rand(-Math.PI, Math.PI);
      this.send({
        type: "intent",
        intent: { type: "move", dirX: Math.sin(a), dirZ: Math.cos(a), yaw: a, run: Math.random() < 0.3 },
      });
    }
  }

  private flingDen(me: PlayerSnap): void {
    const eye = { ...seatPosition(me.seat), y: EYE_HEIGHT };
    const others = this.snap!.players.filter((q) => q.id !== me.id && q.alive && !q.waiting);
    const r = Math.random();
    let target: V3;
    if (r < 0.45 && others.length > 0) {
      const victim = others[Math.floor(rand(0, others.length))];
      const base = seatPosition(victim.seat);
      target = { x: base.x, y: rand(0.9, 1.4), z: base.z };
    } else if (r < 0.8) {
      const a = rand(0, Math.PI * 2);
      const rad = rand(0, TABLE.radius * 0.7);
      target = { x: Math.sin(a) * rad, y: TABLE.height + 0.05, z: Math.cos(a) * rad };
    } else {
      const a = rand(0, Math.PI * 2);
      const rad = rand(2.6, 3.8);
      target = { x: Math.sin(a) * rad, y: 0.05, z: 0.5 + Math.cos(a) * rad };
    }
    this.fling(eye, target, me.held!.id);
  }

  private flingLobby(me: PlayerSnap): void {
    const eye = { x: me.pos.x, y: me.pos.y + LOBBY_EYE_HEIGHT, z: me.pos.z };
    const target = {
      x: rand(-LOBBY_ROOM.halfW + 0.4, LOBBY_ROOM.halfW - 0.4),
      y: rand(0.2, 1.6),
      z: rand(-LOBBY_ROOM.halfD + 0.4, LOBBY_ROOM.halfD - 0.4),
    };
    this.fling(eye, target, me.held!.id);
  }

  /* BotBrain's ballistic arc solve, jitter fixed at "medium" skill */
  private fling(eye: V3, target: V3, itemId: number): void {
    const dist = Math.hypot(target.x - eye.x, target.z - eye.z) || 0.5;
    const err = dist * 0.15;
    const t = {
      x: target.x + rand(-err, err),
      y: target.y + rand(-err, err) * 0.5,
      z: target.z + rand(-err, err),
    };
    let flight = Math.max(0.35, dist / 9);
    let vel: V3 = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 3; i++) {
      vel = {
        x: (t.x - eye.x) / flight,
        y: (t.y - eye.y) / flight + 0.5 * GRAVITY * flight,
        z: (t.z - eye.z) / flight,
      };
      if (Math.hypot(vel.x, vel.y, vel.z) <= MAX_FLING_SPEED * 0.95) break;
      flight *= 1.25;
    }
    const dl = Math.hypot(vel.x, vel.y, vel.z) || 1;
    const origin = {
      x: eye.x + (vel.x / dl) * 0.5,
      y: eye.y + (vel.y / dl) * 0.5,
      z: eye.z + (vel.z / dl) * 0.5,
    };
    this.send({
      type: "intent",
      intent: {
        type: "fling",
        itemId,
        origin,
        vel,
        angVel: { x: rand(-10, 10), y: rand(-10, 10), z: rand(-10, 10) },
      },
    });
  }
}

/* ---------------- tables ---------------- */

async function spawnTable(idx: number): Promise<Bot[]> {
  const leader = new Bot(true);
  await leader.connect();
  const seated = leader.waitJoined();
  leader.send({
    type: "createLobby",
    name: `LOAD ${idx}`,
    password: null,
    playerName: `LOAD${idx} LEAD`,
  });
  await seated;
  const joiners = await Promise.all(
    Array.from({ length: SEAT_COUNT - 1 }, async (_, s) => {
      const b = new Bot(false);
      await b.connect();
      const j = b.waitJoined();
      b.send({
        type: "joinLobby",
        lobbyId: leader.lobbyId!,
        password: null,
        playerName: `LOAD${idx} S${s + 1}`,
      });
      await j;
      return b;
    })
  );
  return [leader, ...joiners];
}

/* ---------------- reporting ---------------- */

function pct(sorted: number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;
}

interface Healthz {
  lobbies?: number;
  connections?: number;
  players?: number;
  pump?: {
    busyMs?: { p50: number; p95: number; max: number } | null;
    gapMs?: { p50: number; p95: number; max: number } | null;
  };
}

async function pollHealthz(): Promise<Healthz | null> {
  if (!HEALTHZ) return null;
  try {
    const res = await fetch(HEALTHZ, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return (await res.json()) as Healthz;
  } catch {
    return null;
  }
}

function report(tables: Bot[][], holdMs: number, cpuMs: number, hz: Healthz | null): void {
  const bots = tables.flat();
  const leaders = tables.map((t) => t[0]).filter((l) => !l.dead && l.baseTick >= 0);
  const rates = leaders
    .map((l) => (l.lastTickAt > l.baseTickAt ? ((l.lastTick - l.baseTick) / (l.lastTickAt - l.baseTickAt)) * 1000 : 0))
    .filter((r) => r > 0);
  const rxTotal = bots.reduce((s, b) => s + b.rxBytes, 0);
  const allBytes = leaders.flatMap((l) => l.snapBytes).sort((a, b) => a - b);
  const allGaps = leaders.flatMap((l) => l.snapGaps).sort((a, b) => a - b);
  const hands = leaders.reduce((s, l) => s + Math.max(0, (l.snap?.handsPlayed ?? 0) - l.baseHands), 0);
  const mbps = (rxTotal * 8) / (holdMs / 1000) / 1e6;
  const tb30 = ((rxTotal / (holdMs / 1000)) * 86400 * 30) / 1e12;
  const cpuPct = Math.round((cpuMs / holdMs) * 100);

  console.log(`\n── ${tables.length} tables / ${bots.length} bots — held ${Math.round(holdMs / 1000)}s ──`);
  if (rates.length)
    console.log(
      `  sim rate   : avg ${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1)} ticks/s, ` +
        `worst table ${Math.min(...rates).toFixed(1)}  (60 = healthy; sagging = past capacity)`
    );
  if (allBytes.length)
    console.log(
      `  snapshot   : p50 ${(pct(allBytes, 0.5) / 1024).toFixed(1)} KB, max ${(allBytes[allBytes.length - 1] / 1024).toFixed(1)} KB; ` +
        `interval p50 ${pct(allGaps, 0.5).toFixed(0)}ms p95 ${pct(allGaps, 0.95).toFixed(0)}ms (target 50)`
    );
  console.log(`  egress     : ${mbps.toFixed(1)} Mbps observed  (≈ ${tb30.toFixed(1)} TB/30d if sustained)`);
  console.log(`  gameplay   : ${hands} hands finished this stage; intents tx ${(txCount / (holdMs / 1000)).toFixed(0)}/s`);
  if (hz?.pump)
    console.log(
      `  /healthz   : lobbies ${hz.lobbies}, conns ${hz.connections}, players ${hz.players}; ` +
        `pump busy p50 ${hz.pump.busyMs?.p50}ms p95 ${hz.pump.busyMs?.p95}ms max ${hz.pump.busyMs?.max}ms (budget 8), ` +
        `gap p95 ${hz.pump.gapMs?.p95}ms`
    );
  else console.log(`  /healthz   : unreachable at ${HEALTHZ || "(no url)"} — pump stats unavailable`);
  console.log(
    `  driver CPU : ~${cpuPct}% of one core${cpuPct > 70 ? "  ⚠ driver near its limit — results may flatter the server; fan out across machines" : ""}`
  );
  if (disconnects) console.log(`  ⚠ disconnects: ${disconnects}`);
}

/* ---------------- main ---------------- */

async function main(): Promise<void> {
  console.log(`load test → ${URL_BASE}  (healthz: ${HEALTHZ || "none"})`);
  console.log(`stages: ${STAGES.join(", ")} tables × ${SEAT_COUNT} bots, ${HOLD_S}s hold each`);

  const tables: Bot[][] = [];
  const driver = setInterval(() => {
    const now = performance.now();
    for (const t of tables) for (const b of t) b.tick(now);
  }, 100);

  for (const target of STAGES) {
    while (tables.length < target) {
      const batch = Math.min(4, target - tables.length);
      const spawned = await Promise.allSettled(
        Array.from({ length: batch }, (_, i) => spawnTable(tables.length + i + 1))
      );
      for (const s of spawned) {
        if (s.status === "fulfilled") tables.push(s.value);
        else {
          console.error(`\n✗ table spawn failed: ${s.reason?.message ?? s.reason}`);
          console.error(`  (server full? start it with a higher MAX_LOBBIES env — holding at ${tables.length} tables)\n`);
        }
      }
      if (spawned.some((s) => s.status === "rejected")) break;
      await sleep(150);
    }

    console.log(`\nstage up: ${tables.length} tables seated, settling 5s…`);
    await sleep(5000);

    txCount = 0;
    disconnects = 0;
    for (const t of tables) for (const b of t) b.resetStats();
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    let hz: Healthz | null = null;
    const poller = setInterval(async () => {
      hz = (await pollHealthz()) ?? hz;
    }, 5000);
    await sleep(HOLD_S * 1000);
    clearInterval(poller);
    hz = (await pollHealthz()) ?? hz;
    const cpu1 = process.cpuUsage(cpu0);
    report(tables, performance.now() - t0, (cpu1.user + cpu1.system) / 1000, hz);

    if (tables.length < target) break; // spawn failure above — report what we had, stop
  }

  shuttingDown = true;
  clearInterval(driver);
  for (const t of tables) for (const b of t) b.ws?.close();
  console.log("\ndone — sockets closed (empty tables fold server-side).");
  setTimeout(() => process.exit(0), 2000).unref();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
