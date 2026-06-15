# Anthropic prompt caching in PWmodernizer

> PoC scope: verify stage only. Plan + migrate follow the same pattern but require Stage-2 tool-loop support (Read/Write/Edit) on the SDK path — tracked as follow-up.

## Why we cache

Every Stage 3 (verify) Opus call sends a LOT of static context:

| Block | ~Tokens | Changes? |
|---|---|---|
| `prompts/_assembled/verify-{sdet,code-review}.md` | ~5 k | When prompts evolve (rare; gated by `npm run check:assemble`) |
| `config/knowledge-base.md` | ~37 k | When new KB IDs land (weekly cadence) |
| `config/migration-rules.md` | ~10 k | When rules tighten (~monthly) |
| **Variable per call** (input file + plan + spec + Stage 2 report + envelope) | ~3–10 k | Every migration |

Roughly 80 % of every Opus call is byte-identical to the previous Opus call. Anthropic prompt caching marks the static blocks with `cache_control: { type: "ephemeral" }`; subsequent calls within the 5-minute cache window pay ~10 % of normal input rate on those tokens (see `scripts/metrics.ts` PRICING table — Opus cache_read = $1.50/Mtok vs $15/Mtok normal input).

## What we cache (verify stage)

```text
SYSTEM blocks  (cache_control: ephemeral on the last block — covers the whole prefix)
  1. prompts/_assembled/verify-{lens}.md          # role + checklist
  2. config/knowledge-base.md                      # KB IDs + anti-pattern catalog
  3. config/migration-rules.md                     # the "good test" rule book

USER blocks    (NOT cached — vary per migration)
  4. Input source under test                       # inputs/<framework>/<basename>
  5. Approved plan                                 # outputs/plans/<basename>.md
  6. Generated spec                                # outputs/tests/<basename>.spec.ts
  7. Stage 2 report                                # outputs/reports/<basename>.md
  8. Run envelope (lens trailer)                   # generated boilerplate
```

The implementation lives in `scripts/claude-cached-call.ts` and uses the typed `client.beta.messages.create` API in `@anthropic-ai/sdk` 0.32.1.

## Expected savings

| Scenario | Cold call | Hot call | Δ |
|---|---|---|---|
| Single Opus call (one lens) | ~$0.80 | ~$0.18 | ~78 % |
| CANDOR pair (SDET + Code Review fired in parallel) | ~$1.55 cold pair, ~$0.55 hot pair | ~$0.36 fully warm | 35 % – 75 % depending on timing |
| Auto-regen retry (2nd verify within 5 min) | n/a | ~$0.36 | matches "fully warm" |

The "fully warm" hot-pair case assumes both lenses fire within the 5-minute ephemeral-cache window AND the second lens shares the KB + rules cache block with the first (it does — KB + rules are byte-identical between lenses; only the assembled `verify-{lens}.md` differs).

Run `npm run cache:dry-run` (see below) for live numbers off the actual assembled prompts in this repo — those are the source of truth.

## How to verify

### Dry-run the cache layout (no API call)

```bash
npm run cache:dry-run
# or directly:
tsx scripts/claude-cached-call.ts \
  --lens sdet \
  --input-basename foo \
  --dry-run
```

Output:

```text
=== claude-cached-call dry-run ===

SYSTEM blocks (cached, cache_control: ephemeral):
  Assembled prompt (verify-sdet.md)         20466   ~5117  prompts/_assembled/verify-sdet.md
  Knowledge base                           147506  ~36877  config/knowledge-base.md
  Migration rules                           39099   ~9775  config/migration-rules.md
  TOTAL                                    207071  ~51769

USER blocks (NOT cached — vary per migration):
  …

Estimated cost per call (output ≈ 1500 tokens):
  Cold (first call, cache creation):  $X
  Hot  (subsequent call, cache hit):  $Y
  Savings on a hot call:              $(X-Y)
```

### Inspect cache hit rate after real runs

Every call writes `outputs/.usage/<basename>-verify-<lens>.json` with `cache_read_tokens` and `cache_creation_tokens` populated. The aggregator:

```bash
npm run cache:report
# JSON form for dashboards:
tsx scripts/measure-cache-hit-rate.ts --json
```

The report breaks down hit rate per stage and totals the $ saved vs paying full input rate on every token.

A hit rate below ~50 % over a 24 h window suggests either (a) the 5-minute window is too tight for your trigger cadence, or (b) you edited a system block (KB or rules) — every cache prefix change invalidates downstream hits.

## How to invalidate the cache

Cache keys are content-based. To force invalidation:

1. **Edit any cached block** (`prompts/_assembled/verify-*.md`, `config/knowledge-base.md`, `config/migration-rules.md`). Next call starts a fresh prefix.
2. **Reorder the blocks**. The SDK wrapper puts system blocks in a fixed order; swapping any pair forces a new prefix.
3. **Wait 5 minutes between calls.** Ephemeral cache TTL is 5 min sliding from last access. (1 h cache tier is available on the Anthropic API but not used here — flip-flop between verify-sdet and verify-code-review naturally keeps the ephemeral cache warm.)

## Rollout plan (post-PoC)

This PR wires `claude-cached-call.ts` only as an **opt-in via env flag** on `verify.yml`. Workflows that haven't opted in continue to call `claude --print` exactly as before — zero behavioural change.

Opt-in path on the `verify-subagent` job in `verify.yml`:

```yaml
env:
  USE_CACHED_SDK: '1'   # set per-step or as a repo-level Variable
```

When set, the workflow step calls `tsx scripts/claude-cached-call.ts …` instead of `claude --print …`. The script writes the report + usage in the same paths the legacy CLI uses, so all downstream steps (secret scan, persist-verify-metrics, PR-comment, tally) work unchanged.

### Sequencing (follow-up PRs)

1. **This PR**: verify.yml feature-flag (default off). Verify wrapper works against a real Opus call when `USE_CACHED_SDK=1` is set + `ANTHROPIC_API_KEY` is present.
2. **PR 2**: Once we observe cache_read_tokens > 0 on a few real runs (via `npm run cache:report`), flip the flag to default-on in `verify.yml`. Keep the CLI path under `USE_CACHED_SDK=0` as the rollback.
3. **PR 3**: Extend `claude-cached-call.ts` to support a Read/Write/Edit tool loop, then add a `migrate` mode and feature-flag it in `migrate.yml`. Stage 2 is the highest-cost stage — the savings dominate here.
4. **PR 4**: Same treatment for `plan.yml` (Stage 1 is smaller but runs on every push, so steady-state savings still matter).

## Known limitations

- **OAuth tokens are NOT supported.** The raw SDK only accepts `ANTHROPIC_API_KEY` (sk-ant-api…). `CLAUDE_CODE_OAUTH_TOKEN` (sk-ant-oat…) is a CLI-only auth mode. `verify.yml`'s POC step detects the token prefix and falls back to the legacy CLI call when only OAuth is available — no behavioural regression, just no caching gains in that mode.
- **Tool loop not implemented yet.** The SDK wrapper inlines all required reading into the user message. Verify's required reading list is small (5 files) and fixed by the prompt — fine for this stage. Plan + migrate need actual Read/Write tool definitions because they emit multi-file outputs; that's the PR 3 work.
- **5-minute window only.** This PoC uses the ephemeral tier. The 1 h tier is more expensive to write but pays back on workflows that re-run hours apart (e.g. nightly regression). Not worth the complexity until we see Anthropic's pricing settle.
