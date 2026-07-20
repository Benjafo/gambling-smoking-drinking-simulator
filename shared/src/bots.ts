/* Dev bots: sim-driven opponents for testing multiplayer without a second
   human. A BotBrain owns no game state — every tick it reads the Simulation
   and pushes ordinary Intents through sim.applyIntent(), the same validated
   door a remote client uses. That keeps bots honest (they can't do anything
   a player couldn't) and makes them work identically at a solo worker table
   and in a server lobby.

   Difficulty sets blackjack skill, how early they top up their meters, aim,
   and how long they last: every non-autonomous bot eventually "fizzles" — a
   per-second hazard roll marks it doomed, it quietly stops consuming, and
   the meters run it into the sim's normal sobriety death. "autonomous" bots
   never touch the vices at all and die when the opening meters run dry. */
import {
  ACCESSORY_COUNT,
  HAT_COLORS,
  HAT_STYLE_COUNT,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  type Appearance,
} from "./appearance";
import { cardValue, handValue, type Card } from "./blackjack";
import {
  EYE_HEIGHT,
  MAX_FLING_SPEED,
  MIN_BET,
  TABLE,
  TICK_RATE,
  seatPosition,
  type V3,
} from "./constants";
import {
  DISPENSE_RADIUS,
  LOBBY_DISPENSERS,
  LOBBY_EYE_HEIGHT,
  LOBBY_OBSTACLES,
  LOBBY_PLAYER_R,
  LOBBY_REACH,
  LOBBY_ROOM,
} from "./lobbyRoom";
import { Rng } from "./rng";
import type { Simulation } from "./sim";
import type { BotDifficulty, ViceKind } from "./types";

const secTicks = (s: number) => Math.round(s * TICK_RATE);
const GRAVITY = 9.81; // matches physics.ts createWorld

interface Tuning {
  /* humanized reaction window (seconds) for bets and turn decisions */
  thinkMin: number;
  thinkMax: number;
  /* start a ritual when the lower meter dips under this */
  refillAt: number;
  /* chance a hit/stand decision flips (the tell of a sloppy player) */
  mistake: number;
  /* bet as a fraction of bankroll */
  betFrac: [number, number];
  /* lateral throw error, as a fraction of throw distance */
  aimJitter: number;
  /* fizzle: per-second chance (after the grace period) of going doomed */
  hazardPerSec: number;
  /* false = never consumes, buys, or dispenses — the walking egg timer */
  vices: boolean;
}

const TUNING: Record<BotDifficulty, Tuning> = {
  easy: {
    thinkMin: 1.5, thinkMax: 4, refillAt: 22, mistake: 0.15,
    betFrac: [0.1, 0.25], aimJitter: 0.3, hazardPerSec: 1 / 50, vices: true,
  },
  medium: {
    thinkMin: 1, thinkMax: 3, refillAt: 35, mistake: 0.05,
    betFrac: [0.05, 0.15], aimJitter: 0.15, hazardPerSec: 1 / 110, vices: true,
  },
  hard: {
    thinkMin: 0.7, thinkMax: 2, refillAt: 55, mistake: 0,
    betFrac: [0.05, 0.1], aimJitter: 0.06, hazardPerSec: 1 / 210, vices: true,
  },
  autonomous: {
    thinkMin: 1, thinkMax: 3, refillAt: 0, mistake: 0.05,
    betFrac: [0.05, 0.15], aimJitter: 0.15, hazardPerSec: 0, vices: false,
  },
};

/* fizzling before anyone has even bought in reads as a bug — hold the
   hazard for the run's opening stretch */
export const BOT_FIZZLE_GRACE_S = 20;

/* barfly christening: a random "ADJECTIVE NAME" pair per bot. Both pools
   stay ≤9 chars a side so the worst pairing (9+1+9) clears the join()
   24-char cap and the nameplate squeeze with room to spare */
const BOT_ADJECTIVES = [
  "SHAKY", "SALTY", "GRIZZLED", "WOOZY", "SURLY", "LUCKY",
  "JITTERY", "SMOKY", "THIRSTY", "CRUSTY", "BLEARY", "GRUMPY",
  "SLICK", "RASPY", "DUSTY", "WOBBLY", "SWEATY", "GREASY",
  "MOODY", "CRANKY", "FOGGY", "SCRAPPY", "WHEEZY", "DAPPER",
  "SHIFTY", "GROGGY", "LONESOME", "PICKLED", "SOGGY", "HUSKY",
  "TIPSY", "ORNERY", "HAGGARD", "JADED", "WIRED", "BITTER",
  "MUMBLY", "SQUINTY", "CROOKED", "UNLUCKY", "RESTLESS", "GRAVELLY",
  "SLEEPY", "NERVOUS", "STUBBORN", "BRINY", "FRAYED", "RUMPLED",
];
const BOT_NAMES = [
  "MURRAY", "SALAZAR", "DOTTIE", "EARL", "VERN", "PEACHES",
  "GUS", "RHONDA", "CLYDE", "MABEL", "BUZZ", "OPAL",
  "HAROLD", "CARL", "CONSTANCE", "PEEPY", "WANDA", "FLOYD",
  "INEZ", "DEWEY", "BLANCHE", "ROSCOE", "MYRTLE", "OTIS",
  "EUNICE", "LLOYD", "HAZEL", "MARV", "DOLORES", "WILBUR",
  "AGNES", "RUFUS", "PEARL", "ELMO", "GLADYS", "HORACE",
  "LUANN", "SEYMOUR", "BERNICE", "DUANE", "FRAN", "LESTER",
  "TILLY", "MEL", "IRMA", "WOODROW", "SADIE", "ERNIE",
  "FAY", "HUBERT", "NORMA", "ROLAND", "BETTE", "CECIL",
  "MAVIS", "ANGUS", "TRIXIE", "LOTTIE", "HANK", "GERT",
];

type Action = "hit" | "stand" | "double";

export class BotBrain {
  readonly name: string;
  readonly appearance: Appearance;
  /* public for tests: a doomed bot has stopped feeding its meters */
  doomed = false;
  private readonly tune: Tuning;
  private readonly rng: Rng;
  private lastPhase = "";
  private hazardAt = -1; // next per-second fizzle roll
  private betAt = -1; // tick to commit the pending bet
  private actAt = -1; // tick to play the pending turn decision
  private flingAt = -1; // tick to let the held empty fly
  private shopAt = -1; // restock cooldown
  private lookAt = -1; // next idle glance
  private lookYaw = 0;
  private lookPitch = 0;
  /* waiting-room legs: current destination, and what to do on arrival */
  private goal: { x: number; z: number; kind: ViceKind | null } | null = null;
  private goalDeadline = 0;
  private idleUntil = 0;
  private moving = false;

  constructor(
    readonly id: string,
    readonly difficulty: BotDifficulty,
    seed: number
  ) {
    this.tune = TUNING[difficulty];
    this.rng = new Rng(seed);
    this.name =
      BOT_ADJECTIVES[this.rng.int(BOT_ADJECTIVES.length)] +
      " " +
      BOT_NAMES[this.rng.int(BOT_NAMES.length)];
    this.appearance = {
      skin: this.rng.int(SKIN_TONES.length),
      shirt: this.rng.int(SHIRT_COLORS.length),
      pants: this.rng.int(PANTS_COLORS.length),
      hat: this.rng.int(HAT_STYLE_COUNT),
      hatColor: this.rng.int(HAT_COLORS.length),
      accessory: this.rng.int(ACCESSORY_COUNT),
    };
  }

  private think(): number {
    return secTicks(this.rng.range(this.tune.thinkMin, this.tune.thinkMax));
  }

  /* called from Simulation.step(), every tick, before the phase machinery */
  step(sim: Simulation): void {
    const p = sim.players.get(this.id);
    if (!p) return;

    // a fresh lobby (first join, restart, or run over → run back) wipes the
    // per-run state — doomed bots get a second life with everyone else
    if (sim.phase === "lobby" && this.lastPhase !== "lobby") this.reset();
    this.lastPhase = sim.phase;
    if (!p.alive || p.waiting) return;

    if (sim.phase === "lobby") return this.lobbyStep(sim, p);
    if (sim.phase === "over") return;

    this.rollFizzle(sim);
    this.glance(sim, p);
    this.viceStep(sim, p);
    if (sim.phase === "betting") this.betStep(sim, p);
    else this.betAt = -1;
    if (sim.phase === "acting" && sim.turnPlayerId === this.id) this.turnStep(sim, p);
    else this.actAt = -1;
  }

  private reset(): void {
    this.doomed = false;
    this.hazardAt = this.betAt = this.actAt = this.flingAt = this.shopAt = -1;
    this.goal = null;
    this.idleUntil = 0;
  }

  /* ---------------- fizzle ---------------- */
  private rollFizzle(sim: Simulation): void {
    if (this.doomed || this.tune.hazardPerSec <= 0) return;
    if (sim.tick < this.hazardAt) return;
    this.hazardAt = sim.tick + TICK_RATE;
    if (sim.tick - sim.runStartTick < secTicks(BOT_FIZZLE_GRACE_S)) return;
    if (this.rng.next() < this.tune.hazardPerSec) this.doomed = true;
  }

  /* ---------------- betting ---------------- */
  private betStep(sim: Simulation, p: { committed: boolean; sittingOut: boolean; money: number }): void {
    if (p.committed || p.sittingOut || p.money <= 0) {
      this.betAt = -1;
      return;
    }
    if (this.betAt < 0) this.betAt = sim.tick + this.think();
    if (sim.tick < this.betAt) return;
    this.betAt = -1;
    const frac = this.rng.range(this.tune.betFrac[0], this.tune.betFrac[1]);
    const amount = Math.max(MIN_BET, Math.floor((p.money * frac) / 10) * 10);
    sim.applyIntent(this.id, { type: "setBet", amount });
    sim.applyIntent(this.id, { type: "commitBet" });
  }

  /* ---------------- playing the hand ---------------- */
  private turnStep(sim: Simulation, p: { hand: Card[]; money: number; bet: number }): void {
    if (this.actAt < 0) this.actAt = sim.tick + this.think();
    if (sim.tick < this.actAt) return;
    this.actAt = -1; // re-schedules next tick if the turn is still ours
    let action = this.decide(p.hand, sim.dealerHand[0], p.money >= p.bet);
    if (this.tune.mistake > 0 && this.rng.next() < this.tune.mistake)
      action = action === "stand" ? "hit" : "stand";
    sim.applyIntent(this.id, { type: action });
  }

  private decide(hand: Card[], up: Card | undefined, canAfford: boolean): Action {
    const { total, soft } = handValue(hand);
    const u = up ? cardValue(up.r) : 10;
    const canDouble = hand.length === 2 && canAfford;

    if (this.difficulty === "easy") return total <= 14 ? "hit" : "stand";

    if (this.difficulty === "hard") {
      if (soft) {
        if (total >= 19) return "stand";
        if (total === 18) {
          if (canDouble && u >= 3 && u <= 6) return "double";
          return u >= 9 ? "hit" : "stand";
        }
        if (canDouble && total >= 15 && u >= 4 && u <= 6) return "double";
        return "hit";
      }
      if (total >= 17) return "stand";
      if (total >= 13) return u <= 6 ? "stand" : "hit";
      if (total === 12) return u >= 4 && u <= 6 ? "stand" : "hit";
      if (total === 11 && canDouble) return "double";
      if (total === 10 && canDouble && u <= 9) return "double";
      if (total === 9 && canDouble && u >= 3 && u <= 6) return "double";
      return "hit";
    }

    // medium (and autonomous): upcard-aware but coarse
    if (soft) return total <= 17 ? "hit" : "stand";
    if ((total === 10 || total === 11) && canDouble && this.rng.next() < 0.5) return "double";
    if (u >= 7) return total < 17 ? "hit" : "stand";
    return total < 13 ? "hit" : "stand";
  }

  /* ---------------- vices & litter ---------------- */
  private viceStep(
    sim: Simulation,
    p: {
      held: { id: number } | null;
      ritual: { engaged: boolean } | null;
      cigarMeter: number; beerMeter: number;
      cigarInv: number; beerInv: number;
      money: number; seat: number;
    }
  ): void {
    // hands full: the only move is to let it fly — pick a target and wind up
    if (p.held) {
      if (this.flingAt < 0) this.flingAt = sim.tick + secTicks(this.rng.range(0.6, 2));
      if (sim.tick >= this.flingAt) {
        this.flingAt = -1;
        this.flingDen(sim, p.seat, p.held.id);
      }
      return;
    }
    this.flingAt = -1;

    if (!this.tune.vices || this.doomed) return;

    if (p.ritual) {
      // the sim owns the ritual clock; the brain just keeps the gesture held
      if (!p.ritual.engaged) sim.applyIntent(this.id, { type: "ritualEngage", on: true });
      return;
    }

    // top up the needier meter once it dips under the comfort line
    const kind: ViceKind = p.cigarMeter <= p.beerMeter ? "cigar" : "beer";
    const meter = kind === "cigar" ? p.cigarMeter : p.beerMeter;
    const inv = kind === "cigar" ? p.cigarInv : p.beerInv;
    if (meter < this.tune.refillAt) {
      if (inv > 0) {
        sim.applyIntent(this.id, { type: "consumeStart", kind });
        sim.applyIntent(this.id, { type: "ritualEngage", on: true });
        return;
      }
      // dry: panic-buy whatever the bankroll allows, one roll per second
      if (sim.tick >= this.shopAt) {
        this.shopAt = sim.tick + TICK_RATE;
        sim.applyIntent(this.id, { type: "buy", item: kind, qty: 1 });
      }
      return;
    }
    // restock ahead of need when flush
    if (sim.tick >= this.shopAt) {
      this.shopAt = sim.tick + secTicks(this.rng.range(4, 9));
      const price = kind === "cigar" ? sim.cigarPrice : sim.beerPrice;
      if (inv < 2 && p.money > price * 4)
        sim.applyIntent(this.id, { type: "buy", item: kind, qty: Math.min(3, 1 + this.rng.int(3)) });
    }
  }

  /* a seated fling: at another gambler (the direct-hit shot), onto the felt,
     or at the floor — weighted so tables get properly trashed */
  private flingDen(sim: Simulation, seat: number, itemId: number): void {
    const eye = { ...seatPosition(seat), y: EYE_HEIGHT };
    const others = [...sim.players.values()].filter((q) => q.id !== this.id && q.alive && !q.waiting);
    const r = this.rng.next();
    let target: V3;
    if (r < 0.45 && others.length > 0) {
      const victim = others[this.rng.int(others.length)];
      const base = seatPosition(victim.seat);
      target = { x: base.x, y: this.rng.range(0.9, 1.4), z: base.z };
    } else if (r < 0.8) {
      const a = this.rng.range(0, Math.PI * 2);
      const rad = this.rng.range(0, TABLE.radius * 0.7);
      target = { x: Math.sin(a) * rad, y: TABLE.height + 0.05, z: Math.cos(a) * rad };
    } else {
      const a = this.rng.range(0, Math.PI * 2);
      const rad = this.rng.range(2.6, 3.8);
      target = { x: Math.sin(a) * rad, y: 0.05, z: 0.5 + Math.cos(a) * rad };
    }
    this.fling(sim, eye, target, itemId);
  }

  /* solve a simple ballistic arc eye → target, jittered by skill, clamped
     under the sim's fling speed cap so the aim survives validation */
  private fling(sim: Simulation, eye: V3, target: V3, itemId: number): void {
    const dist = Math.hypot(target.x - eye.x, target.z - eye.z) || 0.5;
    const err = dist * this.tune.aimJitter;
    const t = {
      x: target.x + this.rng.range(-err, err),
      y: target.y + this.rng.range(-err, err) * 0.5,
      z: target.z + this.rng.range(-err, err),
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
      flight *= 1.25; // too hot: loft a slower, higher arc instead
    }
    const dl = Math.hypot(vel.x, vel.y, vel.z) || 1;
    const origin = {
      x: eye.x + (vel.x / dl) * 0.5,
      y: eye.y + (vel.y / dl) * 0.5,
      z: eye.z + (vel.z / dl) * 0.5,
    };
    sim.applyIntent(this.id, {
      type: "fling",
      itemId,
      origin,
      vel,
      angVel: {
        x: this.rng.range(-10, 10),
        y: this.rng.range(-10, 10),
        z: this.rng.range(-10, 10),
      },
    });
  }

  /* idle head movement so seated bots read as alive on everyone's screen */
  private glance(sim: Simulation, p: { seat: number }): void {
    if (sim.tick < this.lookAt) return;
    this.lookAt = sim.tick + secTicks(this.rng.range(0.5, 1.4));
    this.lookYaw = Math.max(-1.1, Math.min(1.1, this.lookYaw + this.rng.range(-0.5, 0.5)));
    this.lookPitch = Math.max(-0.3, Math.min(0.15, this.lookPitch + this.rng.range(-0.15, 0.15)));
    sim.applyIntent(this.id, { type: "look", yaw: this.lookYaw, pitch: this.lookPitch });
    void p;
  }

  /* ---------------- the waiting room ---------------- */
  private lobbyStep(sim: Simulation, p: {
    pos: V3;
    held: { id: number } | null;
    ritual: unknown;
  }): void {
    // holding something: stop, then hurl it at a fellow loiterer or a wall
    if (p.held) {
      if (this.moving) {
        sim.applyIntent(this.id, { type: "move", dirX: 0, dirZ: 0, yaw: 0 });
        this.moving = false;
      }
      if (this.flingAt < 0) this.flingAt = sim.tick + secTicks(this.rng.range(0.5, 1.5));
      if (sim.tick >= this.flingAt) {
        this.flingAt = -1;
        this.flingLobby(sim, p);
      }
      return;
    }
    this.flingAt = -1;

    if (this.goal) return this.walkToGoal(sim, p);

    if (sim.tick < this.idleUntil) return;

    // pick the next bit of loitering
    const roll = this.rng.next();
    if (this.tune.vices && roll < 0.3) {
      // shuffle over to a dispenser for a throwable freebie
      const d = LOBBY_DISPENSERS[this.rng.int(LOBBY_DISPENSERS.length)];
      const len = Math.hypot(d.x, d.z) || 1;
      const stand = this.rng.range(0.7, DISPENSE_RADIUS - 0.35);
      this.setGoal(sim, d.x - (d.x / len) * stand, d.z - (d.z / len) * stand, d.kind);
    } else if (roll < 0.45) {
      // scavenge: grab the nearest piece of settled floor litter
      let best: { id: number; d: number } | null = null;
      for (const deb of sim.debris.values()) {
        if (deb.room !== "lobby" || deb.phase !== "settled") continue;
        const dd = Math.hypot(deb.pos.x - p.pos.x, deb.pos.z - p.pos.z);
        if (dd < LOBBY_REACH && (!best || dd < best.d)) best = { id: deb.id, d: dd };
      }
      if (best) sim.applyIntent(this.id, { type: "pickup", itemId: best.id });
      else this.idleUntil = sim.tick + secTicks(this.rng.range(0.5, 1.5));
    } else if (roll < 0.55) {
      sim.applyIntent(this.id, { type: "jump" });
      this.idleUntil = sim.tick + secTicks(this.rng.range(0.5, 1.5));
    } else {
      // wander somewhere walkable
      for (let i = 0; i < 8; i++) {
        const x = this.rng.range(-(LOBBY_ROOM.halfW - 0.5), LOBBY_ROOM.halfW - 0.5);
        const z = this.rng.range(-(LOBBY_ROOM.halfD - 0.5), LOBBY_ROOM.halfD - 0.5);
        if (LOBBY_OBSTACLES.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + LOBBY_PLAYER_R + 0.1))
          continue;
        this.setGoal(sim, x, z, null);
        break;
      }
      if (!this.goal) this.idleUntil = sim.tick + secTicks(1);
    }
  }

  private setGoal(sim: Simulation, x: number, z: number, kind: ViceKind | null): void {
    this.goal = { x, z, kind };
    this.goalDeadline = sim.tick + secTicks(8); // pushed off course? give up
  }

  private walkToGoal(sim: Simulation, p: { pos: V3 }): void {
    const g = this.goal!;
    const dx = g.x - p.pos.x;
    const dz = g.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.3 || sim.tick > this.goalDeadline) {
      const arrived = dist < DISPENSE_RADIUS - 0.1;
      sim.applyIntent(this.id, { type: "move", dirX: 0, dirZ: 0, yaw: Math.atan2(dx, dz) });
      this.moving = false;
      if (g.kind && arrived) sim.applyIntent(this.id, { type: "dispense", kind: g.kind });
      this.goal = null;
      this.idleUntil = sim.tick + secTicks(this.rng.range(0.8, 2.5));
      return;
    }
    // re-issue the held input on a slow beat: it's a direction, not a step
    if (sim.tick % 6 === 0 || !this.moving) {
      this.moving = true;
      sim.applyIntent(this.id, {
        type: "move",
        dirX: dx / dist,
        dirZ: dz / dist,
        yaw: Math.atan2(dx, dz),
        run: dist > 2.5,
      });
    }
  }

  private flingLobby(sim: Simulation, p: { pos: V3; held: { id: number } | null }): void {
    const eye = { x: p.pos.x, y: p.pos.y + LOBBY_EYE_HEIGHT, z: p.pos.z };
    const others = [...sim.players.values()].filter((q) => q.id !== this.id);
    let target: V3;
    if (this.rng.next() < 0.6 && others.length > 0) {
      const victim = others[this.rng.int(others.length)];
      target = { x: victim.pos.x, y: victim.pos.y + 1.1, z: victim.pos.z };
    } else {
      target = {
        x: this.rng.range(-LOBBY_ROOM.halfW + 0.4, LOBBY_ROOM.halfW - 0.4),
        y: this.rng.range(0.2, 1.6),
        z: this.rng.range(-LOBBY_ROOM.halfD + 0.4, LOBBY_ROOM.halfD - 0.4),
      };
    }
    this.fling(sim, eye, target, p.held!.id);
  }
}
