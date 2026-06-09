#!/usr/bin/env tsx
/**
 * extract-claude-usage.ts — extract Claude CLI usage stats from `--output-format json`.
 *
 * The claude-code CLI's `--output-format json` mode emits a JSON object like:
 *   {
 *     "result": "…",
 *     "usage": {
 *       "input_tokens": N,
 *       "output_tokens": N,
 *       "cache_creation_input_tokens": N,
 *       "cache_read_input_tokens": N
 *     },
 *     "model": "claude-sonnet-4-6@…"
 *   }
 *
 * This script reads stdin OR a `--from <file>` JSON document and writes a
 * normalised UsageStats JSON to stdout, ready for persist-*-metrics.ts:
 *   { "model": "…", "input_tokens": N, "output_tokens": N,
 *     "cache_read_tokens": N, "cache_creation_tokens": N }
 *
 * Workflow wiring:
 *   claude --model … --output-format json … > /tmp/claude.json
 *   tsx scripts/extract-claude-usage.ts --from /tmp/claude.json \
 *     > outputs/.usage/<basename>.json
 *
 * Exit codes:
 *   0 = wrote a usage JSON file (or stdout payload)
 *   1 = could not locate `usage` / `model` in the input — print warning + exit 0 if
 *       --tolerant is set, so workflow steps don't fail on legacy text output.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

interface ClaudeOutput {
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface NormalisedUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
}

function readSource(from: string | undefined): string {
  if (from && from.length > 0) return readFileSync(from, "utf8");
  // Read stdin (sync)
  return readFileSync(0, "utf8");
}

function normalise(raw: ClaudeOutput): NormalisedUsage | null {
  const u = raw.usage;
  const model = raw.model;
  if (!u || typeof model !== "string" || model.length === 0) return null;
  const input = u.input_tokens;
  const output = u.output_tokens;
  if (typeof input !== "number" || typeof output !== "number") return null;
  const out: NormalisedUsage = {
    model,
    input_tokens: input,
    output_tokens: output,
  };
  if (typeof u.cache_read_input_tokens === "number") {
    out.cache_read_tokens = u.cache_read_input_tokens;
  }
  if (typeof u.cache_creation_input_tokens === "number") {
    out.cache_creation_tokens = u.cache_creation_input_tokens;
  }
  return out;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      from: { type: "string" },
      out: { type: "string" },
      tolerant: { type: "boolean", default: false },
    },
  });

  const raw = readSource(values.from);
  let parsed: ClaudeOutput;
  try {
    parsed = JSON.parse(raw) as ClaudeOutput;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (values.tolerant) {
      process.stderr.write(`::warning::extract-claude-usage: input is not JSON (${msg}); skipping\n`);
      process.exit(0);
    }
    process.stderr.write(`::error::extract-claude-usage: input is not JSON (${msg})\n`);
    process.exit(1);
  }

  const usage = normalise(parsed);
  if (!usage) {
    if (values.tolerant) {
      process.stderr.write("::warning::extract-claude-usage: no usage/model fields in input; skipping\n");
      process.exit(0);
    }
    process.stderr.write("::error::extract-claude-usage: input lacks usage/model fields\n");
    process.exit(1);
  }

  const payload = JSON.stringify(usage, null, 2);
  if (values.out && values.out.length > 0) {
    mkdirSync(dirname(values.out), { recursive: true });
    writeFileSync(values.out, payload);
    process.stderr.write(`extract-claude-usage: wrote ${values.out} (model=${usage.model}, in=${usage.input_tokens}, out=${usage.output_tokens})\n`);
  } else {
    process.stdout.write(payload + "\n");
  }
}

main();
