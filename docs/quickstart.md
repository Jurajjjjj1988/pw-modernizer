# Quickstart — 5-minute first migration

You will: clone the repo, run one command, read a real Stage 1 migration
plan against a bad Playwright spec. Total wall time on a warm machine
is ~90 seconds.

This is the fastest path from "what does this tool do?" to "I see what it
does." For the full pipeline narrative (Stage 1 + Stage 2 + verify on a
real PR), read [`walkthrough.md`](walkthrough.md) after this.

## 1. Prerequisites

- **Node 22+** — `node --version` should print `v22.x` or higher. Install
  via [nvm](https://github.com/nvm-sh/nvm) (`nvm install 22`) or
  [fnm](https://github.com/Schniz/fnm).
- **`gh` CLI** — required for the "run your own migration" step below
  (not for `npm run try-it`). Install: `brew install gh` /
  `sudo apt install gh`.
- **One of these auth tokens** (only needed for the real Claude call;
  `--mock` skips this):
  - `CLAUDE_CODE_OAUTH_TOKEN` — generate locally via `claude setup-token`
    in a terminal where you're logged in to Claude Pro/Max. Uses your
    existing subscription, no separate billing.
  - `ANTHROPIC_API_KEY` — from <https://console.anthropic.com/>. Pay
    per token.

You do NOT need a running test target, a database, Playwright browsers,
or any other infrastructure. The demo input is a self-contained ~20 LOC
spec describing a fictional storefront.

## 2. Run the demo

```bash
git clone https://github.com/Jurajjjjj1988/PWmodernizer.git
cd PWmodernizer
npm install              # ~45s on a warm npm cache
npm run try-it           # ~30-60s — the real Stage 1 call
```

If you don't have a Claude token yet and just want to see the wiring:

```bash
npm run try-it -- --mock # ~1s — pre-canned plan, no Claude call
```

What `try-it` does, in order:

1. Detects your auth env. Prints actionable instructions if missing.
2. Assembles prompt fragments (the same `prompts/_assembled/analyze.md`
   that `plan.yml` uses in CI).
3. Either calls Claude with the same model + max-turns + prompt as the
   production workflow, OR copies the canned mock plan.
4. Streams progress with per-step timing.
5. Prints a short narration of what the plan contains and where to find
   it.

Both modes write the plan to `outputs/plans/bad-test.spec.ts.md`.

## 3. Read your first plan

Open `outputs/plans/bad-test.spec.ts.md`. The plan has eight required
sections — `plan.yml`'s validator hard-fails Stage 1 if any are missing,
so you'll see all of them:

| Section | What's in it |
|---|---|
| `## Source framework` | Detected source (`bad-playwright` for the demo) + subtractive vs. translative flag. |
| `## Summary` | One paragraph naming the user journey + the bug class the test catches. |
| `## Anti-patterns detected` | Table: severity (H/M/L), line, KB-ID, snippet, replacement. The demo input flags ~9 anti-patterns: hard waits, nested promises, sync probes, `nth(0)` selector, hardcoded URL. |
| `## Locator translation table` | Old locator → new locator with **HIGH/MED/LOW confidence**. LOW rows are the LLM's guesses — those are what you review hardest. |
| `## Hallucination-defense pins` | LOW-confidence locators paired with a WHY-comment and a reviewer fallback. |
| `## Structural changes` | Extract POM yes/no, extract fixture yes/no, split into multiple specs yes/no, with reasoning. |
| `## Open questions for reviewer` | `Q1`, `Q2`, ... — the things Stage 1 could not answer and wants confirmed. |
| `## Risk callouts` | Things that could break Stage 2 if ignored (e.g. "this 7s wait might be masking real backend latency"). |
| `## Expected metrics` | Selector quality score, smell count delta, LOC delta, anti-pattern coverage. |

Read it like a code review — the LOW-confidence rows and the open
questions are where the LLM is asking for your input.

## 4. Run your own migration

Once you've seen what a plan looks like, point the pipeline at one of
your own tests.

```bash
# 1. Drop your spec into inputs/ under the matching framework folder.
cp path/to/your-bad-test.spec.ts inputs/bad-playwright/

# 2. Commit + push on a feature branch.
git checkout -b try-my-migration
git add inputs/bad-playwright/your-bad-test.spec.ts
git commit -m "try migration: your-bad-test.spec.ts"
git push -u origin try-my-migration
```

`plan.yml` fires automatically on the push. It opens a PR labeled
`migrator:plan` with the generated plan at
`outputs/plans/your-bad-test.spec.ts.md`.

Review the plan in the PR. Edit anti-pattern rows or change locator
targets if you disagree. Merge the plan PR. Merging fires `migrate.yml`
(Stage 2), which reads the approved plan and emits the qa-master
layered Playwright TypeScript output to `outputs/tests/` and
`outputs/helper/`.

The reviewer-facing PR description includes confidence scores, validator
results, and links to the metrics report.

### Run Stage 2 locally instead (no CI, no fork)

You don't have to push and merge a plan PR to generate code. Once a plan
exists (from `plan.yml` or `npm run try-it`), run Stage 2 on your own
machine:

```bash
npm run migrate -- --check                 # preflight: Node/auth/plan setup doctor (free)
npm run migrate -- --input inputs/<framework>/your-bad-test.spec.ts
npm run migrate -- --input <path> --mock   # wiring check, no Claude call (free)
npm run migrate -- --input <path> --profile lean   # specs + page objects only (ADR 0002)
```

By default the output is the full **qa-master** layered architecture. If your
team wants a simpler shape — just specs + page objects, with specs importing
`test`/`expect` straight from `@playwright/test` — pass `--profile lean`. The
conformance gate relaxes accordingly; `qa-master` stays the default.

This mirrors `migrate.yml` exactly — same prompt, inventory, model, and the
full post-generate validator wall — so you evaluate the tool by cloning and
running, without wiring GitHub Actions secrets. It needs `CLAUDE_CODE_OAUTH_TOKEN`
or `ANTHROPIC_API_KEY` in your env (same as the real `try-it`), and prints a
⚠ token-spend notice before the Claude call. CI remains the authoritative gate.

## 5. Where to go next

- [`walkthrough.md`](walkthrough.md) — end-to-end narrative on a real
  Selenium → Playwright migration (PR #6 → PR #13 on the public repo).
  Shows what the qa-master multi-file Stage 2 output looks like.
- [`/CLAUDE.md`](../CLAUDE.md) — orientation file for Claude / for
  anyone wanting the architectural summary in 100 lines.
- [`troubleshooting.md`](troubleshooting.md) — known failure modes and
  how to recognise them.
- [`baselines.md`](baselines.md) — what the pipeline outputs look like
  for each source framework, with diffs against the inputs.

If `npm run try-it` fails, re-run with `-- --mock` to isolate the
Claude call from the rest of the wiring. Both modes produce the same
plan file at the same path.
