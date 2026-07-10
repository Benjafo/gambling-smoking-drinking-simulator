/* Minimal tween runner for card deals/flips — no dependency needed. */
export type Ease = (t: number) => number;
export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOut: Ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

interface Tween {
  start: number;
  duration: number;
  delay: number;
  ease: Ease;
  update: (t: number) => void;
  done?: () => void;
  finished: boolean;
}

const active: Tween[] = [];

export function tween(opts: {
  duration: number;
  delay?: number;
  ease?: Ease;
  update: (t: number) => void;
  done?: () => void;
}): void {
  active.push({
    start: performance.now(),
    duration: opts.duration,
    delay: opts.delay ?? 0,
    ease: opts.ease ?? easeOutCubic,
    update: opts.update,
    done: opts.done,
    finished: false,
  });
}

export function updateTweens(now: number): void {
  for (const tw of active) {
    const raw = (now - tw.start - tw.delay) / tw.duration;
    if (raw < 0) continue;
    const t = Math.min(1, raw);
    tw.update(tw.ease(t));
    if (t >= 1) {
      tw.finished = true;
      tw.done?.();
    }
  }
  for (let i = active.length - 1; i >= 0; i--) if (active[i].finished) active.splice(i, 1);
}
