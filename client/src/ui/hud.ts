/* DOM overlay HUD — the original game's UI language, now rendering snapshots
   and emitting intents instead of mutating state. */
import { MIN_BET, TOLERANCE_MAX, TOLERANCE_PER_USE } from "@shared/constants";
import { handValue } from "@shared/blackjack";
import type { Intent, PlayerSnap, Snapshot } from "@shared/types";
import { chipLabel, chipStyle } from "../chips";

const $ = (id: string): HTMLElement => document.getElementById(id)!;

/* one pip per vice finished; the top half runs red */
const TOL_PIPS = Math.round(TOLERANCE_MAX / TOLERANCE_PER_USE);

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
function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}
function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60),
    s = Math.floor(sec % 60);
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
/* player names are user input rendered via innerHTML — escape them */
function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
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
  private lobbySig = "";
  private overSig = "";
  private startSecs = -1;

  constructor(private send: (i: Intent) => void) {
    for (const id of ["cigarTol", "beerTol"])
      $(id).innerHTML = Array.from(
        { length: TOL_PIPS },
        (_, i) => `<i${i >= TOL_PIPS / 2 ? ' class="hot"' : ""}></i>`
      ).join("");
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
    // joining lives on the main menu now (ui/menu.ts); this wires the table
    // leader-only intents: the sim ignores them from anyone else.
    // starting the game has no button — the leader walks to the door (E)
    $("lobbyClearBtn").addEventListener("click", () => this.send({ type: "clearLitter" }));
    $("retryBtn").addEventListener("click", () => this.send({ type: "restart" }));

    $("dealBtn").addEventListener("click", () => {
      this.send({ type: "setBet", amount: this.localPending });
      this.send({ type: "commitBet" });
    });
    // sticky: skips every betting round until DEAL ME IN (or a new run)
    $("sitOutBtn").addEventListener("click", () => this.send({ type: "sitOut", on: true }));
    $("dealMeInBtn").addEventListener("click", () => this.send({ type: "sitOut", on: false }));
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

    // pointer lock has no cursor to reach the dock buttons with, so the rack
    // IS the keyboard: 1-4 stack that chip, wheel or +/- nudges one small
    // chip at a time, ENTER deals, R rebets, BKSP clears, H/S/D act
    addEventListener("keydown", (e) => this.onKey(e));
    addEventListener("wheel", (e) => this.onWheel(e), { passive: true });

    // holding SHIFT flips the rack into take-away mode (SHIFT+1-4 unstacks);
    // the CSS mirrors it so the labels read -1..-4 while it's held
    addEventListener("keydown", (e) => {
      if (e.key === "Shift") $("chipRack").classList.add("shifted");
    });
    addEventListener("keyup", (e) => {
      if (e.key === "Shift") $("chipRack").classList.remove("shifted");
    });
    addEventListener("blur", () => $("chipRack").classList.remove("shifted"));
  }

  /* keys stay dead while a full-screen UI owns the keyboard (title, menu,
     options) or the user is typing in a field */
  private keysBlocked(target: EventTarget | null): boolean {
    const tag = (target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    return ["titleScreen", "menuScreen", "optionsScreen"].some((id) =>
      $(id).classList.contains("active")
    );
  }

  private get bettingOpen(): boolean {
    const { snap, me } = this;
    if (!snap || !me) return false;
    return (
      snap.phase === "betting" &&
      me.alive && !me.waiting && !me.committed && !me.sittingOut &&
      me.money > 0
    );
  }
  private get myTurn(): boolean {
    const snap = this.snap;
    return !!snap && snap.phase === "acting" && snap.turnPlayerId === this.myId;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat || this.keysBlocked(e.target)) return;
    if (this.myTurn) {
      if (e.code === "KeyH") this.send({ type: "hit" });
      else if (e.code === "KeyS") this.send({ type: "stand" });
      else if (e.code === "KeyD" && !($("doubleBtn") as HTMLButtonElement).disabled)
        this.send({ type: "double" });
      return;
    }
    if (!this.bettingOpen) return;
    const chip = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
    if (chip >= 0)
      this.adjustBet((e.shiftKey ? -1 : 1) * (chipDenoms(this.me?.money ?? 0)[chip] ?? 0));
    else if (e.key === "Enter") {
      this.send({ type: "setBet", amount: this.localPending });
      this.send({ type: "commitBet" });
    } else if (e.code === "KeyR" && (this.me?.lastBet ?? 0) > 0) this.applyPreset("rebet");
    else if (e.key === "Backspace") this.setPending(0);
    // key CODES, not values — SHIFT turns "-" into "_" and would eat the key
    else if (e.code === "Equal" || e.code === "NumpadAdd") this.adjustBet(this.chipStep());
    else if (e.code === "Minus" || e.code === "NumpadSubtract") this.adjustBet(-this.chipStep());
  }

  /* one wheel detent = one smallest chip, no matter how hard the wheel was
     flicked — OS scroll acceleration banks pixels, and converting pixels to
     chips made flick speed change the increment. Trackpads drip small
     deltas, so a detent is ~100 accumulated px; a direction flip (trackpad
     inertia wobble) clears the tab instead of stepping backwards. */
  private wheelAcc = 0;
  private chipStep(): number {
    return chipDenoms(this.me?.money ?? 0)[0];
  }
  private onWheel(e: WheelEvent): void {
    if (!this.bettingOpen || this.keysBlocked(e.target)) {
      this.wheelAcc = 0;
      return;
    }
    const raw = e.deltaY !== 0 ? e.deltaY : e.deltaX; // some mice re-axis
    if (!raw) return;
    const d = e.deltaMode === 1 ? raw * 40 : raw; // line-mode wheels (Firefox)
    if (Math.sign(d) !== Math.sign(this.wheelAcc)) this.wheelAcc = 0;
    this.wheelAcc += d;
    if (Math.abs(this.wheelAcc) < 100) return;
    this.wheelAcc = 0; // never more than one chip per event
    this.adjustBet(d < 0 ? this.chipStep() : -this.chipStep());
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

  /* ---------------- session lifecycle ---------------- */
  /* called when a Session begins: fresh per-table state, HUD on */
  sessionStart(tableName: string): void {
    this.snap = null;
    this.me = undefined;
    this.localPending = 0;
    this.pendingDirty = false;
    this.displayedMoney = 0;
    this.chipSig = "";
    this.lobbySig = "";
    this.overSig = "";
    $("lobbyTitle").textContent = tableName;
    $("hud").classList.add("active");
  }

  /* called when the Session ends (left or lost): HUD and overlays off — the
     menu takes the stage back */
  sessionEnd(): void {
    this.snap = null;
    this.me = undefined;
    $("hud").classList.remove("active");
    $("lobbyScreen").classList.remove("active");
    $("overScreen").classList.remove("active");
    $("banner").className = "";
    $("startBanner").classList.remove("show");
    this.startSecs = -1;
    $("flingHint").classList.remove("show");
    document.body.classList.remove("panic");
    document.body.classList.remove("lobby-room");
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

    $("scoreDisplay").textContent = String(me.score);
    $("handsDisplay").textContent = String(me.stats.handsPlayed);
    $("timeDisplay").textContent = fmtTime(snap.elapsed);
    $("phaseDisplay").textContent = this.phaseLabel(snap, me);

    // lobby / game-over overlays follow the authoritative phase; the body
    // class holsters the table-only chrome while everyone's in the room
    $("lobbyScreen").classList.toggle("active", snap.phase === "lobby");
    document.body.classList.toggle("lobby-room", snap.phase === "lobby");
    $("overScreen").classList.toggle("active", snap.phase === "over");
    if (snap.phase === "lobby") this.renderLobby(snap);
    else this.lobbySig = "";
    if (snap.phase === "over") this.renderOver(snap, me);
    else this.overSig = "";

    // game-start countdown: the sim keeps the room in "lobby" while it runs;
    // the banner just mirrors the authoritative seconds left
    const counting = snap.phase === "lobby" && snap.startsIn !== null;
    $("startBanner").classList.toggle("show", counting);
    if (counting) {
      const secs = Math.max(1, Math.ceil(snap.startsIn!));
      if (secs !== this.startSecs) {
        this.startSecs = secs;
        $("startCount").textContent = String(secs);
      }
    } else this.startSecs = -1;

    // meters
    this.meter($("cigarFill"), me.cigarMeter);
    this.meter($("beerFill"), me.beerMeter);
    this.tolerance($("cigarTol"), me.cigarTol);
    this.tolerance($("beerTol"), me.beerTol);
    $("cigarInv").textContent = "×" + me.cigarInv;
    $("beerInv").textContent = "×" + me.beerInv;
    document.body.classList.toggle(
      "panic",
      me.alive && snap.phase !== "over" && (me.cigarMeter < 20 || me.beerMeter < 20)
    );

    // vice items (draggable; RitualControl refuses to start when one is
    // running). Holding an empty also blocks: fling your litter first.
    const benched = !me.alive || me.waiting;
    const cigarOff = benched || me.cigarInv < 1 || me.held !== null;
    const beerOff = benched || me.beerInv < 1 || me.held !== null;
    $("cigarItem").classList.toggle("disabled", cigarOff);
    $("beerItem").classList.toggle("disabled", beerOff);
    $("cigarItem").setAttribute("aria-disabled", String(cigarOff));
    $("beerItem").setAttribute("aria-disabled", String(beerOff));

    // shop
    $("cigarPrice").textContent = fmtMoney(snap.cigarPrice);
    $("beerPrice").textContent = fmtMoney(snap.beerPrice);
    ($("buyCigar1") as HTMLButtonElement).disabled = benched || me.money < snap.cigarPrice;
    ($("buyCigar5") as HTMLButtonElement).disabled = benched || me.money < snap.cigarPrice * 5;
    ($("buyBeer1") as HTMLButtonElement).disabled = benched || me.money < snap.beerPrice;
    ($("buyBeer5") as HTMLButtonElement).disabled = benched || me.money < snap.beerPrice * 5;

    this.renderBetting();
    $("flingHint").classList.toggle("show", me.held !== null);

    for (const ev of snap.events) {
      if (ev.t === "result" && ev.playerId === this.myId) {
        // near-misses sting harder than wins feel good — say them out loud
        let label = ev.label;
        if (ev.kind === "lose") {
          const myT = handValue(me.hand).total;
          const dT = handValue(snap.dealerHand).total;
          if (myT <= 21 && dT <= 21 && dT - myT === 1) label = "LOST BY ONE. OF COURSE.";
          else if (myT <= 21 && dT === 21 && snap.dealerHand.length >= 4)
            label = "DEALER DREW OUT TO 21. CRIMINAL.";
        }
        if (ev.label === "BLACKJACK!") this.goldFlash();
        this.banner(
          label + (ev.delta > 0 ? "  +" + fmtMoney(ev.delta) : ev.delta < 0 ? "  −" + fmtMoney(-ev.delta) : ""),
          ev.kind
        );
      } else if (ev.t === "moneyDrop" && ev.playerId === this.myId)
        this.banner("FOUND " + fmtMoney(ev.amount) + " IN THE FILTH", "win");
      else if (ev.t === "playerHit") {
        // victim gets a brief sting only — the flash (plus scene-side shake,
        // sound, and bubble); the banner belongs to the sniper
        if (ev.victimId === this.myId) this.redFlash();
        else if (ev.flingerId === this.myId)
          this.banner("DIRECT HIT  +" + ev.points + " PTS", "win");
      }
      else if (ev.t === "eliminated" && ev.playerId !== this.myId) {
        const who = snap.players.find((p) => p.id === ev.playerId);
        if (who) this.banner(who.name + " IS OUT", "lose"); // textContent: no escaping
      }
    }
  }

  private phaseLabel(snap: Snapshot, me: PlayerSnap): string {
    if (me.waiting) return "SPECTATING — IN NEXT GAME";
    if (!me.alive) return "DEAD";
    switch (snap.phase) {
      case "lobby":
        return "LOBBY";
      case "betting":
        return me.committed
          ? "WAITING FOR THE TABLE"
          : me.sittingOut
            ? "SITTING OUT"
            : "PLACE YOUR BET";
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
    const inRound = me.alive && !me.waiting && !me.committed;
    const betting = this.bettingOpen; // shared with the key/wheel gating
    // the DEAL ME IN panel stays up through the whole round they're skipping
    const sittingOut =
      me.sittingOut && inRound && snap.phase !== "lobby" && snap.phase !== "over";
    const myTurn = this.myTurn;

    $("betPanel").style.display = betting ? "" : "none";
    $("sitOutPanel").style.display = sittingOut ? "" : "none";
    $("playPanel").style.display = myTurn ? "" : "none";
    $("betDisplay").textContent = fmtMoney(this.localPending);

    // the closing window only matters once someone has anted — before that
    // an expiry just re-arms, so counting it down would be noise
    const anteed = snap.players.some((p) => p.committed);
    const closing =
      betting && anteed && snap.bettingEndsIn !== null
        ? ` Cards fly in ${Math.max(1, Math.ceil(snap.bettingEndsIn))}s.`
        : "";
    const hint = me.waiting
      ? "Game in progress. You're dealt in when the next one starts."
      : !me.alive
        ? "You are a cautionary tale now."
        : me.money <= 0 && !me.committed && !me.sittingOut
          ? "No money. No bets. Only vices remain."
          : betting
            ? "1-4 stack chips, SHIFT unstacks, scroll nudges, ENTER deals. Min bet $10." +
              closing
            : "";
    $("dockHint").textContent = hint;

    if (betting) {
      const denoms = chipDenoms(me.money);
      const sig = denoms.join(",");
      if (sig !== this.chipSig) {
        this.chipSig = sig;
        $("chipRack").innerHTML = denoms
          .map((v, i) => {
            const s = chipStyle(v);
            return `<div class="chip-stepper">
                 <button class="chip-step plus" data-denom="${v}" aria-label="Add ${chipLabel(v)}">＋</button>
                 <div class="chip-face" style="background:${s.color};border-color:${s.edge};color:${s.ink}">${chipLabel(v)}</div>
                 <button class="chip-step minus" data-denom="${v}" aria-label="Remove ${chipLabel(v)}">−</button>
                 <kbd class="chip-key">${i + 1}</kbd>
               </div>`;
          })
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
      const hv = handValue(me.hand);
      const up = snap.dealerHand[0];
      $("betInPlay").textContent =
        `YOU ${hv.soft && hv.total <= 21 ? "soft " : ""}${hv.total}` +
        ` · DEALER SHOWS ${up ? up.r : "?"}` +
        ` · Bet ${fmtMoney(me.bet)}${me.doubled ? " (doubled)" : ""}`;
    }
  }

  private meter(fill: HTMLElement, v: number): void {
    fill.style.width = Math.max(0, v) + "%";
    fill.className = "fill " + (v > 50 ? "ok" : v >= 20 ? "warn" : "bad");
  }

  /* tolerance pips: the habit's ratchet. A newly lit pip pops once (the
     animation replays when the class lands on a fresh element). */
  private tolerance(el: HTMLElement, tol: number): void {
    const lit = Math.min(TOL_PIPS, Math.floor(tol / TOLERANCE_PER_USE));
    const pips = el.children;
    for (let i = 0; i < pips.length; i++) pips[i].classList.toggle("lit", i < lit);
  }

  private flashEl: HTMLElement | null = null;
  private flash(bg: string): void {
    if (!this.flashEl) {
      const el = document.createElement("div");
      el.style.cssText =
        "position:fixed;inset:0;pointer-events:none;z-index:60;opacity:0;" +
        "transition:opacity .1s ease-out";
      document.body.appendChild(el);
      this.flashEl = el;
    }
    const el = this.flashEl;
    el.style.background = bg;
    el.style.transition = "opacity .1s ease-out";
    el.style.opacity = "1";
    setTimeout(() => {
      el.style.transition = "opacity .5s ease-in";
      el.style.opacity = "0";
    }, 140);
  }

  private goldFlash(): void {
    this.flash(
      "radial-gradient(circle at 50% 45%,rgba(255,214,110,.55),rgba(255,180,60,.12) 55%,transparent 75%)"
    );
  }

  private redFlash(): void {
    this.flash(
      "radial-gradient(circle at 50% 45%,rgba(255,70,50,.5),rgba(200,30,20,.18) 60%,transparent 80%)"
    );
  }

  private banner(text: string, kind: string): void {
    const b = $("banner");
    b.textContent = text;
    b.className = "show " + kind;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (b.className = ""), 1500);
  }

  private renderLobby(snap: Snapshot): void {
    const amLeader = snap.leaderId === this.myId;
    const hasLitter = snap.debris.length > 0;
    const counting = snap.startsIn !== null;
    const sig =
      snap.players.map((p) => p.id + ":" + p.name).join() +
      "|" + snap.leaderId + "|" + hasLitter + "|" + counting;
    if (sig === this.lobbySig) return;
    this.lobbySig = sig;

    $("lobbyList").innerHTML = snap.players
      .map(
        (p) =>
          `<div class="lobby-row${p.id === this.myId ? " you" : ""}">
             <span class="who">${esc(p.name)}${p.id === this.myId ? " (you)" : ""}</span>
             <span class="tag${p.id === snap.leaderId ? " leader" : ""}">${
               p.id === snap.leaderId ? "★ LEADER" : "AT THE TABLE"
             }</span>
           </div>`
      )
      .join("");
    // the janitor option: leader-only, and only worth pressing when there's
    // actually filth on the floor (either room — the count covers both)
    const clearBtn = $("lobbyClearBtn") as HTMLButtonElement;
    clearBtn.style.display = amLeader ? "" : "none";
    clearBtn.disabled = !hasLitter;
    $("lobbyHint").textContent = counting
      ? "Last call. Finish your business — the table seats you when the count hits zero."
      : amLeader
        ? snap.players.length === 1
          ? "Drinking alone is still drinking. The door starts it — walk up and press E."
          : `${snap.players.length} degenerates seated. Start at the door — walk up and press E.`
        : "The leader starts the game at the door. Sit tight.";
  }

  /* ranked leaderboard; re-renders only when standings/scores change (the
     winner's last empties can still settle and score after the run ends).
     Order comes from the sim's authoritative standings — winner always #1,
     ties broken deterministically — with a score sort as the fallback for
     anyone the standings don't know about. */
  private renderOver(snap: Snapshot, me: PlayerSnap): void {
    const order = new Map(snap.standings.map((id, i) => [id, i]));
    const rank = (p: PlayerSnap) => order.get(p.id) ?? snap.standings.length;
    const ranked = [...snap.players].sort((a, b) => rank(a) - rank(b) || b.score - a.score);
    const sig =
      snap.winnerId + "|" + snap.leaderId + "|" + ranked.map((p) => p.id + ":" + p.score).join();
    if (sig === this.overSig) return;
    this.overSig = sig;

    const winner = snap.players.find((p) => p.id === snap.winnerId);
    const cause = $("deathCause");
    if (snap.winnerId === this.myId) {
      cause.textContent = "LAST DEGENERATE STANDING";
      cause.style.color = "var(--bulb)";
    } else {
      cause.textContent =
        me.causeOfDeath ?? (winner ? winner.name + " OUTLASTED THE TABLE" : "THE HOUSE OUTLASTED YOU.");
      cause.style.color = "";
    }

    $("leaderboard").innerHTML =
      `<table>
         <tr><th class="num">#</th><th>DEGENERATE</th><th class="num">SCORE</th>
             <th class="num">HANDS</th><th class="num">WON</th><th class="num">VICES</th></tr>` +
      ranked
        .map((p, i) => {
          const cls =
            (p.id === snap.winnerId ? "winner " : "") +
            (p.id === this.myId ? "you " : "") +
            (p.alive ? "" : "dead");
          const badge = p.id === snap.winnerId ? "★ " : p.alive ? "" : "× ";
          return `<tr class="${cls}">
              <td class="num">${i + 1}</td><td class="who">${badge}${esc(p.name)}</td>
              <td class="num score">${p.score}</td>
              <td class="num">${p.stats.handsPlayed}</td><td class="num">${p.stats.handsWon}</td>
              <td class="num">${p.stats.cigarsSmoked + p.stats.beersDrunk}</td>
            </tr>`;
        })
        .join("") +
      `</table>`;

    $("overStats").innerHTML =
      `Peak money <b>${fmtMoney(me.stats.peakMoney)}</b> · Final <b>${fmtMoney(me.money)}</b> · ` +
      `Litter on the floor <b>${snap.debris.length}</b> · Survived <b>${fmtTime(snap.elapsed)}</b>`;

    const amLeader = snap.leaderId === this.myId;
    ($("retryBtn") as HTMLButtonElement).disabled = !amLeader;
    $("retryHint").textContent = amLeader
      ? "Back to the lobby. Everyone resets. The filth stays."
      : "The leader decides when to run it back.";
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
