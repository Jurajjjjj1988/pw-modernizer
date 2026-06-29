# Raising the real acceptable-rate above 33% — research findings + plan

> **Context.** The measured run (`docs/measured-quality-baseline.md` Run 2) put the
> real first-attempt human-acceptable rate at **~33%** (n=6 bad-Playwright, real
> Stage-2 batch, 12-agent adversarial review), root-caused to **hallucinated
> locators** + **cross-migration POM contamination**. The grounding-aware scorer
> (#228) routes ungrounded migrations to verify (a safety valve) but does not
> *prevent* either defect. This note is the multi-agent research output on how to
> prevent them. Sources are inline.

## The smoking gun: DOM grounding is built but DARK

The pipeline already has a complete DOM-grounding chain — and **none of it runs**:

- `scripts/dom-snapshot.ts:85` captures the accessibility tree via
  `locator('body').ariaSnapshot()` (token-free — a Playwright launch, no LLM).
  **No workflow ever invokes it.** Only the `dom:snapshot` npm alias exists
  (`package.json:59`); grep of `.github/` finds zero callers.
- Because the snapshot file is never written, **both consumers permanently take
  their offline `exit 0` branch**: `prompts/analyze.md:128-167` (Step-4b DOM
  grounding) and `scripts/validate-plan-dom-grounding.ts:349-360`.
- `prompts/generate.md` has **zero DOM contact** — no snapshot include. Stage 2
  therefore promotes guessed `getByRole`/`getByTestId` with no evidence.
- The only DOM contact in the whole pipeline is `scripts/dom-ground.ts` running
  *after* Stage 2 emits code (`migrate.yml:1073`), and even that is opt-in on the
  `MIGRATION_TARGET_URL` secret — unset for the failing batch.

**How the field avoids this:** Playwright MCP, Stagehand, and Skyvern all feed the
accessibility tree *into* the model as the generation substrate. Playwright MCP's
`browser_snapshot` tags each interactive node with a stable `ref`; the model can
only act on refs that exist in the snapshot it was handed — so it *cannot*
hallucinate selectors. Stagehand merges a11y + DOM into an `EncodedId → XPath`
map and resolves the LLM's chosen ID back to a concrete locator (closed
vocabulary). The a11y tree is 80-90% smaller than raw DOM (~200-400 tokens), so
grounding is ~free in *model* spend — the only real cost is a reachable SUT.
Playwright 1.59 even ships `page.pickLocator()` + `locator.normalize()` to rewrite
any locator to its ARIA/testid canonical form *derived from the live element*.

## The four levers (prioritized; token-free first)

| # | Lever | Effort | SUT? | Builds on | Prevents |
|---|---|---|---|---|---|
| 1 | **Offline abstention gate** — Stage-1/2 must DERIVE accessible names from the source or ABSTAIN to an honest CSS/text fallback; a `getByRole('alert')` with no name-source and no snapshot is a HARD FAIL | M | no | `validate-plan-dom-grounding.ts`, `analyze.md:124` | hallucinated locators (offline) |
| 2 | **POM-contamination conformance (W15/W16 + W1 amend)** — ban content assertions in shared `waitForPageLoad()`; flag multi-migration POM authorship; action methods assert *transitions*, not business outcomes | M | no | `validate-pwm-blueprint-conformance.ts` `listPageMethods()`, `migration-rules.md:74-81` | POM contamination |
| 3 | **Turn on the dark capture + inject into Stage 2** — wire `dom-snapshot.ts` into `plan.yml`/`migrate.yml`; create the missing `prompts/_fragments/dom-snapshot.md` and `{{include}}` it in `generate.md` (closed-vocabulary rule) | S+M | yes | `dom-snapshot.ts:85`, `playwright-mcp-integration.md:60` | hallucinated locators (grounded) |
| 4 | **Execution gate** — A: run the migrated spec against the SUT (red on a hallucinated/contaminated locator); B: 1-retry self-repair from the real stderr; C: seed-mutant "catches-the-bug" gate (the planned mutation-kill-rate) | L | yes | `dom-ground.ts:280-300`, `migrate-local.ts:273-295`, `ROADMAP.md:169` | both (provably) |

### Lever 1 detail — offline abstention (highest token-free leverage)
Extend `validate-plan-dom-grounding.ts` so that with NO snapshot it does **not**
no-op: assert every `getByRole`/`getByLabel` with a `name` (and every
`getByTestId`) is **name-derivable from the SOURCE** (the string literally appears
in the input test as visible text / label / aria) OR is downgraded to the honest
source-faithful locator + a `// TODO: <Q-id> accessible-name unverified` comment.
`getByRole('alert')` / `getByRole('button',{name:/close|dismiss/i})` with no name
source and no snapshot = HARD FAIL → forces the honest fallback. Mirror the same
ts-morph check over the emitted `.spec.ts` in `generate.md`. This is the offline
analogue of type-constrained decoding (restrict `name` to a symbol table) — the
LLM grounds the name or abstains, and never ships a canonical-looking guess.
(`analyze.md:124` already states the rule in prose; this makes it a gate.)

### Lever 2 detail — POM contamination (token-free)
- **W15 (block):** flag any `waitForPageLoad()` whose `expect()` target is not
  `toHaveURL(...)` and not a structural-role locator (`navigation`/`main`/`banner`)
  — i.e. a content assertion like `getByRole('heading',{name:/welcome…/})` or
  `toHaveText`. `dashboard.page.ts:47-52` fails; `cart.page.ts:35-38` passes.
- **W16 (warn→block):** a `*.page.ts` with >1 migration-provenance header (two
  `Migrated from …` lines, or methods whose plan-pins belong to different plans)
  signals one shared POM authored by multiple migrations.
- **W1 amend:** an action method's required post-click assertion must assert a
  *transition* (state change of the acted element, or navigation started), not a
  downstream business outcome. `submitSignIn()` asserting `inputEmail.toBeHidden()`
  should instead return the destination POM and let its structural
  `waitForPageLoad()` gate — the login-succeeded assertion belongs in the spec
  that tests login, not in the shared method every later migration inherits.
- Seed calibration with `dashboard.page.ts` (bad-15) + `cart.page.ts` (good-15).

## First move + expected impact

**First move (token-free, no SUT):** Levers 1 + 2 — they prevent both root causes
offline and are deterministic engineering with local calibration fixtures (no SUT,
no model tokens). Then Lever 3 (grounding) against an already-calibrated public SUT
(SauceDemo, `docs/dom-ground-public-suts.md`) to *confirm* locators, and Lever 4
(execution) as the capstone that lets confidence finally mean "runs green AND
catches the bug" instead of "looks canonical."

**Honest expected impact:** the token-free levers (1+2) plausibly move the n=6
sample **33% → ~50-65%** by eliminating the hallucinated-locator and
POM-contamination defect classes the agents flagged; grounding + execution
(3+4, needs a SUT) is what closes the remainder toward the ~70% bad-PW gate. All
of it reuses existing assets — net-new code is a few validator checks + one
prompt fragment + one `WallStep`, not a new subsystem.

## Sources
- Playwright MCP snapshots (closed-vocabulary refs): https://playwright.dev/agents/mcp , https://playwright.dev/docs/test-agents
- Stagehand a11y→EncodedId→XPath grounding: https://github.com/browserbase/stagehand
- Playwright 1.59 `pickLocator` / `normalize`: https://playwright.dev/docs/release-notes
- Meta ACH (assured test generation via mutants): https://arxiv.org/abs/2501.12862
- Harden-and-Catch: https://arxiv.org/abs/2504.16472
