# Output profiles (ADR 0002)

A profile selects the **shape** of the migrated output. The default is
`pwm-blueprint`; `lean` is an opt-in for adopters who want a simpler tree.

| | `pwm-blueprint` (default) | `lean` |
| --- | --- | --- |
| Spec import source | `@fixtures/base.fixture` | `@playwright/test` (allowed) |
| Fixture barrel (`base.fixture`) | required | not required |
| Page objects | `extends BasePage`, no own constructor, `.describe()` locators, `[LABEL]` expect messages | plain class, own constructor, plain locators |
| `page.goto()` in a spec | forbidden (Page owns navigation) | allowed |
| Imports between layers | path aliases (`@page-object`, `@fixtures`, …) | relative paths (`../…`) allowed |
| api / actions / utilities / test-data / types layers | emitted as the plan declares | not required |
| Smell rules (no hard waits, no `.nth()`, no force clicks, web-first asserts) | **enforced** | **enforced** (lean still gets quality) |

`lean` relaxes only the **architecture** rules — the quality rules
(`eslint-plugin-playwright`: no-wait-for-timeout, no-nth-methods, no-force-option,
web-first assertions, no-floating-promises) apply to both profiles.

## How to use

Local Stage-2 CLI:

```bash
npm run migrate -- --input inputs/<framework>/your-test.spec.ts --profile lean
```

The CLI threads `--profile lean` to the conformance gate, sets `PWM_PROFILE=lean`
so the ESLint step relaxes the same rules, and selects the lean generate prompt
(`prompts/generate.lean.md` → `_assembled/generate.lean.md`) — a spec + page
object contract that drops the pwm-blueprint triad/STOP block while keeping the
shared quality fragments (no waits/nth/force, web-first, locator priority). The
default (no `--profile`) is `pwm-blueprint`, byte-identical to before.

## How it's wired (single source)

- `config/profiles/{pwm-blueprint,lean}.json` — declarative descriptors.
- `scripts/validate-pwm-blueprint-conformance.ts --profile lean` — relaxes the
  spec import-source rule (Check 1), `page.goto`-in-spec (Check 7), and the
  relative-import rules (Check 5 + sibling).
- `eslint.config.js` reads `PWM_PROFILE`; under `lean` the matching
  `no-restricted-imports` (@playwright/test) + `no-restricted-syntax` (page.goto)
  rules are turned off.
- Regression guard: `scripts/lean-profile.test.ts` proves a lean spec (and a
  realistic spec + page object) passes under `lean` while staying blocked under
  `pwm-blueprint`.

## Status

Phase 1 + the cross-validator relaxations + the lean generate prompt are
implemented and guarded for the **local CLI** (`buildPrompt` selects
`generate.lean.md`; `migrate-local.test.ts` pins the profile branching and the
no-pwm-blueprint-leak invariant). Not yet wired into the CI pipeline (`migrate.yml`
always runs `pwm-blueprint`) — CI lean still needs per-profile calibration fixtures
and a real supervised lean migration to verify output quality (Phase 2). See
`docs/adr/0002-output-profiles.md`.
