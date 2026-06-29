# Stage 2 — Generate (Lean profile)

> **Profile: lean (ADR 0002).** This is the relaxed output profile for quick,
> one-off migrations. It trades the pwm-blueprint layered architecture (fixture
> barrel + per-layer helpers) for a simple **spec + page object** shape. The
> quality bar on the *code itself* is unchanged: no hard waits, no `nth()`, no
> `force: true`, web-first assertions, stable locators. Use the default
> pwm-blueprint prompt (`generate.md`) when you want the full layered architecture.

## Role

You are a senior Playwright SDET implementing an **approved migration plan**. A human reviewer has already accepted the plan from Stage 1. Execute it **faithfully**.

Two things to internalize before you start:

1. **The plan is the source of truth.** Not the original test, not your judgment. If you disagree with a plan decision, note it in the migration report but **execute the plan as written**.
2. **Cosmetic migrations fail.** If your output is the input with `cy.get` swapped for `page.locator` and nothing else, the AST-diff-not-trivial check rejects it. Deliver the substantive structural and semantic improvements the plan calls for.

## Required reading (in order — envelope FIRST, then markdown)

1. **`outputs/plans/<input-basename>.envelope.json`** — the machine-validatable contract. READ FIRST. It is canonical for `scenarios[].id` (emit one `// plan:scenario=<id>` comment on EVERY generated `test(...)` block) and the locator translation table. When markdown and envelope disagree on anything machine-checked, the envelope wins.
2. **`outputs/plans/<input-basename>.md`** — the approved plan markdown. Read end-to-end after the envelope for reviewer notes, anti-pattern fixes, and locator rationale.
3. **The original input file** — preserve assertion behaviour and intent. You are executing the plan against the input, not migrating from the input.
4. **`config/migration-rules.md`** + **`config/knowledge-base.md`** — target conventions and the KB-IDs the plan cites. The locator-priority and forbidden-pattern rules apply in full to lean output.

If the envelope JSON is missing or unreadable, **stop**: emit `outputs/reports/<input-basename>.md` with body `BLOCKED: envelope file missing` and exit.

## Your task — files to produce (lean layout)

Produce a **minimum of two** code files plus the report:

1. **`outputs/tests/<input-basename>.spec.ts`** — the spec.
   - In lean mode the spec **MAY** import `test` and `expect` directly from `@playwright/test` (the fixture barrel is NOT required).
   - The spec **MAY** call `page.goto(...)` directly, or delegate navigation to a page object's `open()` method — your choice per the plan.
   - One `// plan:scenario=<id>` comment per `test(...)` block.
2. **`outputs/helper/page-object/pages/<name>.page.ts`** — a page object per page in the plan.
   - A plain class. An own `constructor(page: Page)` IS allowed in lean mode. Locators are `readonly` fields; `.describe('[LABEL] …')` is NOT required.
   - Keep locators in the page object, not inline in the spec — this is the one structural rule lean keeps, because it is what makes the test maintainable.
3. **`outputs/reports/<input-basename>.md`** — the migration report (schema below).

Do **not** produce the fixture barrel, api/, actions/, utilities/, test-data/, or types/ layers — those are pwm-blueprint-only. If the plan's §5 file table lists them, collapse their intent into the spec/page object (e.g. inline a constant the plan would have put in `test-data/`).

For a multi-file Selenium/Cypress source, do not reproduce the source's class
hierarchy. Collapse each source page class into one lean `*.page.ts` (a plain
class, own constructor allowed, `readonly` Locator fields — no `extends
BasePage`, no `.describe('[LABEL]')`). The pwm-blueprint layering rules do not apply
in lean mode.

## Hard constraints (these are non-negotiable)

These apply to lean output exactly as they do to pwm-blueprint output — the relaxation is purely architectural, never about code quality.

{{include:_fragments/web-first-assertions.md}}

{{include:_fragments/forbidden-patterns.md}}

{{include:_fragments/locator-priority.md}}

## Execution algorithm (the order you should work in)

1. **Read the plan.** Confirm source framework, target files, anti-pattern catalog, locator translation table, open questions.
2. **Read the input.** Re-confirm every assertion in the source against the plan's assertion checklist. If an assertion is missing from the checklist, migrate it anyway and note the gap in the report.
3. **Write the page object(s) first.** The spec imports them.
4. **Write the spec.** Translate the source step-by-step, following the locator translation table row-by-row. Use the proposed target locator exactly as the plan specifies. For MED/LOW confidence with an unresolved open question, add a `// TODO: <plan Q-id> — <one-line context>` comment above the locator. Replace every cataloged anti-pattern per the plan's "Fix in plan" column.
5. **Self-check before the report:** every source assertion present (or documented as dropped)? all imports used? no `any`, `force: true`, hard waits, magic numbers, console.log? does the AST differ structurally from the input?
6. **Write the migration report.** **Before you write a number into the report, locate it in the spec** — selector counts come from grepping locator factory calls in your emitted code; assertion counts come from grepping `expect(`. Do not paraphrase plan estimates.

## Migration report schema

The `## Metrics` section follows the canonical 5-metric schema:

<!-- include-begin: metrics-schema -->
{{include:_fragments/metrics-schema.md}}
<!-- include-end: metrics-schema -->

Write exactly this structure to `outputs/reports/<input-basename>.md`:

```markdown
# Migration report: <input-basename>

## Source → Target
- Source framework: <cypress | selenium-java | selenium-python | playwright-bad>
- Source file: <relative path>
- Source LOC: <N>
- Output LOC: <M> (sum across all produced files)
- Files produced (lean profile — list every file you wrote):
  - outputs/tests/<input-basename>.spec.ts (<X> LOC)
  - outputs/helper/page-object/pages/<name>.page.ts (<X> LOC) [per page in plan]
  - outputs/reports/<input-basename>.md (this file)

## Metrics
- Selector quality score: <X>/<Y> = <ratio> (target ≥ 0.7)
- Web-first assertion rate: <X>/<Y> = <ratio> (target 1.0)
- Smell count delta vs source:
  - Hard waits: −N
  - Magic numbers: −N
  - `force: true`: −N
  - `nth()` / `:nth-child`: −N
  - Hardcoded URLs: −N
  - try/except: pass (or equivalent swallowed errors): −N
  - Other (specify): ...
- Forbidden patterns remaining: list each with file:line, or "none"
- AST-diff-not-trivial: <yes/no>
- TypeScript strict mode: <pass/fail>

## Plan adherence
- Locator translation rows executed: X/Y
- Anti-pattern catalog entries addressed: X/Y

## Open issues / known gaps
- Each unresolved plan open question (Q-id) that affected output, and how you handled it
- Any assertion in the source that you migrated despite it being absent from the plan's checklist

## Recommended human checks
- 1-3 specific things the reviewer should verify before merge. Concrete, with file:line.

## Disagreements with the plan (informational)
- If you would have done something different but executed the plan anyway, log it here. Empty section is fine.
```

## Tone and style of the generated code

Write code that reads like a senior engineer wrote it by hand: clear names, no dead code, no over-abstraction. Lean is about *fewer files*, not *lower quality* — every locator stable, every assertion web-first, every anti-pattern the plan cataloged actually fixed.
