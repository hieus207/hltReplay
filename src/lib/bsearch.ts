import type { Trade } from '@/types';

/** First index where trades[i].time >= target */
export function lowerBound(trades: Trade[], target: number): number {
  let lo = 0, hi = trades.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (trades[m].time < target) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** First index where trades[i].time > target */
export function upperBound(trades: Trade[], target: number): number {
  let lo = 0, hi = trades.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (trades[m].time <= target) lo = m + 1;
    else hi = m;
  }
  return lo;
}
