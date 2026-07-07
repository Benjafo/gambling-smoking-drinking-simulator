/* Pure blackjack rules, ported verbatim from degenerate-blackjack.html.
   No DOM, no timers, no Math.random — shuffle takes the sim RNG. */
import { Rng } from "./rng";

export interface Card {
  r: string;
  s: string;
}

export const SUITS = ["♠", "♥", "♦", "♣"];
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function buildShoe(decks: number, rng: Rng): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < decks; d++)
    for (const s of SUITS)
      for (const r of RANKS) shoe.push({ r, s });
  return rng.shuffle(shoe);
}

export function cardValue(r: string): number {
  if (r === "A") return 11;
  if (r === "J" || r === "Q" || r === "K") return 10;
  return parseInt(r, 10);
}

export function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0,
    aces = 0;
  for (const c of cards) {
    total += cardValue(c.r);
    if (c.r === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

export type ResultKind = "win" | "lose" | "push";
export interface SettleResult {
  back: number;
  label: string;
  kind: ResultKind;
}

/* Returns money returned to the player (0 on loss) and a result label.
   bet = total amount already deducted (post-double). */
export function settle(
  pTotal: number,
  dTotal: number,
  pBJ: boolean,
  dBJ: boolean,
  bet: number
): SettleResult {
  if (pBJ && dBJ) return { back: bet, label: "PUSH", kind: "push" };
  if (pBJ) return { back: bet + bet * 1.5, label: "BLACKJACK!", kind: "win" };
  if (dBJ) return { back: 0, label: "DEALER BLACKJACK", kind: "lose" };
  if (pTotal > 21) return { back: 0, label: "BUST", kind: "lose" };
  if (dTotal > 21) return { back: bet * 2, label: "DEALER BUSTS — YOU WIN", kind: "win" };
  if (pTotal > dTotal) return { back: bet * 2, label: "YOU WIN", kind: "win" };
  if (pTotal < dTotal) return { back: 0, label: "DEALER WINS", kind: "lose" };
  return { back: bet, label: "PUSH", kind: "push" };
}

export function inflate(price: number): number {
  return Math.ceil(price * 1.1);
}
