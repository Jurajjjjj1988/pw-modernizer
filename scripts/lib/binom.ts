/**
 * binom.ts — small-sample binomial statistics for honest acceptance reporting.
 *
 * The audit's headline trust number (~33% human-acceptable, n=5) was reported as
 * a bare point estimate with no interval — at n=5 a 60% rate has a 95% CI of
 * ~23–88%, so it cannot distinguish 33% from 96%. Every acceptance rate this
 * project reports MUST carry a confidence interval. We use the Wilson score
 * interval (not the normal approximation): it stays inside [0,1] and is accurate
 * at the small n we actually have.
 */

export interface Interval {
  /** Point estimate k/n (0 when n === 0). */
  point: number;
  /** Lower bound of the (1-alpha) Wilson interval. */
  lo: number;
  /** Upper bound of the (1-alpha) Wilson interval. */
  hi: number;
  k: number;
  n: number;
  /** The z used (1.96 for 95%). */
  z: number;
}

/**
 * Wilson score interval for a binomial proportion k successes in n trials.
 * z defaults to 1.96 (95%). n === 0 returns the full [0,1] interval (no data).
 */
export function wilsonInterval(k: number, n: number, z = 1.96): Interval {
  if (!Number.isFinite(k) || !Number.isFinite(n) || k < 0 || n < 0 || k > n) {
    throw new Error(`wilsonInterval: invalid k=${k}, n=${n} (need 0 <= k <= n)`);
  }
  if (n === 0) return { point: 0, lo: 0, hi: 1, k, n, z };
  const phat = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n));
  return {
    point: phat,
    lo: Math.max(0, center - half),
    hi: Math.min(1, center + half),
    k,
    n,
    z,
  };
}

/** Format an interval as e.g. "60.0% (95% CI 23.1%–88.2%, n=5)". */
export function formatInterval(ci: Interval): string {
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  const conf = Math.round((1 - 2 * (1 - normalCdf(ci.z))) * 100);
  return `${pct(ci.point)} (${conf}% CI ${pct(ci.lo)}–${pct(ci.hi)}, n=${ci.n})`;
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26) — only used to label the CI%. */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
