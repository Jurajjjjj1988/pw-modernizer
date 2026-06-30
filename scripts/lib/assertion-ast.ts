/**
 * assertion-ast.ts — Playwright assertion extraction + strength comparison (B1).
 *
 * The execution-guided repair loop can make a red test go green by WEAKENING an
 * assertion instead of fixing the locator/target — `toHaveText('3')` →
 * `toBeVisible()`, dropping a `.not`, dropping an assert entirely. The result is
 * a GREEN test that no longer verifies what the source verified (a false green a
 * prompt nudge can't stop). The strength of a Playwright assertion lives in the
 * MATCHER, which is an AST property — so weakening is deterministically visible.
 *
 * Playwright's matcher vocabulary is small + closed, giving a strength lattice
 * (the test-oracle subsumption ordering specialised to Playwright): exact-content
 * matchers subsume partial-content subsume state subsume presence subsume removed.
 * We parse with the TS compiler (robust to nested parens in locator chains), then
 * compare the assertion set BEFORE a repair edit against AFTER it.
 *
 * Pure + I/O-free so it's unit-tested and can run on every repair iteration.
 */
import ts from "typescript";

/** Matcher → strength tier (higher = stronger). Anything not listed is treated as
 * tier 1 (presence) — unknown matchers never count as a downgrade target. */
export const MATCHER_TIER: Record<string, number> = {
  // 4 — exact content / count
  toHaveText: 4, toHaveValue: 4, toHaveValues: 4, toHaveCount: 4, toHaveId: 4,
  toHaveJSProperty: 4, toHaveRole: 4, toHaveCSS: 4, toHaveScreenshot: 4,
  toHaveAccessibleName: 4, toEqual: 4, toBe: 4, toStrictEqual: 4,
  // 3 — partial content
  toContainText: 3, toHaveClass: 3, toHaveAttribute: 3, toHaveAccessibleDescription: 3,
  toMatch: 3, toMatchObject: 3, toContain: 3,
  // 2 — state
  toBeChecked: 2, toBeEnabled: 2, toBeDisabled: 2, toBeEditable: 2, toBeFocused: 2,
  toBeEmpty: 2, toHaveURL: 2, toHaveTitle: 2, toBeTruthy: 2, toBeFalsy: 2,
  // 1 — presence / attachment
  toBeVisible: 1, toBeHidden: 1, toBeAttached: 1, toBeInViewport: 1,
};

export interface PwAssertion {
  /** Text of expect()'s first argument (the locator/value under assertion). */
  target: string;
  /** The matcher method (toHaveText, toBeVisible, …). */
  matcher: string;
  /** Whether the chain carried `.not`. */
  negated: boolean;
  /** A distinctive literal anchor in the matcher arg (string / number / regex
   * source), used to pair assertions across before/after without needing locator
   * equivalence. Null for argument-less matchers (toBeVisible). */
  anchor: string | null;
  tier: number;
}

function tierOf(matcher: string): number {
  return MATCHER_TIER[matcher] ?? 1;
}

/** The literal anchor of a matcher argument, if any (string/number/regex). */
function literalAnchor(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text.trim() || null;
  if (ts.isNumericLiteral(node)) return node.text;
  if (ts.isRegularExpressionLiteral(node)) return node.text;
  return null;
}

/** Is this call-expression's callee chain rooted at `expect(...)` / `expect.soft(...)`?
 * Returns the expect() argument node + whether `.not` appeared, else null. */
function rootedAtExpect(start: ts.Expression): { arg: ts.Expression | undefined; negated: boolean } | null {
  let obj: ts.Expression = start;
  let negated = false;
  for (let i = 0; i < 12; i++) {
    if (ts.isPropertyAccessExpression(obj)) {
      if (obj.name.text === "not") negated = true;
      obj = obj.expression;
    } else if (ts.isCallExpression(obj)) {
      const callee = obj.expression;
      if (ts.isIdentifier(callee) && callee.text === "expect") return { arg: obj.arguments[0], negated };
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "expect") {
        return { arg: obj.arguments[0], negated }; // expect.soft(...) / expect.poll(...)
      }
      obj = obj.expression;
    } else {
      return null;
    }
  }
  return null;
}

/** Extract every Playwright `expect(...).matcher(...)` assertion from a source. */
export function extractPwAssertions(source: string): PwAssertion[] {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const out: PwAssertion[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const matcher = node.expression.name.text;
      if (matcher in MATCHER_TIER) {
        const rooted = rootedAtExpect(node.expression.expression);
        if (rooted?.arg) {
          out.push({
            target: rooted.arg.getText(sf),
            matcher,
            negated: rooted.negated,
            anchor: literalAnchor(node.arguments[0]),
            tier: tierOf(matcher),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export interface StrengthViolation {
  kind: "count-drop" | "negation-drop" | "strength-drop" | "retarget";
  detail: string;
}

const sumTier = (a: PwAssertion[]): number => a.reduce((s, x) => s + x.tier, 0);

/** Tier at or above which a content matcher carries a literal anchor worth tracking
 * for re-targeting (exact + partial content; state/presence don't bind a value). */
const STRONG_TIER = 3;

/** The strongest matcher tier asserted against a given target text in a set. */
function maxTierForTarget(set: PwAssertion[], target: string): number {
  let max = 0;
  for (const a of set) if (a.target === target && a.tier > max) max = a.tier;
  return max;
}

/**
 * Detect assertion RE-TARGETING: a repair moves a strong matcher's literal anchor
 * onto a DIFFERENT target while the original target — still present in the after —
 * loses its strong assertion. The aggregate sum/count/negation guards are blind to
 * this (the relocated strong matcher keeps the sum level or even raises it), yet the
 * test no longer verifies the original element. We flag ONLY with full target-identity
 * evidence, so the two legitimate repairs both pass:
 *  - same-target VALUE correction (toHaveText('3')→toHaveText('2')): the anchor leaves
 *    its target entirely (no relocation to a different target) AND the original target
 *    keeps a strong assertion — neither retarget condition holds.
 *  - LOCATOR-only fix (same anchor/tier, different selector): the original target text
 *    is REPLACED 1:1, so it is absent from the after — we cannot (and must not) call a
 *    clean 1:1 swap a retarget, so it passes.
 */
function detectRetargets(before: PwAssertion[], after: PwAssertion[]): StrengthViolation[] {
  const out: StrengthViolation[] = [];
  const afterTargets = new Set(after.map((a) => a.target));
  for (const b of before) {
    if (b.tier < STRONG_TIER || b.anchor === null) continue;
    // The SAME strong (matcher, anchor) pair now asserted against a DIFFERENT target.
    const relocated = after.find(
      (a) => a.anchor === b.anchor && a.matcher === b.matcher && a.tier === b.tier && a.target !== b.target,
    );
    if (!relocated) continue;
    // The original target must still be present (a 1:1 locator swap removes it → not a retarget),
    // and its strongest assertion must have weakened (its strong matcher was stripped off it).
    if (!afterTargets.has(b.target)) continue;
    if (maxTierForTarget(after, b.target) >= b.tier) continue;
    out.push({
      kind: "retarget",
      detail: `${b.matcher}(${b.anchor}) re-targeted from ${b.target} → ${relocated.target} while ${b.target} lost its strong assertion`,
    });
  }
  return out;
}

/**
 * Compare the assertions BEFORE a repair edit against AFTER, flagging weakenings
 * the repair must not introduce to reach green:
 *  - count-drop: an assertion was removed.
 *  - negation-drop: a `.not` assertion was flipped/removed.
 *  - strength-drop: the TOTAL matcher strength fell. This is the robust signal —
 *    a locator repair leaves matchers untouched (sum unchanged), ADDING an
 *    assertion raises the sum, and a legitimate value-correction keeps the same
 *    matcher tier; the sum only falls when a matcher was downgraded
 *    (toHaveText→toBeVisible) or an assertion removed. So a falling sum, at any
 *    count, means net weakening — with no false-positive on a changed locator or
 *    a corrected literal value (the per-anchor pairing those would have tripped).
 *  - retarget: a strong matcher's literal anchor was MOVED onto a different target
 *    while the original target (still present) lost its strong assertion — a green
 *    bought by pointing a strong matcher at a trivially-true element. The sum/count
 *    guards are blind here (the relocated matcher keeps the sum level or raises it);
 *    `detectRetargets` catches it with target-identity evidence. See that helper for
 *    why a same-target value correction and a 1:1 locator swap both pass.
 */
export function compareStrength(before: PwAssertion[], after: PwAssertion[]): StrengthViolation[] {
  const v: StrengthViolation[] = [];
  if (after.length < before.length) {
    v.push({ kind: "count-drop", detail: `assertion count ${before.length} → ${after.length}` });
  }
  const negBefore = before.filter((a) => a.negated).length;
  const negAfter = after.filter((a) => a.negated).length;
  if (negAfter < negBefore) {
    v.push({ kind: "negation-drop", detail: `negated (.not) assertions ${negBefore} → ${negAfter}` });
  }
  const sb = sumTier(before);
  const sa = sumTier(after);
  if (sa < sb) {
    v.push({ kind: "strength-drop", detail: `total assertion strength ${sb} → ${sa} (a matcher was weakened, e.g. toHaveText→toBeVisible)` });
  }
  v.push(...detectRetargets(before, after));
  return v;
}
