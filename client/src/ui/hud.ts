/* DOM overlay HUD — the original game's UI language, now rendering snapshots
   and emitting intents instead of mutating state. */
import { MIN_BET } from "@shared/constants";
import type { Intent, PlayerSnap, Snapshot } from "@shared/types";

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const CHIP_LADDER = [
  10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000,
  1000000,
];
function chipDenoms(money: number): number[] {
  let hi = 3;
  for (let i = CHIP_LADDER.length - 1; i >= 3; i--) {
    if (CHIP_LADDER[i] <= Math.max(money / 2, 100)) {
      hi = i;
      break;
    }
  }
  return CHIP_LADDER.slice(hi - 3, hi + 1);
}
function chipLabel(n: number): string {
  return n >= 1000 ? n / 1000 + "K" : "$" + n;
}
function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}
function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60),
    s = Math.floor(sec % 60);
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

const FLAVOR = [
  "The dealer doesn't blink.",
  "Another beer won't hurt.",
  "You could stop. You won't.",
  "The exit sign burned out in 1987.",
  "Your lungs file a formal complaint. Denied.",
  "The felt remembers every bad decision.",
  "Statistically, you've already lost.",
  "The house always wins. You always stay.",
  "Somewhere, your money is having a great time.",
  "The cigar smoke spells out 'why'.",
  "That bottle isn't going to throw itself.",
  "Luck is a rumor. Thirst is a fact.",
];

export class Hud {
  private snap: Snapshot | null = null;
  private myId = "";
  private me: PlayerSnap | undefined;
  private localPending = 0;
  private pendingDirty = false;
  private displayedMoney = 0;
  private chipSig = "";
  private bannerTimer: number | undefined;
  private wasOver = false;

  constructor(private send: (i: Intent) => void) {
    this.wire();
    const loop = () => {
      this.moneyFrame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    setInterval(() => this.cycleFlavor(), 8000);
  }

  /* ---------------- wiring ---------------- */
  private wire(): void {
    $("startBtn").addEventListener("click", () => {
      this.send({ type: "join", name: "YOU" });
      $("titleScreen").classList.remove("active");
      $("hud").classList.add("active");
    });
    $("retryBtn").addEventListener("click", () => {
      this.send({ type: "restart" });
      $("overScreen").classList.remove("active");
      this.wasOver = false;
    });

    $("dealBtn").addEventListener("click", () => {
      this.send({ type: "setBet", amount: this.localPending });
      this.send({ type: "commitBet" });
    });
    $("hitBtn").addEventListener("click", () => this.send({ type: "hit" }));
    $("standBtn").addEventListener("click", () => this.send({ type: "stand" }));
    $("doubleBtn").addEventListener("click", () => this.send({ type: "double" }));

    $("chipRack").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest(".chip-step") as HTMLButtonElement | null;
      if (!b || b.disabled) return;
      const d = Number(b.dataset.denom);
      this.adjustBet(b.classList.contains("plus") ? d : -d);
    });
    document.querySelectorAll(".preset-btn[data-preset]").forEach((b) =>
      b.addEventListener("click", () => this.applyPreset((b as HTMLElement).dataset.preset!))
    );
    $("betClear").addEventListener("click", () => this.setPending(0));

    $("buyCigar1").addEventListener("click", () => this.send({ type: "buy", item: "cigar", qty: 1 }));
    $("buyCigar5").addEventListener("click", () => this.send({ type: "buy", item: "cigar", qty: 5 }));
    $("buyBeer1").addEventListener("click", () => this.send({ type: "buy", item: "beer", qty: 1 }));
    $("buyBeer5").addEventListener("click", () => this.send({ type: "buy", item: "beer", qty: 5 }));

    this.wireVice($("smokeBtn"), "cigar");
    this.wireVice($("drinkBtn"), "beer");
  }

  private wireVice(btn: HTMLElement, kind: "cigar" | "beer"): void {
    const start = (e: Event) => {
      e.preventDefault();
      this.send({ type: "consumeStart", kind });
    };
    const cancel = () => this.send({ type: "consumeCancel" });
    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", cancel);
    btn.addEventListener("pointerleave", cancel);
  }

  private adjustBet(delta: number): void {
    this.setPending(this.localPending + delta);
  }
  private setPending(v: number): void {
    const max = this.me?.money ?? 0;
    this.localPending = Math.max(0, Math.min(v, max));
    this.pendingDirty = true;
    this.send({ type: "setBet", amount: this.localPending });
    this.renderBetting();
  }
  private applyPreset(kind: string): void {
    const money = this.me?.money ?? 0;
    if (kind === "min") this.setPending(Math.min(MIN_BET, money));
    if (kind === "half") this.setPending(Math.floor(money / 2));
    if (kind === "allin") this.setPending(money);
    if (kind === "rebet") this.setPending(this.me?.lastBet ?? 0);
  }

  /* ---------------- snapshot → DOM ---------------- */
  apply(snap: Snapshot, myId: string): void {
    this.snap = snap;
    this.myId = myId;
    this.me = snap.players.find((p) => p.id === myId);
    const me = this.me;
    if (!me) return;

    if (!this.pendingDirty) this.localPending = me.pendingBet;
    this.pendingDirty = false;

    $("handsDisplay").textContent = String(me.stats.handsPlayed);
    $("timeDisplay").textContent = fmtTime(snap.elapsed);
    $("phaseDisplay").textContent = this.phaseLabel(snap, me);

    // meters
    this.meter($("cigarFill"), me.cigarMeter);
    this.meter($("beerFill"), me.beerMeter);
    $("cigarInv").textContent = "×" + me.cigarInv;
    $("beerInv").textContent = "×" + me.beerInv;
    document.body.classList.toggle(
      "panic",
      me.alive && snap.phase !== "over" && (me.cigarMeter < 20 || me.beerMeter < 20)
    );

    // ritual progress
    const cig = me.ritual?.kind === "cigar" ? me.ritual.progress : 0;
    const beer = me.ritual?.kind === "beer" ? me.ritual.progress : 0;
    $("cigarRitual").style.width = cig * 100 + "%";
    $("beerRitual").style.width = beer * 100 + "%";
    (($("smokeBtn")) as HTMLButtonElement).disabled = !me.alive || me.cigarInv < 1;
    (($("drinkBtn")) as HTMLButtonElement).disabled = !me.alive || me.beerInv < 1;

    // shop
    $("cigarPrice").textContent = fmtMoney(snap.cigarPrice);
    $("beerPrice").textContent = fmtMoney(snap.beerPrice);
    ($("buyCigar1") as HTMLButtonElement).disabled = !me.alive || me.money < snap.cigarPrice;
    ($("buyCigar5") as HTMLButtonElement).disabled = !me.alive || me.money < snap.cigarPrice * 5;
    ($("buyBeer1") as HTMLButtonElement).disabled = !me.alive || me.money < snap.beerPrice;
    ($("buyBeer5") as HTMLButtonElement).disabled = !me.alive || me.money < snap.beerPrice * 5;

    this.renderBetting();
    $("flingHint").classList.toggle("show", me.held !== null);

    for (const ev of snap.events) {
      if (ev.t === "result" && ev.playerId === this.myId)
        this.banner(
          ev.label + (ev.delta > 0 ? "  +" + fmtMoney(ev.delta) : ev.delta < 0 ? "  −" + fmtMoney(-ev.delta) : ""),
          ev.kind
        );
    }

    if (snap.phase === "over" && !this.wasOver) {
      this.wasOver = true;
      this.showOver(me);
    }
  }

  private phaseLabel(snap: Snapshot, me: PlayerSnap): string {
    if (!me.alive) return "DEAD";
    switch (snap.phase) {
      case "betting":
        return me.committed ? "WAITING FOR THE TABLE" : "PLACE YOUR BET";
      case "dealing":
        return "DEALING";
      case "acting":
        return snap.turnPlayerId === this.myId ? "YOUR TURN" : "TABLE ACTS";
      case "dealer":
        return "DEALER PLAYS";
      case "settle":
        return "SETTLING";
      default:
        return "";
    }
  }

  private renderBetting(): void {
    const snap = this.snap;
    const me = this.me;
    if (!snap || !me) return;
    const betting = snap.phase === "betting" && me.alive && !me.committed && me.money > 0;
    const myTurn = snap.phase === "acting" && snap.turnPlayerId === this.myId;

    $("betPanel").style.display = betting ? "" : "none";
    $("playPanel").style.display = myTurn ? "" : "none";
    $("betDisplay").textContent = fmtMoney(this.localPending);

    const hint = !me.alive
      ? "You are a cautionary tale now."
      : me.money <= 0 && !me.committed
        ? "No money. No bets. Only vices remain."
        : betting
          ? "Chips stack. Min bet $10. The meters don't wait."
          : "";
    $("dockHint").textContent = hint;

    if (betting) {
      const denoms = chipDenoms(me.money);
      const sig = denoms.join(",");
      if (sig !== this.chipSig) {
        this.chipSig = sig;
        $("chipRack").innerHTML = denoms
          .map(
            (v, i) =>
              `<div class="chip-stepper">
                 <button class="chip-step plus" data-denom="${v}" aria-label="Add ${chipLabel(v)}">＋</button>
                 <div class="chip-face c${i}">${chipLabel(v)}</div>
                 <button class="chip-step minus" data-denom="${v}" aria-label="Remove ${chipLabel(v)}">−</button>
               </div>`
          )
          .join("");
      }
      document.querySelectorAll<HTMLButtonElement>("#chipRack .plus").forEach(
        (b) => (b.disabled = this.localPending >= me.money)
      );
      document.querySelectorAll<HTMLButtonElement>("#chipRack .minus").forEach(
        (b) => (b.disabled = this.localPending <= 0)
      );
      ($("rebetBtn") as HTMLButtonElement).disabled = me.lastBet <= 0;
    }

    if (myTurn) {
      ($("doubleBtn") as HTMLButtonElement).disabled = !(me.hand.length === 2 && me.money >= me.bet);
      $("betInPlay").textContent = "Bet: " + fmtMoney(me.bet) + (me.doubled ? " (doubled)" : "");
    }
  }

  private meter(fill: HTMLElement, v: number): void {
    fill.style.width = Math.max(0, v) + "%";
    fill.className = "fill " + (v > 50 ? "ok" : v >= 20 ? "warn" : "bad");
  }

  private banner(text: string, kind: string): void {
    const b = $("banner");
    b.textContent = text;
    b.className = "show " + kind;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (b.className = ""), 1500);
  }

  private showOver(me: PlayerSnap): void {
    $("deathCause").textContent = me.causeOfDeath ?? "THE HOUSE OUTLASTED YOU.";
    $("overStats").innerHTML =
      `Hands played ......... <b>${me.stats.handsPlayed}</b><br>` +
      `Peak money ........... <b>${fmtMoney(me.stats.peakMoney)}</b><br>` +
      `Final money .......... <b>${fmtMoney(me.money)}</b><br>` +
      `Cigars smoked ........ <b>${me.stats.cigarsSmoked}</b><br>` +
      `Beers drunk .......... <b>${me.stats.beersDrunk}</b><br>` +
      `Litter on the floor .. <b>${this.snap?.debris.length ?? 0}</b><br>` +
      `Time survived ........ <b>${fmtTime(this.snap?.elapsed ?? 0)}</b>`;
    $("overScreen").classList.add("active");
  }

  private moneyFrame(): void {
    const target = this.me?.money ?? 0;
    const diff = target - this.displayedMoney;
    if (Math.abs(diff) < 1) this.displayedMoney = target;
    else this.displayedMoney += diff * 0.18;
    const el = $("moneyDisplay");
    el.textContent = fmtMoney(this.displayedMoney);
    el.className = "money" + (diff > 1 ? " up" : diff < -1 ? " down" : "");
  }

  private cycleFlavor(): void {
    const el = $("flavorBar");
    el.style.opacity = "0";
    setTimeout(() => {
      el.textContent = FLAVOR[Math.floor(Math.random() * FLAVOR.length)];
      el.style.opacity = "1";
    }, 500);
  }
}
