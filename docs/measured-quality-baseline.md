# Measured quality baseline (honest re-score)

> **What this is.** The first *trustworthy* measurement of migration quality on
> the Step-1 (bad-Playwright) corpus, produced after the scorer was made honest.
> It exists because the previous confidence numbers were inflated and must not be
> trusted. **The headline number is ~0.69 mean confidence / 60% first-attempt
> auto-ship — not the ~0.75 the old scorer reported.**

## Why a re-baseline was needed

Two scorer bugs were inflating confidence until 2026-06-21:

1. **The scorer read only the spec, not the emitted tree** (fixed in #218). qa-master
   hides every locator, smell, and assertion in POM/block/helper files that the spec
   reaches by *fixture injection* (`{ loginPage, dashboardPage }`), not by direct
   import. The collector matched files by spec-stem, so for 4 of 5 migrations it saw
   a near-empty tree (0 assertions, 0 smells) and reported a vacuous "100% clean".
   The fix resolves the spec's used fixtures through `base.fixture.ts` to their real
   `*.page.ts` files and follows imports transitively. Emitted-tree assertions went
   `0 / 0 / 0 / 5 / 0` → `13 / 3 / 3 / 5 / 13`.
2. **The RAG MAP@3 metric leaked gold labels into the query** (fixed in #219),
   inflating retrieval quality `0.931 → 0.868` (honest, still PASS).

## The honest numbers (Step 1, bad-Playwright, n=5)

Re-scored with the honest fixture-aware collector. `--report-out` to a temp path,
so committed reports were not mutated.

| Migration | Old confidence | **Honest confidence** | Δ | Assertion floor |
|---|---|---|---|---|
| force-clicks | 0.81 | **0.76** | −0.05 | ✅ pass (13) |
| missing-await | 0.72 | **0.73** | +0.01 | ✅ pass (3) |
| nth-selectors | 0.70 | **0.66** | −0.04 | ✅ pass (3) |
| search-filters | 0.74 | **0.61** | −0.13 | ✅ pass (5) |
| silent-conditionals | 0.80 | **0.71** | −0.09 | ✅ pass (13) |

- **Mean confidence: 0.694** (was 0.754 — **0.06 of inflation removed**).
- **First-attempt auto-ship rate (≥ 0.7): 60% (3/5).**
- **Routed to Opus verify (< 0.7): 40% (2/5)** — these are NOT failures. The < 0.7
  gate is the safety net; they get the dual-lens CANDOR review before any ship.
- **Assertion floor: 5/5 pass** — no migration is a silent no-op.

`search-filters` is the clearest example of the old bug: it auto-shipped at 0.74
when its real confidence is 0.61, because the scorer never saw the fragile
`.product-card` CSS locator and the assertion-roulette in its POM.

## What this means for the "quality" indicator

The pipeline is **correct-or-blocked**, not **96%-first-attempt-perfect**. The
honest first-attempt auto-ship rate on the hardest-graded corpus is ~60%; the
remaining 40% is caught by the verify gate, not shipped blind. Raising the *real*
acceptable rate is a **Stage-2 output-quality** problem (better generation), not a
scorer problem — the scorer is now telling the truth, and the truth is lower than
the old number implied.

## Run 2 (2026-06-22) — fresh real batch + human-equivalent review

We then ran a **real** Stage-2 batch (`npm run migrate --inputs 'inputs/bad-playwright/*.spec.ts'`,
production path, tokens spent) and judged the 6 outputs two ways: the static
scorer, and a **multi-agent adversarial review** (per migration: a senior-SDET
verdict + an adversary that tries to refute a too-generous SHIP — 12 agents).

| Spec | Scorer | Scorer action | **Human-equivalent verdict** |
|---|---|---|---|
| force-clicks | 0.76 | auto-ship | **FIX FIRST** |
| flaky-waits | 0.75 | auto-ship | **FIX FIRST** |
| missing-await | 0.73 | auto-ship | **FIX FIRST** |
| silent-conditionals | 0.71 | auto-ship | **FIX FIRST** |
| nth-selectors | 0.66 | → verify | **SHIP IT** |
| search-filters | 0.61 | → verify | **SHIP IT** |

- Scorer: **0.703 mean, 4/6 (67%) auto-ship, 6/6 pass the full validator wall** (no silent no-ops).
- Human-equivalent: **2/6 (33%) SHIP IT**, 4/6 FIX FIRST, 0 REJECT.
- Scorer ↔ static-confidence agreement with the n=5 re-score (0.694) is tight — the scorer is **stable**.

### The headline: scorer confidence is ANTI-correlated with real quality on this sample

**The two migrations the agents accept (nth-selectors, search-filters) are the two
the scorer distrusted (< 0.7 → verify). All four the scorer auto-shipped have real
FIX-FIRST defects.** The static scorer rewards surface locator quality ("all
getByRole, no smells") and cannot see the defects that actually matter. Root-cause
taxonomy from the review:

1. **Hallucinated locators** — `getByRole`/`getByTestId` promoted with **zero DOM
   evidence** (no DOM-probe ran; no `MIGRATION_TARGET_URL`). A hallucinated
   `getByRole('alert')` / `getByRole('button',{name:/close|dismiss/i})` scores as
   "canonical/high quality" but is more fragile than the honest CSS fallback it
   replaced. (force-clicks, flaky-waits, missing-await)
2. **Cross-migration POM contamination** — shared POMs (`login.page.ts`,
   `dashboard.page.ts`) carry assertions/methods from the FIRST migration that
   authored them, silently injected into specs that never asked for them (e.g.
   flaky-waits' happy path inherits an un-sourced `expect(inputEmail).toBeHidden()`;
   silent-conditionals' `beforeEach` inherits a `welcome-heading` gate that masks
   its notifications test when the A/B variant is off). (flaky-waits, force-clicks,
   silent-conditionals)
3. **Optional element treated as mandatory** — the newsletter modal is dismissed
   unconditionally (would throw before sign-in) instead of `.catch(() => {})` per
   migration-rules §3. (force-clicks)
4. **False WHY-comments** — `// CSS class locator kept as fallback` above code that
   ships an unverified `getByTestId` with no fallback present. (missing-await)

### What this changes about the roadmap to higher quality

The real first-attempt **human-acceptable rate is ~33% without DOM grounding** — and
the dominant failure mode is **ungrounded locators**, not bad structure (structure
is 6/6 wall-clean). So the highest-leverage quality levers, in order:

1. **Turn DOM grounding ON for real runs** (`MIGRATION_TARGET_URL` + `DOM_GROUND_STRICT`).
   Most FIX-FIRST defects here are "locator is a guess" — DOM grounding converts the
   guess into a verified locator or an honest LOW-confidence fallback.
2. **Teach the scorer to distrust ungrounded locators** — a `getByRole` with no
   DOM-probe confirmation should not score as canonical. Today the scorer is blind to
   grounding, which is why it anti-correlates here.
3. **Fix cross-migration POM contamination** — a shared POM must not inject
   assertions into a spec that did not request them.

This is the honest answer to "raise measured quality to 96%": it is gated on **DOM
grounding + scorer-grounding-awareness + POM isolation**, each a real engineering
item — not reachable by re-scoring or prompt-tweaking alone.

## How to reproduce / scale this

```bash
# Zero-token re-score of every existing migration (honest scorer):
for spec in outputs/tests/*.spec.ts; do
  base=$(basename "$spec")
  npx tsx scripts/evaluate.ts \
    --input "inputs/bad-playwright/$base" \
    --plan "outputs/plans/$base.md" \
    --output "$spec" \
    --report-out "/tmp/rescore-$base.md"
done
```

To grow the sample beyond n=5 you must run **real** Stage-2 migrations (they spend
tokens) over inputs that have an approved plan:

```bash
npm run migrate -- --inputs 'inputs/bad-playwright/*.spec.ts' --mock   # free cost preview first
npm run migrate -- --inputs 'inputs/bad-playwright/*.spec.ts'          # real run (needs auth + plans)
```

Then re-score and recompute the table. A statistically meaningful acceptable-rate
needs ≥ 20 migrations (the threshold ADR 0001 / the LangGraph note already cite).

## Bottom line

Don't quote a single "quality %" with confidence yet — quote **"60% first-attempt
auto-ship, 40% to verify, 0 silent no-ops, n=5, honestly scored"** and note the
sample is small. The honest baseline is the prerequisite for any quality claim;
this document is that baseline.
