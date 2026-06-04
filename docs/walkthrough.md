# End-to-end walkthrough

> A real migration, narrated. Uses [PR #3](https://github.com/Jurajjjjj1988/PWmodernizer/pull/3) — the first multi-file Selenium-Java input that flowed through Stage 1 end-to-end — as the canonical example. Run [#26951988169](https://github.com/Jurajjjjj1988/PWmodernizer/actions/runs/26951988169) produced the artefacts you'll see below.

## What we'll walk through

We'll take one real input (`inputs/selenium-java/EmployeesTest.java` and its two siblings) through the full pipeline — Stage 1 plan, Stage 2 code generation, the optional Verify pass, and final merge — using PR #3 as the running example. By the end you'll know which workflow fires when, what each Claude call is actually reading, where the validation gates live, and what a reviewer is supposed to do at each PR. If you've skimmed the [`../README.md`](../README.md) architecture diagram and want to see it in motion, this is the document.

## The input

The selenium-java multifile unit is three files in one directory:

```bash
inputs/selenium-java/
  EmployeesTest.java          # 40 LOC — JUnit 5 test class, 2 @Test methods
  pages/EmployeesPage.java    # 66 LOC — PageFactory + @FindBy POM
  helpers/DriverFactory.java  # 34 LOC — ThreadLocal<WebDriver> lifecycle
```

The plan workflow detects this is a directory-grouped unit (see `group_to_unit` in `plan.yml`) and treats all three files as one migration. A representative slice of the test file:

```java
@Test
void searchFiltersTheEmployeeGrid() throws InterruptedException {
    employees.search("Jane");
    assertTrue(employees.rowCount() >= 1);
    assertTrue(employees.firstRowName().toLowerCase().contains("jane"));
}
```

…and the POM it delegates to:

```java
public void search(String query) throws InterruptedException {
    searchInput.clear();
    searchInput.sendKeys(query);
    Thread.sleep(1500);                                     // hard-wait masking debounce
}

public int rowCount() {
    return driver.findElements(By.cssSelector(".employees-grid .row")).size();
}

public String inviteToastText() {
    return driver.findElement(
        By.xpath("//div[contains(@class,'toast')]/span[2]") // positional XPath
    ).getText();
}
```

Three anti-patterns are already visible in fifteen lines: `Thread.sleep(1500)` masking a debounce, `findElements(...).size()` as a synchronous probe (a `sync-probe`), and a positional XPath `span[2]`. The full POM has more (PageFactory eager init, `WebDriverWait` boilerplate, `Actions.moveToElement` before a click). The plan stage will enumerate every one.

## Stage 1 — trigger and what happens

Two ways to fire Stage 1: push a new file under `inputs/**`, or manually:

```bash
gh workflow run plan.yml -f input_path=inputs/selenium-java/EmployeesTest.java
```

What the workflow does, in order — the step names match `.github/workflows/plan.yml`:

1. **`detect-changed-inputs`** — groups paths into single-file or directory units. For our case, all three siblings under `inputs/selenium-java/` collapse to one matrix entry.
2. **Stage 0 pre-flight** — `find` walks the dir, totals bytes + estimated tokens, runs an encoding check and a min-content test-marker grep, then sweeps for hardcoded prod credentials (AWS / Stripe / Anthropic / OpenAI / Slack patterns). 200B floor, 25k-token cap (NVIDIA RULER context-degradation heuristic).
3. **Skip-if-already-planned dedup** — labels carry the input hash; if a PR for this exact content already exists, the run no-ops.
4. **`npm ci`** — installs validators (`ts-morph`, `ajv`, `tsx`).
5. **Token shape check** — distinguishes `sk-ant-oat-*` (OAuth) from `sk-ant-api-*` (API key) and routes to the right env var. Both work.
6. **Assemble prompts** — `scripts/assemble-prompts.ts` expands `{{include:_fragments/*.md}}` markers from [`../prompts/`](../prompts/) into [`../prompts/_assembled/`](../prompts/_assembled/). The latter is what Claude actually reads.
7. **Run Claude (analyze)** — Sonnet 4.6 with `--max-turns 12 --permission-mode acceptEdits`. It reads the assembled prompt, [`../config/migration-rules.md`](../config/migration-rules.md), [`../config/knowledge-base.md`](../config/knowledge-base.md), the company-style anchor, and the input. Writes the plan markdown plus the envelope JSON sidecar.
8. **Validate plan structure** — eight required H2 sections must be present (`## Source framework`, `## Summary`, `## Anti-patterns detected`, etc.) and at least one HIGH/MED/LOW token must appear.
9. **Validate envelope JSON** — strict AJV schema check against `scripts/plan-envelope.schema.json`. If Claude didn't emit the sidecar, `scripts/derive-envelope.ts` reverse-engineers it from the markdown (safety net, logs a warning).
10. **Severity histogram** — counts `| H |` / `| M |` / `| L |` rows for the PR title chip.
11. **Persist plan metrics** — appends a row to `outputs/.metrics.db` for the dashboard.
12. **Open plan PR** — `peter-evans/create-pull-request` opens `migrator/plan-<basename>` against `main`, labelled `migrator:plan` + the input-hash label.

Wallclock for this PR: about 10 minutes — Claude ate ~9, scaffolding ~1.

**What went wrong getting here.** Two real failures shipped a fix:

- Stage 1 / Stage 2 PR-creation step failed with `HTTP 400 Duplicate header: Authorization` because `actions/checkout` and `peter-evans/create-pull-request` both stash `AUTHORIZATION` extraheaders. Fixed in commit `0b38aa5` by adding `persist-credentials: false` to checkout in `plan.yml` and `migrate.yml`. Full entry in [`troubleshooting.md`](troubleshooting.md).
- `npm ci` failed with `ERESOLVE` on `tree-sitter-python@0.23.6` because the package declares `peerOptional` on `tree-sitter@^0.25` and the project pins `^0.21.1`. Fixed in commit `ca9afdb` by adding `.npmrc` with `legacy-peer-deps=true`.

## What the plan produces

The plan markdown lives at `outputs/plans/EmployeesTest.java.md` on the PR branch. The opening framework-detection block reads:

> **selenium-java** — JUnit 5 + Selenium WebDriver 4.x (inferred from `org.openqa.selenium.*` imports, `@Test` / `@BeforeEach` / `@AfterEach` annotations, and `PageFactory` / `ExpectedConditions` usage). No explicit library version pinned in source files; PageFactory deprecation warning in Selenium 4 is consistent with the observed `@FindBy` + `initElements` pattern (KB-1.3.14).
>
> **Target framework:** Playwright TypeScript (latest stable, 1.44+).
>
> **Migration unit:** three-file directory treated as one unit per Selenium multifile migration rules…

The anti-patterns table sorts H first. Top rows of the actual PR #3 table:

| Sev | File | Line | KB-ID | Anti-pattern | Snippet | Replacement |
|---|---|---|---|---|---|---|
| H | EmployeesPage.java | 18 | KB-1.1.14 | hardcoded-url | `URL = "https://hr.beacon.test/employees"` | `page.goto('/employees')` with `baseURL` from env via config |
| H | EmployeesPage.java | 40 | KB-1.3.1 | hard-wait | `Thread.sleep(1500)` | web-first assertion on grid row appearing |
| H | DriverFactory.java | 11 | KB-1.3.16 | ThreadLocal-driver | `ThreadLocal<WebDriver> DRIVER` | Drop; Playwright `page` fixture is per-process, parallel-safe |

The locator translation table marks each translation with HIGH / MED / LOW confidence:

| Original | New | Confidence | Notes |
|---|---|---|---|
| `@FindBy(id = "search-employees")` | `page.locator('#search-employees')` | high | Direct ID→CSS per KB §6 Rule 1 |
| `@FindBy(xpath = "//header//button[contains(., 'Add')]")` | `page.getByRole('button', { name: /add/i })` | med | Semantic `<button>` tag is direct evidence; exact accessible name unverified (Q3) |
| `By.xpath("//div[contains(@class,'toast')]/span[2]")` | `page.getByRole('alert')` | low | Toast ARIA role unverified; positional `span[2]` loses meaning (Q6) |

…and then the hallucination-defense pins section — one pin per low/med assumption, each with a source-locator fallback the reviewer can paste in if DOM contradicts the guess:

> **Pin 5 — Confirmation toast.** Assumed `page.getByRole('alert')`. If toast container does not carry `role="alert"` or `role="status"`: keep `page.locator('xpath=//div[contains(@class,\'toast\')]').filter({ hasText: /invitation sent/i })`, add WHY-comment `'Q6 unresolved: toast ARIA role not confirmed'`. Reviewer fallback: ask FE team to add `role="alert"` to the toast component.

The plan closes with ten numbered open questions for the reviewer (one per ambiguous decision), six risk callouts (search-debounce masking, toast auto-dismiss race, parallel-worker email collision…), and an estimated metrics block (selector quality 0.50, anti-pattern delta −24).

## Reviewing the plan PR

The PR body carries a five-item Stage-1 review checklist:

- [ ] Source framework detected correctly?
- [ ] All anti-patterns listed match what you'd flag manually?
- [ ] Locator confidence column — are LOW/MED rows actually risky?
- [ ] Structural changes match file complexity?
- [ ] Open questions answered (edit the plan if needed)?

Two ways to push back:

- **Edit the plan in-place** — change locators, sharpen open-question answers, drop bogus anti-patterns. Stage 2 reads the plan as-merged, so your edits become the contract. This is the right move for surgical changes ("the toast IS `role=status`, not `role=alert`").
- **Comment `/regenerate <feedback>`** — fires `regenerate-dispatch.yml`, closes the current PR, and runs Stage 1 again with your feedback string injected into the prompt. Right move when the plan got the source framework wrong, missed a whole file, or hallucinated a fixture.

The envelope JSON sidecar (`outputs/plans/EmployeesTest.java.envelope.json`) is what locks Stage 2's hands. It pins the scenario IDs (`1.1`, `1.2`) that Stage 2 must emit as `// plan:scenario=1.1` comments above each `test(...)` call, the required POM file paths, and the locator table in machine-readable form. The migrate workflow's plan-vs-code coverage check (`scripts/plan-code-coverage.ts`) refuses to merge code that drops or renumbers a scenario.

## Stage 2 — trigger by merging the plan PR

Merging the `migrator:plan` PR fires `migrate.yml` (push-trigger on `outputs/plans/**`). The shape mirrors Stage 1:

1. **Guard** — confirms the merged PR carries the `migrator:plan` label and parses the input path from the PR body.
2. **Validate envelope BEFORE reading plan** — first gate, fails fast if the sidecar is malformed.
3. **Assemble prompts + build snippet inventory** — `scripts/build-inventory.ts` produces a per-locator candidate list Claude can ground against.
4. **Run Claude (generate)** — Sonnet 4.6, `--max-turns ~14`. Reads the plan markdown, envelope JSON, input, KB, rules, and the style anchor. Writes `outputs/tests/<basename>/*.spec.ts` plus `pages/*.page.ts` if the plan said extract.
5. **Validate (tsc + eslint + playwright parse)** — three validators on the generated TS. If lint errors are present, the workflow writes them to `outputs/.lint-errors.md` and triggers one fix-retry.
6. **Fix-lint retry (1× cap)** — Claude re-runs with the lint errors as input, then re-validates. If still failing, the job fails the run; reviewer has to `/regenerate`.
7. **AST-diff non-trivial check** — `scripts/ast-diff-trivial-check.ts` rejects "translations" that are too close to a structural mirror of the input.
8. **Plan-vs-code coverage** — every scenario ID from the envelope must appear as exactly one `// plan:scenario=<id>` comment in the generated specs.
9. **Output secret scan** — same patterns as Stage 0, run over the generated code (defence-in-depth).
10. **DOM-ground locators (opt-in)** — if `MIGRATION_TARGET_URL` is set, `scripts/dom-ground.ts` verifies each locator resolves on the live DOM. See [`playwright-mcp-integration.md`](playwright-mcp-integration.md) for the contract.
11. **Evaluate** — `scripts/evaluate.ts` emits an aggregate confidence in `[0, 1]`. Drives downstream routing.
12. **Open code PR** — labelled `migrator:code` plus `confidence:high` or `confidence:low` depending on the evaluator output.

The code PR contains the TS code, the migration report (`outputs/reports/<basename>.md`), and a row in the metrics DB. Lint is guaranteed clean; envelope-pin coverage is guaranteed.

## Verify — automatic on confidence < 0.7

When `evaluate.ts` returns < 0.7, `migrate.yml`'s `trigger-verify` job fires `verify.yml`. This is the CANDOR pattern (`arxiv:2506.02943`): two parallel Opus calls, one with the SDET lens ([`../prompts/verify-sdet.md`](../prompts/verify-sdet.md)) and one with the Code Review lens ([`../prompts/verify-code-review.md`](../prompts/verify-code-review.md)). Each reads its own checklist and writes its own verdict.

Verdict ladder (`scripts/verify-tally.ts`):

- **2/2 SHIP IT → SHIP IT.** Combined report posted on the code PR. The `confidence:low` label is replaced with `confidence:high` — the Opus pair overrides the Sonnet alarm.
- **1/2 SHIP IT → FIX FIRST.** Reviewer reads the dissenting lens's concerns and either edits the code or `/regenerate`s.
- **0/2 SHIP IT → START OVER.** Verify fires an auto-`/regenerate` via `repository_dispatch`, with a `regen-attempt:N` counter label (cap 3). If the counter hits `max-reached`, the workflow halts and requires manual intervention.

Both sub-agents also run an output secret scan on their report, so a hallucinated key in a verify excerpt can't leak.

## What happens on merge of the code PR

Merging the `migrator:code` PR is the end state. The recommended branch-protection setup in [`../README.md`](../README.md) requires the `migrator:code` label, `confidence:high` (or a Verify SHIP IT override), and a human approval. Once merged:

- The migrated tests live at `outputs/tests/<basename>/`.
- The migration report (anti-patterns fixed, locator quality score, AST-diff distance) lives at `outputs/reports/<basename>.md`.
- The metrics row persists to `outputs/.metrics.db`. Visualise with:

```bash
npm run dashboard           # → http://localhost:8000
```

That's the loop. Push an input, review two PRs, merge.

## Common failure modes for first-time users

The single most useful follow-up read is [`troubleshooting.md`](troubleshooting.md), which catalogues nine known failure modes named by symptom (the user reads what they see, not what caused it). The two from this walkthrough — `HTTP 400 Duplicate header: Authorization` and `npm ERESOLVE` — are entries one and two.

Four things to set up before your first migration:

1. **`CLAUDE_CODE_OAUTH_TOKEN` repo secret.** Generated locally via `claude setup-token`. The plan workflow auto-routes `sk-ant-api-*` vs `sk-ant-oat-*` so either token shape works.
2. **`MIGRATION_TARGET_URL` repo variable (optional).** Enables DOM-grounding in Stage 2. Without it, low-confidence locators stay as guesses.
3. **Repository permissions.** Workflows need `contents: write`, `pull-requests: write`, `id-token: write` (already set in the YAML, but blocked by org policies in some setups).
4. **Branch protection on `main`.** Recommended config in the operational README — require `migrator:code` label + `confidence:high` + 1 human review before merge.

**Cost expectations.** Per migration, end-to-end: roughly `$0.30–$1.00` depending on input size. Stage 1 is the largest single chunk (Sonnet, ~10–20K context tokens including KB + rules); Stage 2 is comparable; Verify (when it fires) doubles the cost because it's two Opus calls. For PR #3's three-file unit (140 LOC), Stage 1 alone was around `$0.40`.

## Where to next

- [`../ROADMAP.md`](../ROADMAP.md) — living state for shipped vs in-progress features.
- [`beyond-v1-research.md`](beyond-v1-research.md) — four post-v1.0 directions (LangGraph, Claude SDK rewrite, auto-PR-merge, GitHub App).
- [`playwright-mcp-integration.md`](playwright-mcp-integration.md) — design brief for DOM grounding (the opt-in Stage 2 gate referenced above).
- [`baselines.md`](baselines.md) — measured wall-clock timings for smoke + calibrate + each validator. Use to spot regressions.
- [`../prompts/`](../prompts/) — the source prompts. If your input class consistently surfaces a quirk Claude misses, the right fix is usually a prompt edit, not a script change.
- [`../config/knowledge-base.md`](../config/knowledge-base.md) and [`../config/migration-rules.md`](../config/migration-rules.md) — the cached context every Claude call reads. Add a new anti-pattern here and Stage 1 starts flagging it on the next run.
