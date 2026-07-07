/* The authoritative simulation. Owns all game state, advances on a fixed
   60 Hz tick, accepts validated intents, and emits snapshots. The renderer
   (and eventually remote clients) never mutate state directly. */
import type RAPIER_NS from "@dimforge/rapier3d-compat";
import {
  buildShoe,
  handValue,
  isBlackjack,
  cardValue,
  settle,
  inflate,
  type Card,
} from "./blackjack";
import {
  TICK_RATE,
  START_MONEY,
  METER_MAX,
  BASE_RATE,
  RAMP,
  RATE_CAP,
  JITTER,
  DECKS,
  RESHUFFLE_AT,
  MIN_BET,
  CIGAR_PRICE_0,
  BEER_PRICE_0,
  INFLATE_EVERY_HANDS,
  RITUAL_MS,
  HELD_AUTODROP_MS,
  DEAL_STEP_MS,
  DEALER_DRAW_MS,
  RESULT_PAUSE_MS,
  BETTING_WINDOW_MS,
  ACT_TIMEOUT_MS,
  MAX_DEBRIS,
  MAX_FLING_SPEED,
  REACH_RADIUS,
  SEAT_COUNT,
  seatEye,
  type V3,
} from "./constants";
import { Rng } from "./rng";
import { RAPIER, createWorld, spawnDebrisBody, initPhysics } from "./physics";
import type {
  Intent,
  PlayerSnap,
  DebrisSnap,
  SimEvent,
  Snapshot,
  RoomPhase,
  ViceKind,
  Quat,
} from "./types";

const msTicks = (ms: number) => Math.round((ms / 1000) * TICK_RATE);

interface Player {
  id: string;
  name: string;
  seat: number;
  money: number;
  pendingBet: number;
  lastBet: number;
  committed: boolean;
  bet: number;
  doubled: boolean;
  stood: boolean;
  hand: Card[];
  cigarMeter: number;
  beerMeter: number;
  cigarDrift: number;
  beerDrift: number;
  cigarInv: number;
  beerInv: number;
  /* gesture-driven: progress accrues only while the client reports the
     ritual engaged (cigar held still in the zone / beer tipped up). The sim
     owns the clock, so the time cost can't be skipped. */
  ritual: { kind: ViceKind; progressTicks: number; engaged: boolean } | null;
  held: { id: number; kind: ViceKind; sinceTick: number } | null;
  alive: boolean;
  causeOfDeath: string | null;
  stats: { handsPlayed: number; cigarsSmoked: number; beersDrunk: number; peakMoney: number };
}

interface Debris {
  id: number;
  kind: ViceKind;
  phase: "flying" | "settled";
  body: RAPIER_NS.RigidBody | null;
  pos: V3;
  rot: Quat;
  bornTick: number;
  stillTicks: number;
}

interface ScheduledAction {
  at: number;
  run: () => void;
}

export class Simulation {
  tick = 0;
  rng: Rng;
  world: RAPIER_NS.World;
  eventQueue: RAPIER_NS.EventQueue;

  phase: RoomPhase = "lobby";
  players = new Map<string, Player>();
  seatTaken: (string | null)[] = new Array(SEAT_COUNT).fill(null);
  shoe: Card[] = [];
  dealerHand: Card[] = [];
  holeHidden = true;
  turnPlayerId: string | null = null;
  turnDeadline = 0;
  bettingDeadline = 0;
  cigarPrice = CIGAR_PRICE_0;
  beerPrice = BEER_PRICE_0;
  handsPlayed = 0;
  runStartTick = 0;

  debris = new Map<number, Debris>();
  nextDebrisId = 1;
  private events: SimEvent[] = [];
  private schedule: ScheduledAction[] = [];
  private lastImpactTick = 0;

  private constructor(seed: number) {
    this.rng = new Rng(seed);
    this.world = createWorld();
    this.eventQueue = new RAPIER.EventQueue(true);
    this.shoe = buildShoe(DECKS, this.rng);
  }

  static async create(seed: number): Promise<Simulation> {
    await initPhysics();
    return new Simulation(seed);
  }

  /* ---------------- intents ---------------- */
  applyIntent(playerId: string, intent: Intent): void {
    if (intent.type === "join") return this.join(playerId, intent.name);
    const p = this.players.get(playerId);
    if (!p) return;

    switch (intent.type) {
      case "leave":
        this.removePlayer(p);
        break;
      case "setBet":
        if (this.phase === "betting" && p.alive && !p.committed)
          p.pendingBet = Math.max(0, Math.min(Math.floor(intent.amount), p.money));
        break;
      case "commitBet":
        this.commitBet(p);
        break;
      case "hit":
        this.hit(p);
        break;
      case "stand":
        this.stand(p);
        break;
      case "double":
        this.double(p);
        break;
      case "buy":
        this.buy(p, intent.item, Math.max(1, Math.floor(intent.qty)));
        break;
      case "consumeStart":
        this.consumeStart(p, intent.kind);
        break;
      case "ritualEngage":
        if (p.ritual) p.ritual.engaged = intent.on;
        break;
      case "ritualReset":
        if (p.ritual) p.ritual.progressTicks = 0;
        break;
      case "consumeCancel":
        p.ritual = null;
        break;
      case "fling":
        this.fling(p, intent.itemId, intent.origin, intent.vel, intent.angVel);
        break;
      case "pickup":
        this.pickup(p, intent.itemId);
        break;
      case "restart":
        this.restart();
        break;
    }
  }

  private join(playerId: string, name: string): void {
    if (this.players.has(playerId)) return;
    // prefer the middle seat, then fan outward
    const order = [2, 1, 3, 0, 4].filter((i) => i < SEAT_COUNT);
    const seat = order.find((i) => this.seatTaken[i] === null);
    if (seat === undefined) return;
    this.seatTaken[seat] = playerId;
    this.players.set(playerId, {
      id: playerId,
      name: name.slice(0, 24) || "DEGENERATE",
      seat,
      money: START_MONEY,
      pendingBet: 0,
      lastBet: 0,
      committed: false,
      bet: 0,
      doubled: false,
      stood: false,
      hand: [],
      cigarMeter: METER_MAX,
      beerMeter: METER_MAX,
      cigarDrift: 0,
      beerDrift: 0,
      cigarInv: 3,
      beerInv: 3,
      ritual: null,
      held: null,
      alive: true,
      causeOfDeath: null,
      stats: { handsPlayed: 0, cigarsSmoked: 0, beersDrunk: 0, peakMoney: START_MONEY },
    });
    if (this.phase === "lobby") {
      this.phase = "betting";
      this.runStartTick = this.tick;
    }
  }

  private removePlayer(p: Player): void {
    if (p.held) this.autoDrop(p); // don't vanish a held bottle
    this.seatTaken[p.seat] = null;
    this.players.delete(p.id);
    if (this.turnPlayerId === p.id) this.advanceTurn();
    if (this.players.size === 0) {
      this.phase = "lobby";
      this.schedule = [];
    }
  }

  /* ---------------- betting / dealing ---------------- */
  private bettors(): Player[] {
    return [...this.players.values()]
      .filter((p) => p.alive && p.committed)
      .sort((a, b) => a.seat - b.seat);
  }

  private commitBet(p: Player): void {
    if (this.phase !== "betting" || !p.alive || p.committed || p.money <= 0) return;
    const minBet = Math.min(MIN_BET, p.money);
    p.bet = Math.max(minBet, Math.min(p.pendingBet, p.money));
    p.lastBet = p.bet;
    this.setMoney(p, p.money - p.bet);
    p.committed = true;
    p.doubled = false;
    p.stood = false;
    p.hand = [];

    if (this.bettors().length === 1)
      this.bettingDeadline = this.tick + msTicks(BETTING_WINDOW_MS);

    const canStillJoin = [...this.players.values()].some(
      (q) => q.alive && !q.committed && q.money > 0
    );
    if (!canStillJoin) this.startDealing();
  }

  private startDealing(): void {
    if (this.phase !== "betting") return;
    this.phase = "dealing";
    this.bettingDeadline = 0;
    this.dealerHand = [];
    this.holeHidden = true;
    if (this.shoe.length < RESHUFFLE_AT + this.bettors().length * 4)
      this.shoe = buildShoe(DECKS, this.rng);

    const order = this.bettors();
    let step = 1;
    const stepTicks = msTicks(DEAL_STEP_MS);
    for (const round of [0, 1]) {
      for (const pl of order) {
        const id = pl.id;
        this.later(stepTicks * step++, () => {
          const p = this.players.get(id);
          if (p) p.hand.push(this.draw());
        });
      }
      this.later(stepTicks * step++, () => {
        this.dealerHand.push(this.draw());
      });
      void round;
    }
    this.later(stepTicks * step + msTicks(400), () => this.afterDeal());
  }

  private draw(): Card {
    if (this.shoe.length < 1) this.shoe = buildShoe(DECKS, this.rng);
    return this.shoe.pop()!;
  }

  private afterDeal(): void {
    const up = this.dealerHand[0];
    const dBJ = isBlackjack(this.dealerHand);
    const peeks = up.r === "A" || cardValue(up.r) === 10;
    if (peeks && dBJ) {
      this.holeHidden = false;
      this.later(msTicks(700), () => this.settleRound());
      this.phase = "dealer";
      return;
    }
    this.phase = "acting";
    this.turnPlayerId = null;
    this.advanceTurn();
  }

  private advanceTurn(): void {
    if (this.phase !== "acting") return;
    const order = this.bettors();
    const fromSeat =
      this.turnPlayerId !== null ? this.players.get(this.turnPlayerId)?.seat ?? -1 : -1;
    const next = order.find(
      (p) =>
        p.seat > fromSeat &&
        p.alive &&
        !p.stood &&
        !isBlackjack(p.hand) &&
        handValue(p.hand).total < 21
    );
    if (next) {
      this.turnPlayerId = next.id;
      this.turnDeadline = this.tick + msTicks(ACT_TIMEOUT_MS);
      return;
    }
    this.turnPlayerId = null;
    this.dealerPlay();
  }

  private hit(p: Player): void {
    if (this.phase !== "acting" || this.turnPlayerId !== p.id) return;
    if (p.stood || handValue(p.hand).total >= 21) return;
    p.hand.push(this.draw());
    this.turnDeadline = this.tick + msTicks(ACT_TIMEOUT_MS);
    if (handValue(p.hand).total >= 21) this.later(msTicks(750), () => this.advanceTurn());
  }

  private stand(p: Player): void {
    if (this.phase !== "acting" || this.turnPlayerId !== p.id) return;
    // stood=true makes the turn holder inert until advanceTurn scans past them
    p.stood = true;
    this.later(msTicks(300), () => this.advanceTurn());
  }

  private double(p: Player): void {
    if (
      this.phase !== "acting" ||
      this.turnPlayerId !== p.id ||
      p.hand.length !== 2 ||
      p.money < p.bet
    )
      return;
    this.setMoney(p, p.money - p.bet);
    p.bet *= 2;
    p.doubled = true;
    p.hand.push(this.draw());
    p.stood = true;
    this.later(msTicks(750), () => this.advanceTurn());
  }

  private dealerPlay(): void {
    this.phase = "dealer";
    this.holeHidden = false;
    const anyContest = this.bettors().some(
      (p) => handValue(p.hand).total <= 21 && !isBlackjack(p.hand)
    );
    if (!anyContest) {
      this.later(msTicks(700), () => this.settleRound());
      return;
    }
    const step = () => {
      if (this.phase !== "dealer") return;
      if (handValue(this.dealerHand).total < 17) {
        this.dealerHand.push(this.draw());
        this.later(msTicks(DEALER_DRAW_MS), step);
      } else {
        this.settleRound();
      }
    };
    this.later(msTicks(DEALER_DRAW_MS), step);
  }

  private settleRound(): void {
    this.phase = "settle";
    this.holeHidden = false;
    const d = handValue(this.dealerHand).total;
    const dBJ = isBlackjack(this.dealerHand);
    for (const p of this.bettors()) {
      const res = settle(handValue(p.hand).total, d, isBlackjack(p.hand), dBJ, p.bet);
      this.setMoney(p, p.money + res.back);
      p.stats.handsPlayed++;
      this.events.push({
        t: "result",
        playerId: p.id,
        label: res.label,
        kind: res.kind,
        delta: res.back - p.bet,
      });
    }
    this.handsPlayed++;
    if (this.handsPlayed % INFLATE_EVERY_HANDS === 0) {
      this.cigarPrice = inflate(this.cigarPrice);
      this.beerPrice = inflate(this.beerPrice);
    }
    this.later(msTicks(RESULT_PAUSE_MS), () => this.endRound());
  }

  private endRound(): void {
    for (const p of this.players.values()) {
      p.committed = false;
      p.bet = 0;
      // provably unable to continue: broke with no vices left
      if (p.alive && p.money <= 0 && p.cigarInv === 0 && p.beerInv === 0)
        this.eliminate(p, "BANKRUPT. THE HOUSE ALWAYS WINS.");
    }
    if (![...this.players.values()].some((p) => p.alive)) {
      this.phase = "over";
      this.schedule = [];
      return;
    }
    this.phase = "betting";
    this.dealerHand = [];
    this.holeHidden = true;
  }

  private restart(): void {
    if (this.phase !== "over") return;
    // debris persists across runs — the den stays filthy
    for (const p of this.players.values()) {
      p.money = START_MONEY;
      p.pendingBet = 0;
      p.lastBet = 0;
      p.committed = false;
      p.bet = 0;
      p.hand = [];
      p.stood = false;
      p.doubled = false;
      p.cigarMeter = METER_MAX;
      p.beerMeter = METER_MAX;
      p.cigarInv = 3;
      p.beerInv = 3;
      p.ritual = null;
      p.alive = true;
      p.causeOfDeath = null;
      p.stats = { handsPlayed: 0, cigarsSmoked: 0, beersDrunk: 0, peakMoney: START_MONEY };
    }
    this.cigarPrice = CIGAR_PRICE_0;
    this.beerPrice = BEER_PRICE_0;
    this.handsPlayed = 0;
    this.dealerHand = [];
    this.holeHidden = true;
    this.shoe = buildShoe(DECKS, this.rng);
    this.runStartTick = this.tick;
    this.phase = "betting";
  }

  /* ---------------- vices ---------------- */
  private setMoney(p: Player, n: number): void {
    p.money = n;
    if (n > p.stats.peakMoney) p.stats.peakMoney = n;
  }

  private buy(p: Player, item: ViceKind, qty: number): void {
    if (!p.alive || this.phase === "over") return;
    const price = (item === "cigar" ? this.cigarPrice : this.beerPrice) * qty;
    if (p.money < price) return;
    this.setMoney(p, p.money - price);
    if (item === "cigar") p.cigarInv += qty;
    else p.beerInv += qty;
  }

  private consumeStart(p: Player, kind: ViceKind): void {
    if (!p.alive || p.ritual) return;
    if (kind === "cigar" && p.cigarInv < 1) return;
    if (kind === "beer" && p.beerInv < 1) return;
    p.ritual = { kind, progressTicks: 0, engaged: false };
  }

  private completeRitual(p: Player): void {
    const kind = p.ritual!.kind;
    p.ritual = null;
    if (kind === "cigar") {
      if (p.cigarInv < 1) return;
      p.cigarInv--;
      p.stats.cigarsSmoked++;
      p.cigarMeter = METER_MAX; // a good cigar fixes everything
    } else {
      if (p.beerInv < 1) return;
      p.beerInv--;
      p.stats.beersDrunk++;
      p.beerMeter = METER_MAX; // drained to the last drop
    }
    if (p.held) this.autoDrop(p); // hands full: old empty tumbles off
    p.held = { id: this.nextDebrisId++, kind, sinceTick: this.tick };
  }

  /* ---------------- debris & fling ---------------- */
  private fling(p: Player, itemId: number, origin: V3, vel: V3, angVel: V3): void {
    if (!p.held || p.held.id !== itemId) return;
    const eye = seatEye(p.seat);
    // clamp origin to arm's length of the seat — no teleport-throws
    const dx = origin.x - eye.x,
      dy = origin.y - eye.y,
      dz = origin.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    const o =
      dist > 1.0
        ? { x: eye.x + (dx / dist) * 1.0, y: eye.y + (dy / dist) * 1.0, z: eye.z + (dz / dist) * 1.0 }
        : origin;
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    const s = speed > MAX_FLING_SPEED ? MAX_FLING_SPEED / speed : 1;
    const v = { x: vel.x * s, y: vel.y * s, z: vel.z * s };
    const maxSpin = 25;
    const av = {
      x: Math.max(-maxSpin, Math.min(maxSpin, angVel.x)),
      y: Math.max(-maxSpin, Math.min(maxSpin, angVel.y)),
      z: Math.max(-maxSpin, Math.min(maxSpin, angVel.z)),
    };
    this.spawnDebris(p.held.kind, o, v, av);
    this.events.push({ t: "fling", playerId: p.id, id: p.held.id });
    p.held = null;
  }

  private autoDrop(p: Player): void {
    if (!p.held) return;
    const eye = seatEye(p.seat);
    // gentle lob toward the table
    const toward = { x: -eye.x, y: 0, z: -eye.z };
    const len = Math.hypot(toward.x, toward.z) || 1;
    this.spawnDebris(
      p.held.kind,
      { x: eye.x + (toward.x / len) * 0.4, y: eye.y - 0.1, z: eye.z + (toward.z / len) * 0.4 },
      {
        x: (toward.x / len) * this.rng.range(0.8, 1.6),
        y: this.rng.range(0.3, 0.8),
        z: (toward.z / len) * this.rng.range(0.8, 1.6),
      },
      { x: this.rng.range(-6, 6), y: this.rng.range(-6, 6), z: this.rng.range(-6, 6) }
    );
    p.held = null;
  }

  private spawnDebris(kind: ViceKind, origin: V3, vel: V3, angVel: V3): void {
    const id = this.nextDebrisId++;
    const body = spawnDebrisBody(this.world, kind, origin, vel, angVel);
    this.debris.set(id, {
      id,
      kind,
      phase: "flying",
      body,
      pos: { ...origin },
      rot: { x: 0, y: 0, z: 0, w: 1 },
      bornTick: this.tick,
      stillTicks: 0,
    });
    this.enforceDebrisCap();
  }

  private enforceDebrisCap(): void {
    if (this.debris.size <= MAX_DEBRIS) return;
    let oldest: Debris | null = null;
    for (const d of this.debris.values())
      if (d.phase === "settled" && (!oldest || d.bornTick < oldest.bornTick)) oldest = d;
    if (oldest) this.removeDebris(oldest);
  }

  private removeDebris(d: Debris): void {
    if (d.body) this.world.removeRigidBody(d.body);
    this.debris.delete(d.id);
  }

  private pickup(p: Player, itemId: number): void {
    if (!p.alive || p.held || p.ritual) return;
    const d = this.debris.get(itemId);
    if (!d || d.phase !== "settled") return;
    const eye = seatEye(p.seat);
    if (Math.hypot(d.pos.x - eye.x, d.pos.y - eye.y, d.pos.z - eye.z) > REACH_RADIUS) return;
    this.removeDebris(d);
    p.held = { id: this.nextDebrisId++, kind: d.kind, sinceTick: this.tick };
  }

  /* ---------------- tick ---------------- */
  step(): void {
    this.tick++;
    if (this.phase === "lobby") return;

    // scheduled round actions
    if (this.schedule.length) {
      const due = this.schedule.filter((a) => a.at <= this.tick);
      this.schedule = this.schedule.filter((a) => a.at > this.tick);
      for (const a of due) a.run();
    }

    // betting window: once someone commits, stragglers eventually sit out
    if (this.phase === "betting" && this.bettingDeadline && this.tick >= this.bettingDeadline)
      this.startDealing();

    // AFK turn timeout
    if (this.phase === "acting" && this.turnPlayerId && this.tick >= this.turnDeadline) {
      const p = this.players.get(this.turnPlayerId);
      if (p) {
        p.stood = true;
        this.advanceTurn();
      }
    }

    if (this.phase !== "over") this.tickMetersAndRituals();
    this.stepPhysics();
  }

  private tickMetersAndRituals(): void {
    const elapsedMin = Math.floor((this.tick - this.runStartTick) / TICK_RATE / 60);
    const base = Math.min(RATE_CAP, BASE_RATE + RAMP * elapsedMin);
    const dt = 1 / TICK_RATE;

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      p.cigarDrift = Math.max(
        -JITTER,
        Math.min(JITTER, p.cigarDrift + (this.rng.next() - 0.5) * 0.12)
      );
      p.beerDrift = Math.max(
        -JITTER,
        Math.min(JITTER, p.beerDrift + (this.rng.next() - 0.5) * 0.12)
      );
      p.cigarMeter -= (base + p.cigarDrift) * dt;
      p.beerMeter -= (base + p.beerDrift) * dt;

      if (p.ritual?.engaged) {
        p.ritual.progressTicks++;
        if (p.ritual.progressTicks >= msTicks(RITUAL_MS[p.ritual.kind])) this.completeRitual(p);
      }

      if (p.held && this.tick - p.held.sinceTick > msTicks(HELD_AUTODROP_MS)) this.autoDrop(p);

      if (p.cigarMeter <= 0) this.eliminate(p, "DIED OF SOBRIETY (CIGAR WITHDRAWAL)");
      else if (p.beerMeter <= 0) this.eliminate(p, "DIED OF SOBRIETY (DEHYDRATION BY SOBRIETY)");
    }
  }

  private eliminate(p: Player, cause: string): void {
    if (!p.alive) return;
    p.alive = false;
    p.causeOfDeath = cause;
    p.ritual = null;
    if (p.held) this.autoDrop(p);
    this.events.push({ t: "eliminated", playerId: p.id, cause });
    if (this.turnPlayerId === p.id) this.advanceTurn();
    if (![...this.players.values()].some((q) => q.alive)) {
      this.phase = "over";
      this.schedule = [];
    }
  }

  private stepPhysics(): void {
    this.world.step(this.eventQueue);

    // impact events for sound, throttled
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started || this.tick - this.lastImpactTick < 4) return;
      const c1 = this.world.getCollider(h1);
      const c2 = this.world.getCollider(h2);
      const body = c1?.parent() ?? c2?.parent();
      if (!body) return;
      const v = body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed < 0.6) return;
      const t = body.translation();
      this.lastImpactTick = this.tick;
      this.events.push({ t: "impact", speed, pos: { x: t.x, y: t.y, z: t.z } });
    });

    for (const d of [...this.debris.values()]) {
      if (d.phase !== "flying" || !d.body) continue;
      const t = d.body.translation();
      const r = d.body.rotation();
      d.pos = { x: t.x, y: t.y, z: t.z };
      d.rot = { x: r.x, y: r.y, z: r.z, w: r.w };
      if (t.y < -5) {
        this.removeDebris(d);
        continue;
      }
      // settle by policy, not just isSleeping(): tiny capsules never cross
      // Rapier's sleep threshold (contact-solver jitter keeps ~1 rad/s of
      // imperceptible spin alive forever)
      const lv = d.body.linvel();
      const av = d.body.angvel();
      const slow =
        Math.hypot(lv.x, lv.y, lv.z) < 0.08 && Math.hypot(av.x, av.y, av.z) < 2.5;
      d.stillTicks = slow ? d.stillTicks + 1 : 0;
      if (d.body.isSleeping() || d.stillTicks > 45) {
        // freeze into scenery: fixed body keeps the collider, costs nothing
        d.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
        d.phase = "settled";
      }
    }
  }

  private later(delayTicks: number, run: () => void): void {
    this.schedule.push({ at: this.tick + Math.max(1, delayTicks), run });
  }

  /* ---------------- snapshot ---------------- */
  snapshot(): Snapshot {
    const players: PlayerSnap[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      money: Math.round(p.money),
      pendingBet: p.pendingBet,
      lastBet: p.lastBet,
      committed: p.committed,
      bet: p.bet,
      doubled: p.doubled,
      stood: p.stood,
      hand: p.hand,
      cigarMeter: p.cigarMeter,
      beerMeter: p.beerMeter,
      cigarInv: p.cigarInv,
      beerInv: p.beerInv,
      ritual: p.ritual
        ? {
            kind: p.ritual.kind,
            progress: Math.min(1, p.ritual.progressTicks / msTicks(RITUAL_MS[p.ritual.kind])),
          }
        : null,
      held: p.held ? { id: p.held.id, kind: p.held.kind } : null,
      alive: p.alive,
      causeOfDeath: p.causeOfDeath,
      stats: { ...p.stats },
    }));

    const debris: DebrisSnap[] = [...this.debris.values()].map((d) => ({
      id: d.id,
      kind: d.kind,
      phase: d.phase,
      pos: d.pos,
      rot: d.rot,
    }));

    const events = this.events;
    this.events = [];

    return {
      tick: this.tick,
      phase: this.phase,
      dealerHand: this.holeHidden
        ? this.dealerHand.map((c, i) => (i === 1 ? { r: "?", s: "?" } : c))
        : this.dealerHand,
      holeHidden: this.holeHidden,
      turnPlayerId: this.turnPlayerId,
      cigarPrice: this.cigarPrice,
      beerPrice: this.beerPrice,
      handsPlayed: this.handsPlayed,
      elapsed: (this.tick - this.runStartTick) / TICK_RATE,
      players,
      debris,
      events,
    };
  }
}
