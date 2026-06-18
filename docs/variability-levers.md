# Reducing Sonnet output variability — which levers apply (research note)

> **TL;DR.** Run-to-run Sonnet variability is the last big quality slack (see
> `ROADMAP.md` + `docs/adr/0001-self-improvement-rag.md`). The obvious lever from
> the literature — **lower `temperature` / `top_p`** for code generation — does
> **not** apply to this pipeline. The pipeline calls the **Claude Code CLI**, which
> does not expose sampling parameters, and the model family the pipeline targets
> deprecates/removes them anyway. The real levers here are **`effort`** (already
> high) and **retrieval grounding (ADR 0001)**. This note records the negative
> result so nobody re-investigates temperature.

## What the literature says

For code generation, the consensus (2025–2026) is **temperature 0.0–0.2 + a single
of {temperature, top_p}, not both** to cut run-to-run variance. Temperature 0 is
not a determinism *guarantee* — reproducibility is best-effort — but lower
temperature measurably tightens the output distribution.

## Why it doesn't apply to PWmodernizer

1. **The pipeline does not call the Messages API.** Stages 1–2 invoke the **Claude
   Code CLI** (`@anthropic-ai/claude-code`) as an agentic tool-loop:

   ```
   claude --model claude-sonnet-4-6 --max-turns 50 --print \
          --permission-mode acceptEdits "$PROMPT"
   ```

   `temperature` / `top_p` / `top_k` are **Messages-API request parameters**. The
   Claude Code CLI's documented flags (`--model`, `--max-turns`, `--print`,
   `--output-format`, `--permission-mode`) do **not** include a sampling knob —
   there is nothing to set on this invocation path.

2. **The model family deprecates sampling params.** On the Opus 4.7/4.8 and Fable 5
   family, `temperature`/`top_p`/`top_k` are **removed and return HTTP 400**; on the
   4.6 family they are deprecated. Anthropic's guidance is to control determinism
   via the **`effort`** parameter (`low`/`medium`/`high`/`xhigh`/`max`) and via
   prompting — not sampling. Claude Code already runs at a high effort default.

   (Authoritative source: the bundled `claude-api` skill — "Thinking & Effort" +
   the error-codes table. Sampling params 400 on Opus 4.7/4.8/Fable 5.)

## What this leaves

| Lever | Status for this pipeline |
| --- | --- |
| Lower temperature / top_p | **Not available** (no CLI knob; deprecated/removed on the model family) |
| `effort` | Already high (Claude Code default); not a per-stage knob on the current CLI invocation |
| **Retrieval grounding (RAG)** | **The real lever — see ADR 0001.** Feed K most-similar past SHIP-IT plans into Stage 1 to lower variance. Already partially built (`scripts/retrieval-bm25.ts`, `rag-map3-evaluator.ts`, `index-plans.ts`); gated behind `STAGE1_RAG`. |
| Validator wall + verify | Already in place — variance that survives is **blocked**, not shipped. The pipeline is correct-or-blocked today; RAG is about raising the first-attempt SHIP-IT *rate*, not correctness. |

## Recommendation

Do **not** spend effort trying to set `temperature` on the Claude Code path. The
variability investment is **ADR 0001 (RAG)**, measured against the calibration
corpus per that ADR's exit gate. If the pipeline ever moves Stage 1/2 from the
Claude Code CLI to a **direct Messages-API SDK call** (the local CLI's generate
step, or a future SDK rewrite), `effort` becomes a tunable per-stage knob at that
point — but sampling params still won't be, on the current model family.
