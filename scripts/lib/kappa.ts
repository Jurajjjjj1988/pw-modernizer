/**
 * kappa.ts — Cohen's kappa for inter-rater agreement (BP8: LLM-judge calibration).
 *
 * Prior art (MT-Bench, "A Survey on LLM-as-a-Judge"): before you trust an LLM
 * judge to gate migrations unsupervised, calibrate it against a human-labeled
 * gold set and require Cohen's kappa ≥ ~0.6 (substantial agreement). Raw percent
 * agreement is misleading because two raters can agree by chance; kappa corrects
 * for chance. This is the metric the judge itself is gated on.
 */

export interface KappaResult {
  /** Cohen's kappa in [-1, 1]; >=0.6 substantial, >=0.8 almost perfect. */
  kappa: number;
  /** Raw observed agreement (the MT-Bench-style % number). */
  observedAgreement: number;
  n: number;
}

/**
 * Cohen's kappa for two raters over the SAME items with binary verdicts
 * (true = ACCEPTABLE). Throws on length mismatch or empty input.
 */
export function cohensKappa(a: boolean[], b: boolean[]): KappaResult {
  if (a.length !== b.length) throw new Error(`cohensKappa: length mismatch (${a.length} vs ${b.length})`);
  const n = a.length;
  if (n === 0) throw new Error("cohensKappa: need at least one item");
  let agree = 0;
  let aTrue = 0;
  let bTrue = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree += 1;
    if (a[i]) aTrue += 1;
    if (b[i]) bTrue += 1;
  }
  const po = agree / n;
  // Chance agreement: P(both true) + P(both false) under independence.
  const pTrue = (aTrue / n) * (bTrue / n);
  const pFalse = ((n - aTrue) / n) * ((n - bTrue) / n);
  const pe = pTrue + pFalse;
  // When pe === 1 (one rater is constant and matches), agreement is trivial → kappa 1 if perfect, else 0.
  const kappa = pe >= 1 ? (po >= 1 ? 1 : 0) : (po - pe) / (1 - pe);
  return { kappa, observedAgreement: po, n };
}

/** Verdict label for a kappa value (Landis & Koch bands). */
export function kappaLabel(k: number): string {
  if (k < 0) return "worse than chance";
  if (k < 0.2) return "slight";
  if (k < 0.4) return "fair";
  if (k < 0.6) return "moderate";
  if (k < 0.8) return "substantial";
  return "almost perfect";
}
