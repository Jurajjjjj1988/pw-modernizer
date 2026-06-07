# How to continue PWmodernizer → 100%

> Snapshot taken 2026-06-07. Pipeline is at ~96%. Read this on resume.

## Where we are

**Real signal from this session:**
- 6/6 random public GitHub Selenium tests → solid Stage 1 plans (PR #6, #10, #11, #12, #14, #19)
- 5/5 cross-language Stage 2 outputs with `confidence:high` (PR #13, #15, #16, #17, #18)
- 3/3 verify CANDOR end-to-end (#15 FIX FIRST, #16 SHIP IT, #17 FIX FIRST)
- 8 validators / 53 calibration fixtures all green
- DOM grounding 6/6 live SUTs
- 3 README badges passing (Regression, Lint, Danger)
- 11 real infra bugs found + fixed in 2 days (regex, paths, parsers, peer-deps, auth)

**What's reliable today:** Stage 1 (plan generation) is production-quality on random GitHub input.

**What's still gappy:** Stage 2 quality calibration (Sonnet self-rates `confidence:high` but Opus reviewers disagree ~66% of the time — wants tweaks but not full reject).

---

## The 4% to 100%

### Priority 1 — Calibrate Stage 2 quality (~$2-3, 2 hours)

**Problem:** Sonnet writes Stage 2 code that Opus CANDOR flags as `FIX FIRST` (1 SHIP IT + 1 needs-fix). Real signal that generate.md prompt is missing instruction the verify-cr lens cares about.

**Action:**
1. Pull the 3 verify reports from PR #15, #16, #17 sub-agent artifacts
2. Group the Code Review concerns by theme (probably: TS strict types, KB-ID grounding density, structural conformance to envelope)
3. Add 2-3 hardening bullets to `prompts/generate.md` matching what verify-cr.md actually checks
4. Re-trigger Stage 2 on 1 input + verify — confirm SHIP IT rate moves from 33% → 60%+

**Why this is THE bottleneck:** every Stage 2 output is currently a `FIX FIRST` PR for human review. Pushing it to `SHIP IT` means auto-merge becomes plausible.

### Priority 2 — Backfill regression-semantic baselines (~$1, 1 hour)

**Problem:** `regression-semantic.yml` was hitting FAIL on `actual_count=18 vs expected_count=0` because example `expected-plan.md` files don't carry numeric anti-pattern counts. Asymmetric drift fix shipped (commit `61c2e98`) handles it, but baselines are still nominally stale.

**Action:** For each of 16 `examples/*/expected-plan.md`, add a small frontmatter or explicit "Expected anti-patterns: N" line that the regression-semantic parser reads. ~5 LOC per file.

**Why:** moves regression-semantic from "structurally working but data-stale" to "trustworthy CI gate".

### Priority 3 — More real-world Stage 2 samples (~$5, runs in background)

**Problem:** N=5 cross-language Stage 2 outputs is suggestive, not statistically conclusive. Need ~20+ for confidence interval.

**Action:** Pull 10 more random Selenium tests from `bonigarcia/selenium-webdriver-java` chapters 5-10 (cookies, dropdowns, frames, javascript, screenshots, shadow_dom, targets, timeouts). Each:
- `inputs/selenium-java/Ch<N>Test.java` + `_provenance/Ch<N>Test.md`
- Push → plan.yml auto-fires → merge plan PR → migrate.yml fires → verify
- Cost per cycle: ~Claude session quota for 1 plan + 1 generate + 1 verify = ~$0.30

**Why:** lets you publish honest success-rate numbers ("80% of randomly-sampled real Selenium tests produce confidence:high Stage 2 code") in any blog post / README / demo.

### Priority 4 — Cost monitoring (~$1, 1 hour)

**Problem:** Pipeline burns Claude session quota; today we hit limit twice. No per-PR cost report.

**Action:** Add `outputs/.metrics.db` column for `claude_tokens_in` + `claude_tokens_out` + `model`. Extract from claude --print JSON output. Render in dashboard:
- Per-PR estimated cost (input × $3/M + output × $15/M)
- Daily burn-rate alarm if cost > $X/day

**Why:** mandatory before customer-facing rollout. Also gives ops team breathing room.

### Priority 5 — Open-source release prep (~$2, 1 hour)

**Action:**
- Sanitize: nothing personal in `inputs/`, no real API keys in `.env.example`
- Add `LICENSE` (MIT or Apache-2.0)
- Add `CODE_OF_CONDUCT.md`
- Convert `inputs/` real-world tests to ship-with-repo examples (already Apache-2.0 from bonigarcia/SeleniumHQ)
- Tag v0.1.0
- Optional: a 5-min demo gif in README

**Why:** moves it from "personal project" to "community-usable artifact". 

---

## Beyond 100% (post-v1.0)

Documented in [`docs/beyond-v1-research.md`](beyond-v1-research.md). Don't start any of these without ≥30 merged real-world Stage 2 PRs as ground truth:

1. **LangGraph orchestration** — only if you find the workflow-yaml chain is the bottleneck. Right now CI is the bottleneck (race conditions), and LangGraph fixes that.
2. **Claude Agent SDK rewrite** — would replace `claude --print` with proper tool routing. Cleaner architecture, harder to debug.
3. **Auto-PR-merge** — flip when verify CANDOR ships 2/2 SHIP IT on >70% of real runs. Today: 33%.
4. **GitHub App distribution** — packaging concern; defer until 50+ users.

---

## Operational reminders

### Don't lose this state

- All code on `origin/main` (commit `2357688` is latest snapshot at write-time)
- `inputs/selenium-java/*.java` + `inputs/selenium-python/*.py` are the real-world ground truth
- `outputs/reports/*-verify-*.md` artifacts from each verify run hold the actual Opus feedback — gold for prompt refinement
- Closed PRs (#2, #5, #7, #8, #9) were synthetic / Cypress / superseded — don't reopen

### How to resume in 1 prompt

> "Continue PWmodernizer. Read docs/CONTINUE.md. Start with Priority 1 — calibrate Stage 2. Pull verify reports from PR #15/#16/#17 sub-agent artifacts, group the Code Review concerns, propose 3 generate.md hardening bullets. Don't ship anything until I approve the proposal."

### Cost realism

- 1 full Stage 1+2+verify cycle ≈ Claude Pro 30-min session burst
- Heavy iteration day (like today) ≈ 1 Pro/Max daily quota
- Production scaling assumes Anthropic API key, not Pro/Max
- Budget $50-100/month for steady-state development if going paid API

### What NOT to repeat

- ❌ Re-running Stage 2 7 times to find a path bug (~$3 wasted). Always commit + push + verify locally with `npm run smoke` BEFORE triggering CI.
- ❌ Triggering 4 parallel Stage 2 runs — concurrency group cancels 2 of them. Trigger sequentially OR fix concurrency group.
- ❌ Forgetting `_provenance/` is markdown — exclude from plan.yml triggers (already done in commit `37ad9f9`).
- ❌ Symmetric drift on metrics that should be one-sided (Sonnet finding MORE smells = good, not regression).

---

## What "100%" honestly means

**Achievable:** 95% Stage 1 reliability + 70% Stage 2 SHIP IT + cost monitoring + 30 real-world samples + OSS release. Total effort: ~2 weeks of focused work.

**Unrealistic:** 100% determinism. LLM tools are probabilistic. State-of-art (Devin, Cursor, Copilot Workspace) all have human gates. Aim for "reliable + observable", not "zero-touch".

**Demo-ready today:** Already there. Show it.

---

*This file is the resumption contract. Update the "Where we are" section after every multi-hour session.*
