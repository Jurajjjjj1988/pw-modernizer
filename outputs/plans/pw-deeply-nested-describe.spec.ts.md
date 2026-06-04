# Migration plan: pw-deeply-nested-describe.spec.ts

## Source framework

bad-playwright — subtractive migration, no framework translation required.

The source uses `import { test, expect } from '@playwright/test'` and Playwright-native APIs throughout. No framework translation is needed. The sole structural problem is 8-level `test.describe` nesting, which violates `migration-rules.md` §2 (maximum two levels). One magic string also needs promotion to a named constant. All three distinct locators already use the canonical role/label hierarchy and carry over without replacement.

## Summary

The file tests the display name editor on the Acme app's profile settings page (`/account/settings/profile`). Two complementary scenarios guard the Save button's enabled/disabled gating: the button must be disabled when the display name input is empty and enabled once the input contains text. This ensures users cannot submit a blank display name and are not incorrectly prevented from saving a valid one.

### What bug does this catch?

Catches a regression where the display name editor's Save button fails to gate on input presence — allowing a blank display name to be submitted, or blocking a user who has typed a valid name from saving it.

### User-perceivable assertion checklist

- [ ] After entering edit mode and clearing the display name input: Save button is disabled
- [ ] After entering edit mode and typing a non-empty display name ("Jane Doe"): Save button is enabled

## Anti-patterns detected

| Severity | Line | KB-ID | Anti-pattern | Snippet (≤60 chars) | Replacement |
|---|---|---|---|---|---|
| M | 8–35 | KB-1.1.15 | excessive `test.describe` nesting (8 levels) | `test.describe('Acme app', () => { …` | Collapse to ≤2 levels; fold path context into describe/test names |
| L | 25 | KB-1.1.9 | magic string as test data | `.fill('Jane Doe')` | Extract `const SAMPLE_DISPLAY_NAME = 'Jane Doe'` at module scope |

### Unclassified smells

None.

## Locator translation table

*Subtractive migration — all locators are already on the canonical role/label hierarchy. Only the potentially-ambiguous Save button warrants a note.*

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.getByRole('button', { name: /edit display name/i })` | keep as-is | high | Specific text; unlikely to collide with other buttons on the page |
| `page.getByLabel(/display name/i)` | keep as-is | high | Label-based match; unambiguous on a profile settings page |
| `page.getByRole('button', { name: /save/i })` | keep as-is — consider `{ name: /^save$/i }` | med | Profile page may render Save buttons for multiple sections simultaneously; `/save/i` could match an unrelated one. See Q1. |

## Hallucination-defense pins

1. **Display name editor Save button** — assumed `page.getByRole('button', { name: /save/i })`. If DOM has multiple Save buttons visible at once: keep `page.getByRole('button', { name: /save/i })` but scope it inside the display-name section container, and add WHY-comment `'Q1 unresolved: /save/i may match sibling-section Save buttons'`. Reviewer fallback: ask the frontend team to add `data-testid="display-name-save"` and use `page.getByTestId('display-name-save')` instead.

## Structural changes

- **Extract POM:** no — 35 source LOC, single page, single feature. Well below the 200-LOC threshold in `migration-rules.md` §1. Inline locators are cleaner at this scale; a POM here would be gold-plating.
- **Extract fixture:** no — setup is a 2-line preamble (`page.goto` + click edit button). Moves into `test.beforeEach` per the ≤3-line guidance in `migration-rules.md` §2. No fixture file needed.
- **Extract `beforeEach`:** yes — both tests share the identical 2-line entry sequence (`page.goto('/account/settings/profile')` + click "Edit display name"). Stage 2 must move these to `test.beforeEach`, leaving each test body as a single `fill` + `expect`.
- **Collapse nesting:** yes — the 8-level stack violates `migration-rules.md` §2 ("maximum two levels of `test.describe` per file"). Proposed target structure: outer `test.describe('profile settings', ...)` providing page context; inner `test.describe('display name editor', ...)` providing feature context; tests flat inside. No file split is needed — both tests belong together.
- **Rename tests:** yes — current titles start with a noun ("save disabled…"), not a present-tense verb. Per `migration-rules.md` §2: proposed titles are `disables Save when display name is empty @edge` and `enables Save when display name is non-empty @positive`.
- **Promote magic string:** yes — `'Jane Doe'` on line 25 → `const SAMPLE_DISPLAY_NAME = 'Jane Doe'` declared at module scope, per KB-1.1.9.
- **Drop calibration comment:** yes — lines 3–6 are calibration-harness metadata ("Stage 0 stress fixture…"), not application intent. Stage 2 replaces them with the standard migration attribution line.
- **Split into multiple specs:** no — both tests cover the same feature and page; keeping them together is correct.

## Open questions for reviewer

```
Q1: Does /account/settings/profile render multiple "Save" buttons simultaneously?
Context: Both tests use page.getByRole('button', { name: /save/i }) without scoping.
Profile settings pages commonly display Save buttons for separate sections (avatar,
bio, notifications) at the same time — especially during edit mode.
What I assumed: only one Save button is visible when the display name editor is in
edit mode.
Impact if wrong: assertions target the wrong Save button; tests can pass or fail for
the wrong reason without surfacing the real regression.
```

```
Q2: Is the Save button disabled by default on page load, or only disabled after the
user actively clears a pre-populated display name?
Context: Test 1 enters edit mode then fills with '' — this asserts toBeDisabled.
If the Save button starts disabled before any user interaction (e.g., editor opens
with empty state), the test is a tautology.
What I assumed: the editor opens pre-populated with the current display name, so
fill('') clears an existing value and triggers the disabled state.
Impact if wrong: test 1 always passes regardless of application logic; no regression
signal.
```

```
Q3: After clicking the "Edit display name" button, is the display name input
immediately available, or does a transition animation need to settle first?
Context: Tests click the edit button then immediately call fill(). If the input is
inside a slide-in panel or modal, the auto-wait on fill() should cover it — but only
if the input is in the DOM and receiving pointer events.
What I assumed: the transition is purely CSS and the input is interactable
immediately after the click auto-wait resolves.
Impact if wrong: fill() may race the transition on slow CI; Stage 2 should add
await expect(page.getByLabel(/display name/i)).toBeVisible() before the fill call.
```

```
Q4: Should the describe hierarchy retain any of the 8-level path context for CI
reporting purposes?
Context: The current nesting encodes the full module path: "Acme app > Settings
module > Profile section > Display name editor > Edit mode > Validation states >
Empty input > Save button states". Some teams use the describe path as a grouping
signal in CI dashboards.
What I assumed: collapsing to 2 levels ('profile settings' > 'display name editor')
is acceptable and the contextual path can be absorbed into test titles.
Impact if wrong: CI reporter loses granularity; the team may want 'Settings module'
or 'Profile section' preserved as an outer describe label.
```

```
Q5: Should test 1 pre-fill the display name before clearing it to simulate the
real user workflow?
Context: A real user clearing their display name would start from a pre-populated
value, not an already-empty field. Testing the empty-to-empty transition may not
exercise the state machine that prevents blank saves.
What I assumed: fill('') is sufficient to prove the disabled state regardless of
prior content.
Impact if wrong: the test misses the "user deletes existing name" regression path.
Consider adding fill(SAMPLE_DISPLAY_NAME) followed by fill('') in test 1 to cover
the real workflow.
```

## Risk callouts

- **`/save/i` ambiguity**: If the profile page renders Save buttons for multiple sections while in display-name edit mode, `getByRole('button', { name: /save/i })` matches the first one in DOM order — potentially the wrong button. The test passes without surfacing the real regression. This is a silent-wrong-element risk, not a loud assertion failure.
- **Tautology risk (test 1)**: If the Save button is disabled before any user input (editor opens with empty field), `toBeDisabled()` after `fill('')` trivially passes. See Q2.
- **Authentication prerequisite**: Both tests navigate directly to `/account/settings/profile`. If `playwright.config.ts` does not configure `storageState` with an authenticated session, the tests will land on a login redirect and fail with a misleading "element not found" error. This is out of scope for this migration but must be confirmed.
- **Save button state change timing**: If the display name field uses a debounced validation handler, `toBeDisabled()` after `fill('')` relies on the web-first polling to catch the eventual disabled state. The default `actionTimeout` (5 s) should be sufficient, but if validation involves an async API call (e.g., unique-name check), the timeout may need raising.

## Expected metrics

- Selector quality score (estimated): 1.0 (3/3 locators are already role/label — no degradation)
- Smell count delta vs source: −2 (1 deep-nesting collapse, 1 magic string promotion)
- New test file LOC estimate: ~22 (source 35 → target ~22; nesting removal is the primary driver)
- Anti-pattern coverage: 2/2
