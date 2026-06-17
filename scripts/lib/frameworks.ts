/**
 * frameworks.ts — the single source of truth for the source frameworks the
 * pipeline migrates FROM. The same 4-member union was hand-duplicated across
 * ~10 scripts (derive-envelope, evaluate, metrics, plan-envelope-validate,
 * plan-code-coverage, persist-plan-metrics, index-plans, rag-map3-evaluator,
 * retrieval-bm25 …); a fifth framework meant editing all of them. Import the
 * `Framework` type and `FRAMEWORKS` list from here instead.
 *
 * Per-script DETECTION heuristics (by path / by content / by extension) stay in
 * their scripts — they have genuine per-call-site nuance — but they all agree on
 * this membership set.
 */

/** The frameworks the pipeline accepts as Stage-1 input, in canonical order. */
export const FRAMEWORKS = [
  "bad-playwright",
  "cypress",
  "selenium-java",
  "selenium-python",
] as const;

/** A source framework id. Widened from the `FRAMEWORKS` tuple so it stays in sync. */
export type Framework = (typeof FRAMEWORKS)[number];

/** Narrowing guard — true if `value` is one of the known frameworks. */
export function isFramework(value: string): value is Framework {
  return (FRAMEWORKS as readonly string[]).includes(value);
}
