# ADR 0002 — Output profiles (a config escape hatch for the mandatory pwm-blueprint architecture)

- **Status:** Phase 1 implemented (additive, opt-in) + the lean generate prompt — Phase 2 (CI wiring + per-profile calibration fixtures) still open
- **Phase 1 landed 2026-06-17:** `config/profiles/{pwm-blueprint,lean}.json`; `validate-pwm-blueprint-conformance.ts --profile lean` relaxes the spec import-source rule (Check 1) so lean specs may import `test`/`expect` from `@playwright/test`; `npm run migrate -- --profile lean` threads the flag to the conformance gate.
- **Lean generate prompt landed 2026-06-21:** `prompts/generate.lean.md` (assembled to `_assembled/generate.lean.md` via the existing `*.md` glob) — a spec + page-object contract that drops the pwm-blueprint triad/STOP block + style anchor while reusing the shared quality fragments (forbidden-patterns, web-first-assertions, locator-priority) and the metrics-schema report. `migrate-local.ts::buildPrompt`/`assembledPromptPath` are profile-aware (pwm-blueprint byte-identical); the lean `--mock` cost preview drops to ~½ (no pwm-blueprint reference dir). Remaining (Phase 2, supervised): CI `migrate.yml` wiring + per-profile good/bad calibration fixtures + a real lean migration to verify output quality.
- **Date:** 2026-06-17
- **Author:** Juraj Kapusansky (`@Jurajjjjj1988`)
- **Deciders:** Repo owner (single-maintainer project)
- **Supersedes:** —
- **Superseded by:** —
- **Related:** `config/migration-rules.md` §1 (the layout this ADR makes optional), `scripts/validate-pwm-blueprint-conformance.ts` (the gate), `prompts/_assembled/generate.md` (the prompt that teaches it), `docs/quickstart.md` "Run Stage 2 locally"

> **TL;DR.** Every migration is forced into the **pwm-blueprint layered architecture** (specs + page-objects + a mandatory `base.fixture` barrel + api/actions/utilities/test-data/types). That is the right output for the author's house style, but it is the single biggest *adoptability* blocker for a stranger whose "clean Playwright" is simpler — they cannot ask for "just specs + page objects." This ADR proposes an **output-profile** concept (`pwm-blueprint` default, `lean` opt-in) selected by ONE config value read by BOTH the prompt assembler and the conformance validator, so a fork changes one file instead of three coupled subsystems. **It deliberately ships no code** — the implementation touches the live prompt + validator and must be done in a supervised session with a real migration to verify, not autonomously.

---

## 1. Problem

The architecture is hardcoded across three coupled subsystems with no single override:

1. **The prompt** (`prompts/generate.md` + fragments) teaches Sonnet to emit the full tree and HARD-rejects a spec that imports from `@playwright/test` or uses raw `page`.
2. **The rules** (`config/migration-rules.md` §1–§2) define the layout + naming as non-negotiable.
3. **The validator** (`scripts/validate-pwm-blueprint-conformance.ts`) block-gates Stage 2 on conformance (no own-constructor POMs, `.describe()` on every locator, `[LABEL]` expect messages, fixture-barrel imports …).

A stranger evaluating the tool on their own suite has no way to say "I want specs + page objects, not a fixtures barrel and an api/ layer." They must either accept the full opinion or fork all three subsystems. The audit (2026-06-17) rated this an XL adoptability blocker.

## 2. Goal

A single declarative selector — `profile: pwm-blueprint | lean` — that BOTH the prompt assembler and the validator consume, so:

- `pwm-blueprint` (default): today's behaviour, unchanged. Zero regression for the author.
- `lean`: emit only `outputs/tests/<feature>.spec.ts` + `outputs/helper/page-object/pages/<name>.page.ts`. The fixture-barrel rule, the no-`@playwright/test`-in-spec rule, and the api/actions/utilities/test-data layers relax from *required* to *allowed-but-not-required*. Specs may import `test`/`expect` straight from `@playwright/test`.

## 3. Options considered

- **A — Do nothing.** Keep pwm-blueprint mandatory. Cheapest; leaves the XL blocker. Acceptable only if "stranger adoption" is explicitly out of scope.
- **B — Fork-time manual edit.** Document which three places to edit for a leaner output. Zero code; pushes the cost onto every adopter and drifts.
- **C — Profile config consumed by prompt + validator (recommended).** One `config/profiles/<name>.json` declaring `{ requiredLayers, forbiddenLayers, importPolicy, namingPolicy }`. The fragment assembler injects the profile's rules into `_assembled/generate.md`; the conformance validator reads the same JSON instead of inlined constants. A fork picks a profile (or writes one) in one place.
- **D — Full rules-engine.** Express *every* rule (selector priority, describe nesting, label messages) as data. Maximal flexibility, but a large rewrite of the validator into a config-driven check table — out of proportion to current demand.

## 4. Decision

Adopt **Option C**, phased, and **do not implement it autonomously**:

- **Phase 0 (this ADR):** record the design. No code.
- **Phase 1 (supervised):** add `config/profiles/{pwm-blueprint,lean}.json`. Wire ONLY the assembler to inject `profile.importPolicy` + `profile.requiredLayers` into the generate prompt. Keep the validator on pwm-blueprint. Verify with a real `npm run migrate --mock` + one supervised real migration per profile.
- **Phase 2 (supervised):** make `validate-pwm-blueprint-conformance.ts` read the profile JSON (required-vs-allowed layers, import policy) instead of inlined constants. Add good/bad calibration fixtures **per profile** (the ritual: ≥3 good + ≥3 bad each) before promoting `lean` past example status.

## 5. Why not now / why supervised

The change edits the live Stage-2 prompt and the block-gating validator. A subtle prompt regression silently degrades *every future migration*; a validator regression either lets bad output through or false-blocks good output. Neither is detectable without running a real migration and reading the result — which spends tokens and needs a human in the loop. Per this session's token-discipline (`npm run triage` / local-first), risky prompt+validator surgery is exactly the class of change to do **with** the maintainer watching, not in an autonomous batch.

## 6. Acceptance criteria (when Phase 1 is built)

- `npm run migrate -- --input <x> --profile lean --mock` resolves and prints the lean prompt shape.
- `npm run smoke` stays green (pwm-blueprint fixtures unchanged; lean fixtures added and calibrated).
- A real lean migration produces a spec that imports from `@playwright/test`, has a page object, and is NOT rejected by the conformance gate under `profile: lean`.
- The `pwm-blueprint` default path is byte-identical to today (regression guard: existing calibration corpus still green).

## 7. Consequences

- **Positive:** removes the XL "opinionated architecture" adoptability blocker; gives the author a clean seam to add future profiles (e.g. `cypress-parity`, `minimal`).
- **Negative:** two output shapes to keep calibrated; the validator gains a config-read indirection. Mitigated by the per-profile fixture ritual and keeping `pwm-blueprint` the unchanged default.
