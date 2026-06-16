# Troubleshooting

> Known failure modes + the exact fix. Append-only — entries are named by SYMPTOM (what the user sees), not by cause. When you fix a new failure mode, add an entry here so the next person catches it in 30 seconds.

## CI / workflows

### Symptom: `npm error code ERESOLVE` on `npm ci` (CI or local)

```
npm error ERESOLVE could not resolve
npm error While resolving: tree-sitter-python@0.23.6
npm error Found: tree-sitter@0.21.1
npm error peerOptional tree-sitter@"^0.25.0" from tree-sitter-python@0.23.6
```

**Cause:** `tree-sitter-python@0.23.6` declares `peerOptional` on `tree-sitter@^0.25`. Our root project pins `tree-sitter@^0.21.1`. Both work fine at runtime; npm strict mode rejects the version conflict.

**Fix shipped (commit `ca9afdb`):** `.npmrc` at repo root sets `legacy-peer-deps=true`. Applies to all `npm ci` / `npm install` (local + CI).

If you ever delete `.npmrc`, the symptom returns. Either restore it or update the tree-sitter pins to a non-conflicting pair.

---

### Symptom: `plan.yml` / `migrate.yml` fails at "Open plan PR" / "Open code PR" step with HTTP 400

```
remote: Duplicate header: "Authorization"
fatal: unable to access 'https://github.com/.../': The requested URL returned error: 400
##[error]The process '/usr/bin/git' failed with exit code 128
```

**Cause:** `actions/checkout` (with `persist-credentials: true`, the default) stashes an `AUTHORIZATION` extraheader in the local git config. `peter-evans/create-pull-request@v7` then sets its own `AUTHORIZATION` header during fetch. GitHub server rejects the duplicate.

**Fix shipped (commit `0b38aa5`):** add `persist-credentials: false` to actions/checkout in `plan.yml` and `migrate.yml`. peter-evans/create-pull-request drives its own credentials via `inputs.token` (default `${{ github.token }}`).

`verify.yml` doesn't open PRs and stays as-is.

---

### Symptom: Stage 1 plan file produced but workflow fails at "Validate plan structure"

```
::error::Plan missing required section: ## Source framework
::error::Plan missing required section: ## Anti-patterns detected
::error::Plan has no confidence markers (HIGH/MED/LOW)
```

**Cause:** Sonnet produced output but the formatting drifted from the schema. Usually triggered by an over-long input or a corrupted prompt assembly.

**Fix:**
1. Run `npm run check:assemble` locally — if it reports `prompts/_assembled/` is out of sync, run `npm run assemble-prompts` and commit.
2. Comment `/regenerate <feedback>` on the plan PR — the regenerate-dispatch workflow re-fires Stage 1 with your feedback string passed to the prompt.
3. If a specific section is missing repeatedly, edit `prompts/analyze.md` to make the schema requirement louder (NOT bigger — louder, per Tam et al. 2024 schema-demotion guidance).

---

### Symptom: A Claude step exits with `code 1` and no log output between step start and exit

```
##[error]Process completed with exit code 1.
```

You see the bash command echo'd, then nothing, then the exit line. Three minutes of wall time, zero LLM activity in the log. The `Capture Claude usage stats` step that runs next warns `No claude events captured`.

**Cause:** Claude CLI runs with `--output-format stream-json` redirected to `/tmp/claude-*-events.ndjson`. stdout goes to the file, stderr is mostly silent for Claude CLI. When the process dies before emitting any event (auth failure, Anthropic 503, OAuth rate limit, ndjson SIGPIPE) the workflow log shows nothing because the file capture and the silent stderr conspire to hide the failure mode.

**Diagnosis:** look for the `Diagnose Claude crash` group in the run log (PR #128 + #129 added it on `if: failure()`). It dumps:
- ndjson byte size + line count
- last 5 events captured
- type of the final event

Three cases:
- **File does not exist or 0 bytes** → Claude died before opening stdout. Almost always auth (check the `RAW_TOKEN` env, recently rotated OAuth) or a network 503 at the Anthropic edge.
- **Final event type `init`** → handshake landed but no LLM activity started. Usually rate-limit at the model layer; rerun.
- **Final event type `assistant` / `tool_use`** → mid-stream death. Most often SIGPIPE from `--verbose` stream backpressure; verify the redirect is `>` not `| tee` (the documented stable pattern, see verify.yml header comment).

**Fix:** transient failures recover on rerun; the verify workflow auto-retries on attempt 1 (PR #127 + #131). For other workflows, `gh run rerun <id>` from a clean main is the right move. If a specific input crashes reproducibly across reruns, the input is the root cause — check `inputs/<framework>/<file>` for binary content or BOM bytes that Stage 0 pre-flight missed.

---

### Symptom: Verify tally step warns `Failed to dispatch verify retry. Falling through to auto-regen.`

```
##[notice]START OVER on attempt 1 — firing verify retry (attempt 2) on same pr_branch before auto-regen.
could not create workflow dispatch event: HTTP 403: Resource not accessible by integration
##[warning]Failed to dispatch verify retry. Falling through to auto-regen.
```

The cheap retry safety net silently 403s and a full auto-regen cycle runs in its place — ~10× the cost.

**Cause:** `gh workflow run verify.yml -f verify_attempt=2` hits `POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches`, which requires `actions: write` on the GITHUB_TOKEN. The verify.yml `permissions:` block originally granted only `contents: write` (for `repository_dispatch`) and `pull-requests: write`.

**Fix shipped (PR #127):** `actions: write` added to verify.yml top-level permissions.

If the symptom returns: somebody dropped `actions: write` from the permissions block — restore it. Cross-check against `verify-on-comment.yml` which has always had the right grant.

---

### Symptom: A Claude step is canceled at `Process completed with exit code 124` (or `The job running on runner ... has exceeded the maximum execution time`)

```
##[error]The action has timed out.
##[error]Process completed with exit code 124.
```

**Cause:** PR #130 added per-step `timeout-minutes` caps to every Claude LLM call. The step exceeded its cap (verify 15m, plan 20m, migrate-generate 30m, migrate-fix-lint 10m, regression-semantic 20m). Either a genuine hang at the model layer, or a healthy long-tail run that pushed past the cap.

**Diagnosis:** open the `Diagnose Claude crash` group — same observability as the crash-code-1 case above. Last event type tells you what the model was doing when the timeout fired.

**Fix:**
- **Genuine hang (no progress in last 5 minutes of events):** rerun. If reproducible, the underlying issue is Anthropic-side (open a status ticket); the timeout is doing its job.
- **Healthy long-tail (events progressing right up to the cap):** the cap is too tight for the workload. Bump the `timeout-minutes` value in the offending workflow file. The original caps were sized at 2-3× observed typical runtime — if median runtime grew (heavier fixtures, more KB context), bump proportionally. Don't bump above 60 minutes without changing the budget guard in lockstep.

---

### Symptom: `npm run smoke` fails with `validate-examples: ... KB-ID 'cy/foo/bar' not defined`

**Cause:** A plan in `examples/*/expected-plan.md` cites a new-format KB ID (`cy/foo/bar`) that is documented in `config/kb-id-migration.md` as an alias but not yet rewritten as a new-format header in `config/knowledge-base.md`. The headers are still old-format (`#### 1.2.X`), so the validator only resolves `KB-1.2.X` references.

**Fix:**
- Strip the redundant new-format citation if the plan already cites the `KB-1.2.X` form (commit `62e4014` example).
- OR (Phase 2 work, not yet done): land the §1.2 header rewrite in `knowledge-base.md` so both formats resolve. See `kb-id-migration.md §3.2` for the migration steps.

---

## Pipeline behavior

### Symptom: Verify ships SHIP IT but PR keeps `confidence:low` label

**Cause:** Stage 2 confidence was below 0.7, so the `confidence:low` label was attached at PR open. Verify's CANDOR consensus came back 2/2 SHIP IT but the label wasn't updated.

**Fix shipped (commit `0c9f234`):** Verify-tally job explicitly removes `confidence:low` and adds `confidence:high` on final SHIP IT. If you see this on a PR opened before that commit, manually relabel.

---

### Symptom: PR auto-fires verify with `regen-attempt:max-reached` and refuses to retry

**Cause:** The PR has already gone through 3 START OVER → repository_dispatch regenerate cycles. The verify workflow caps at 3 attempts to prevent infinite loops.

**Fix:** This is expected. The next step is human review — either:
1. Edit the plan/code by hand to fix what's blocking SHIP IT
2. Close the PR and `gh workflow run plan.yml -f input_path=<original>` to start fresh
3. If the regen logic itself looks broken, see `regenerate-dispatch.yml` + verify.yml's regen counter logic.

---

### Symptom: DOM grounding step is `skipped` even though MIGRATION_TARGET_URL is set in repo secrets

**Cause:** The secret is set at the org/user level but not visible to the workflow (private fork, secret scoped to specific environments).

**Fix:**
1. Confirm `MIGRATION_TARGET_URL` is set in **Repo Settings → Secrets and variables → Actions**, NOT in environments.
2. In migrate.yml the env binding is `${{ secrets.MIGRATION_TARGET_URL }}`. If `secrets.MIGRATION_TARGET_URL` evaluates to empty string at runtime, the step writes `dom_probe_status=skipped` and exits 0 by design.
3. To debug, temporarily change the step to also echo `[ -n "${MIGRATION_TARGET_URL:-}" ] && echo "URL present, len=${#MIGRATION_TARGET_URL}"`.

---

## Local dev

### Symptom: `npm run dashboard` shows empty charts

**Cause:** `outputs/.metrics.db` is empty (first-run state) or you're running against a fresh checkout.

**Fix:** Run any migration through the local pipeline at least once to populate the DB. Or synthesize a row:

```bash
sqlite3 outputs/.metrics.db "INSERT INTO migrations VALUES ('test', 'bad-playwright', 0.85, 0.92, 'SHIP IT', '2026-06-04', 'flaky-waits.spec.ts');"
```

See `scripts/metrics.ts` for the canonical schema.

---

### Symptom: `npm run check:dom-ground` smoke fails with `playwright was not found`

**Cause:** `node_modules/playwright` is missing or the browser binaries aren't installed.

**Fix:**
```bash
npm ci
npx playwright install chromium
```

The mock-mode smoke (`mock://always-resolve`) doesn't actually launch a browser, so it should work without `playwright install`. If it still fails, the `playwright` package import is the bottleneck — `npm ci` should fix that.

---

### Symptom: `scripts/derive-envelope.ts` produces an envelope but `plan-envelope-validate.ts --code` reports orphans

**Cause:** The derived envelope synthesized scenarios that don't have matching `// plan:scenario=<id>` pins in the spec file. Common when the spec uses a different ID scheme than the markdown plan.

**Fix:**
1. Read the derived envelope. Scenarios will be `1.1`, `1.2` etc.
2. Add `// plan:scenario=1.1` comments immediately above each `test(...)` call in the spec, matching the derived IDs.
3. Re-run `npm run check:envelope:code`.

For a long-term fix, edit the source plan markdown so it uses explicit scenario IDs that survive derivation cleanly.

---

### Symptom: Code PR opened by `github-actions[bot]` (#122, #126, …) has lint-output + danger checks stuck `action_required` forever

```
gh pr view 122 --json statusCheckRollup
# ↳ both checks: { conclusion: "action_required", run_attempt: 1, status: "completed" }

gh api -X POST repos/<owner>/<repo>/actions/runs/<id>/approve
# ↳ "This run is not from a fork pull request" — HTTP 403
```

The check runs are *created* but never run any job (jobs array empty). PR sits at `mergeStateStatus: UNSTABLE` indefinitely.

**Cause:** `peter-evans/create-pull-request@v7` (and similar PR-creating actions) authenticate with `GITHUB_TOKEN` by default. Per the [GHA security model](https://docs.github.com/en/actions/using-workflows/triggering-a-workflow), **workflows triggered by `GITHUB_TOKEN` do NOT trigger downstream `pull_request` workflows** — this prevents bot-creates-bot infinite loops. So when migrate.yml opens a code PR via `peter-evans/create-pull-request`, the resulting PR is owned by `github-actions[bot]`, and lint-output.yml + danger.yml (both `on: pull_request`) get marked `action_required` and never run jobs. There is no API or repo setting that bypasses this for internal PRs — the `/approve` endpoint is for fork PRs only.

**Fix (canonical, 2026):** Use a **GitHub App installation token** to mint the PR. App-installation tokens count as a separate identity (`<your-app>[bot]`) and downstream `pull_request` workflows *do* fire from them.

1. Create a minimal GitHub App on your account (Settings → Developer settings → GitHub Apps → New).
   - Permissions: Contents `Read & write`, Pull requests `Read & write`, Workflows `Read & write`.
   - Install it on this repo only.
   - Download the App's private key (`.pem`) — keep it offline.
2. Store as repo secrets: `PWM_APP_ID` (the App ID number) + `PWM_APP_PRIVATE_KEY` (paste the `.pem` contents).
3. Edit migrate.yml + plan.yml: before each `peter-evans/create-pull-request` step, mint an installation token:
   ```yaml
   - uses: actions/create-github-app-token@v1
     id: app-token
     with:
       app-id: ${{ secrets.PWM_APP_ID }}
       private-key: ${{ secrets.PWM_APP_PRIVATE_KEY }}
   - uses: peter-evans/create-pull-request@v7
     with:
       token: ${{ steps.app-token.outputs.token }}
       …
   ```
4. After merge, the next code PR opens under `<your-app>[bot]` identity; lint-output + danger run automatically.

**Alternatives + tradeoffs:**

- **Personal Access Token (PAT):** Works but inherits user identity (PRs show as you), and PAT scope spans every repo you can access. Rotation requires updating every workflow that uses it. Acceptable for solo experiments; not recommended for repos you publish.
- **`pull_request_target` instead of `pull_request`:** Lets the workflow run with write-scoped token regardless of trigger source — but checks out the *base* ref with write access, and reading PR-supplied code in that context is a known supply-chain footgun. Especially bad for LLM-generated PRs whose contents are untrusted by definition. **Don't.**

**Workaround while you set up the App:** Push an empty commit to the affected branch:

```bash
git checkout <branch> && git commit --allow-empty -m "trigger ci" && git push
```

The `synchronize` event is attributed to your user identity, not the bot, and the gated workflows fire on the resulting head SHA.
