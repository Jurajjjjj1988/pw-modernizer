# Docs index

> Design briefs, troubleshooting, and post-v1.0 research notes. Operational README is at [`../README.md`](../README.md). Living ROADMAP is at [`../ROADMAP.md`](../ROADMAP.md).

## Design briefs

| Doc | Status | What it covers |
|---|---|---|
| [`playwright-mcp-integration.md`](playwright-mcp-integration.md) | Phase 1-7b shipped, 6 + 7c future | DOM grounding via direct Playwright (Stage 2 gate) + MCP (Stage 1 LLM enrichment). API contract for `scripts/dom-ground.ts`. 7-phase implementation order. |
| [`beyond-v1-research.md`](beyond-v1-research.md) | Scope only | 4 post-v1.0 directions (LangGraph, Claude SDK rewrite, auto-PR-merge, GitHub App). Per-direction motivation, implementation shape, prerequisites. |

## Operational

| Doc | What it covers |
|---|---|
| [`walkthrough.md`](walkthrough.md) | End-to-end walkthrough of a real migration using PR #3 as the running example. |
| [`troubleshooting.md`](troubleshooting.md) | Known failure modes + the exact fix. Updated when a real-world bug surfaces. |
| [`baselines.md`](baselines.md) | Measured smoke + calibrate + per-validator wall-clock timings. Use to spot regressions. |
| [`dom-ground-public-suts.md`](dom-ground-public-suts.md) | Curated catalog of public demo sites for Phase 7c calibration. |

## Metrics dashboard

`scripts/dashboard.ts` renders an HTML dashboard over the metrics SQLite cache
(`outputs/.metrics.db`) — per-framework counts, verdict distribution, confidence
trends, KB-citation rankings, cost + token totals, and a per-run cost table.

- **Live (deployed)** — every push to `main` runs `.github/workflows/dashboard-deploy.yml`,
  which renders a self-contained `index.html` via `--static` mode and publishes
  it to GitHub Pages. URL after one-time enablement (Settings → Pages → Source =
  "GitHub Actions"): `https://<owner>.github.io/<repo>/`. No secrets beyond the
  default `GITHUB_TOKEN`.
- **Local server** — `npm run dashboard` boots a tiny Node http server on
  `:8000` with a live `/api/data` endpoint reading the SQLite cache directly.
  Use this when iterating on the dashboard HTML or chart code.
- **Local static** — `npm run dashboard -- --static /tmp/dash/` writes one
  self-contained `index.html` with the aggregate JSON inlined. Same output the
  Pages workflow uploads — useful for reproducing what reviewers will see.

The dashboard renders cleanly even when the SQLite cache is empty (the
`MetricsDB` constructor creates a fresh DB with the schema applied) — all
counters and tables surface zero/empty-state placeholders until the pipeline
writes its first row.

### Cost + ROI panels

Three operator-facing panels stacked at the top of the dashboard answer
"what did this cost us and was it worth it":

| Panel | What it shows | Where the number comes from |
|---|---|---|
| **A — Cost this week** | Total spend over the last 7 days + per-stage breakdown + 30-day sparkline + delta vs the previous 7 days. | `migrations + plans + verifications` rows where `created_at >= now − 7d`, summed via `cost_usd` (NULL rows excluded — see "tracked vs untracked" rationale in `metrics.ts`). |
| **B — Cost per outcome** | Bar chart of average $ per migration across four buckets: **SHIP IT**, **FIX FIRST**, **START OVER**, **BLOCKED-BY-VALIDATOR**. Catches "we're paying $5+ for every failed migration" as an investigation signal. | Cost summed per `input_basename` across all stages, then bucketed by the latest `verifications.verdict` for that basename. `BLOCKED-BY-VALIDATOR` is synthetic — input_basenames that incurred plan/migrate cost but never produced a verify row (Stage 2 validator gates blocked them before Opus Verify ran). |
| **C — ROI vs hand-migration** | All-time pipeline spend vs the human-hour cost the pipeline displaced. Renders as a single multiplier — `humanCostUsd / pipelineCostUsd`. | `successfulMigrations` = count of distinct input_basenames with verdict SHIP IT or FIX FIRST (START OVER and BLOCKED don't count — no value delivered). `humanCost = successfulMigrations × humanHoursPerTest × humanHourlyRateUsd`. |

**Panel C assumptions (the honest part).** ROI math is only as good as
the displaced-effort baseline:

- **`humanHoursPerTest` = 4** (hard-coded). One bad-Playwright test rewritten
  cleanly: read the source, port locators, verify the fix, debug to
  Sonnet-equivalent quality. Tune `ROI_DEFAULT_HOURS_PER_TEST` in
  `scripts/dashboard.ts` if your team's baseline is materially different.
- **`humanHourlyRateUsd` = 80** (default). Override via the repo variable
  `PWM_HUMAN_HOUR_COST_USD` — set in repo settings → Variables → Actions, or
  exported in the shell when running `npm run dashboard` / `npm run cost:report`
  locally. The dashboard renders a note next to the multiplier saying whether
  it's reading the default or a configured value.
- **What counts as success.** Only verifications with verdict `SHIP IT` or
  `FIX FIRST` add to `successfulMigrations`. `START OVER` is a re-roll — no
  value delivered. `BLOCKED-BY-VALIDATOR` runs are tracked but ignored for ROI.
- **What doesn't count.** Per-test hand-migration time varies wildly
  (bad-Playwright is ~4h, Selenium-Java is closer to 8h). The single
  `humanHoursPerTest` number is a coarse fleet-wide average. A future
  enhancement is per-framework hours-per-test; for now the operator can
  multiply the displayed ROI mentally if their corpus skews toward Selenium.

To configure the hourly rate locally:

```bash
export PWM_HUMAN_HOUR_COST_USD=120
npm run cost:report           # Panel C will use $120/hour
```

To configure it for the deployed dashboard, set the repo variable
`PWM_HUMAN_HOUR_COST_USD` in GitHub → Settings → Variables → Actions and
re-run `dashboard-deploy.yml`.

### Cost report CLI

For operators who want a weekly Slack-friendly summary without booting the
web dashboard:

```bash
npm run cost:report           # pretty-text mode (3 sections, tabular)
npm run cost:report -- --json # machine-readable JSON (paste into a Slack /command, pipe to jq, etc.)
npm run cost:report -- --db /path/to/.metrics.db  # override DB path
```

The CLI reads the same SQLite source as the web dashboard — numbers match by
construction. Both default to `outputs/.metrics.db`.

## Where things live (cross-reference)

- Knowledge base — [`../config/knowledge-base.md`](../config/knowledge-base.md) (125 KB IDs across pw 25 / cy 50 / sel-java 24 / sel-py 26)
- KB ID migration scheme — [`../config/kb-id-migration.md`](../config/kb-id-migration.md) (old `KB-N.N.N` → new `<fw>/<topic>/<name>`)
- Prompts — [`../prompts/`](../prompts/) (sources) + [`../prompts/_fragments/`](../prompts/_fragments/) (shared blocks) + [`../prompts/_assembled/`](../prompts/_assembled/) (CI consumed)
- Validators + helpers — [`../scripts/`](../scripts/) (26 TS entries)
- Calibration fixtures — [`../tools/calibrate-pipeline/fixtures/`](../tools/calibrate-pipeline/fixtures/) (46 fixtures across 7 validators in the default chain; +6 dom-ground-live opt-in)
- Workflows — [`../.github/workflows/`](../.github/workflows/) (8 workflows: plan, migrate, verify, danger, lint-output, regression-test, regression-semantic, regenerate-dispatch)

## Contribution conventions for docs

- Living state (counts, percentages, dates) belongs in `ROADMAP.md` and `CHANGELOG.md`. Briefs here describe DESIGN, not status.
- Each brief opens with a status snapshot table — shipped/future per phase, with commit references.
- Mark a brief **shipped** by editing its §0 status block AND updating the index table above (Status column). Never delete a shipped brief; future readers comparing to current code need the design context.
- Troubleshooting entries are append-only and named by symptom (the user reads the symptom, not the cause). Cause + fix go inside the entry.
