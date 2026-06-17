# `.claude/` structure migration — deferred plan

> Captured 2026-06-17 during the cross-framework migration push. Defer the
> structural refactor until after the migration core is stable (post-N=20 +
> all 4 frameworks landing confidence:high consistently). At that point we'll
> know exactly which skills, hooks, and rules are worth encoding rather than
> guessing pre-emptively.

## Current state (2026-06-17)

PWmodernizer has 2 of 8 canonical Claude Code components:

- ✅ `CLAUDE.md` (root, ~100 lines, project orientation)
- ✅ `.claude/settings.local.json`

Missing:

- ❌ `CLAUDE.local.md` — per-user overrides (gitignored)
- ❌ `.mcp.json` — MCP integrations (GitHub, Slack, Postman)
- ❌ `.claude/rules/` — modular path-scoped rules
- ❌ `.claude/skills/` — auto-triggered lazy-loaded skills (NEW: supersedes `.claude/commands/`)
- ❌ `.claude/agents/` — sub-agent profiles (currently inline in verify.yml)
- ❌ `.claude/hooks/` — pre/post tool hooks

The heavy lifting happens in `.github/workflows/` (11 workflows, ~4000 LOC). Local Claude Code interactions are ad-hoc. As the project grows past v1.0, encoding invariants in `.claude/` saves repeated re-explanation.

## Research findings (2026-06-17 agent run)

Per the canonical Anthropic docs at code.claude.com/docs/en/*:

- `.claude/commands/` is **legacy**. `.claude/skills/<name>/SKILL.md` supersedes it.
- `.claude/hooks/` is **not a canonical directory**. Hooks are configured in `settings.json` under a `"hooks"` key; the shell scripts they invoke conventionally live under `${CLAUDE_PROJECT_DIR}/.claude/hooks/*.sh`.
- `.claude/rules/*.md` supports YAML `paths:` frontmatter for glob-matched path-scoped loading — most underused feature.
- Auto memory at `~/.claude/projects/<project>/memory/MEMORY.md` (v2.1.59+, self-written).
- `AGENTS.md` interop pattern (`@AGENTS.md` import inside `CLAUDE.md`).

## Ranked leverage for PWmodernizer

1. **`.claude/skills/`** — encode `/regenerate`, `/kb-bump`, `/run-phase`, `/migrate-input` as auto-triggered skills with `description:` so Claude fires them on intent. Replaces ad-hoc procedures currently spread across `CLAUDE.md` + `prompts/`.
2. **`.claude/hooks/` (PreToolUse)** — block `git commit` with `Co-Authored-By: Claude` attribution or wrong email (CLAUDE.md rule today, often missed). Enforce kebab-case KB IDs on `Write` tool.
3. **`.claude/rules/` with `paths:`** — `paths: ["scripts/**/*.ts"]` for AST-diff invariants; `paths: ["config/knowledge-base.md"]` for KB ID format. Loads only when relevant — saves context.
4. **`.claude/agents/`** — extract `verify-sdet.md` and `verify-code-review.md` from `prompts/` into `.claude/agents/`-style profiles with restricted tool lists. Aligns with phase order.
5. **`.mcp.json`** — pin GitHub MCP (already used) and any Postman / Slack integrations the team wants.
6. **`CLAUDE.md` cleanup** — keep < 200 lines, root facts only (phase order, do-not-do list). Push details into `.claude/rules/` or skills.

Lowest leverage: `.claude/commands/` (deprecated; use skills).

## Estimated cost

| Component | Files | LOC | Effort |
|---|---|---|---|
| `.claude/skills/` | 3-5 skills | ~300 | medium |
| `.claude/hooks/` | 2-3 sh scripts | ~100 | low |
| `.claude/rules/` | 4-5 md (path-scoped) | ~500 | medium |
| `.claude/agents/` | 2-3 agent profiles | ~240 | medium |
| `.mcp.json` | 1 config | ~30 | low |
| `CLAUDE.md` cleanup | refactor | -100 | low |

- **Session tokens:** ~15-20k for the one-shot restructure
- **Anthropic API:** $0 — pure infra work, no Sonnet/Opus calls
- **Long-term:** **saves tokens** via lazy-loaded skills + path-scoped rules

## When to do this

Trigger criteria — wait until ALL of:

- [ ] Cross-framework Stage 2 SUCCESS proven N=20 (currently N=14)
- [ ] Confidence:high rate ≥ 80% across all 4 frameworks (currently 79%)
- [ ] All known validator scope drifts closed (handful left)
- [ ] At least 1 operator other than the original author has run the pipeline end-to-end (validates that the heavy CLAUDE.md is actually being read)

Once those gates pass, we know what's stable enough to encode. Until then, ad-hoc CLAUDE.md updates are the right tradeoff.

## How to start when ready

1. Branch: `feat/claude-code-structure-adopt`
2. First skill: `/regenerate` — wraps the existing repository_dispatch flow with a higher-level intent. Should be a 5-line trigger that asks for input path + feedback string.
3. First hook: `commit-attribution-block` — `PreToolUse` matcher on `Bash` for `git commit`. Rejects `Co-Authored-By: Claude` + non-`juraj.kapusansky@gmail.com` email. Idempotent if not committing.
4. First rule with `paths:`: `kb-format.md` scoped to `paths: ["config/knowledge-base.md"]` with the kebab-case ID rule + section ordering. Loads only when editing the KB.
5. Move two verify lens prompts (`prompts/verify-sdet.md`, `prompts/verify-code-review.md`) into `.claude/agents/`-style files with `tools:` restrictions matching what verify.yml grants today.
6. Shrink `CLAUDE.md` from ~100 lines to ~50 — root facts only, push details into rules/skills.

## References

- [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)
- [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)
- [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents)
- [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)
- [code.claude.com/docs/en/settings](https://code.claude.com/docs/en/settings)
