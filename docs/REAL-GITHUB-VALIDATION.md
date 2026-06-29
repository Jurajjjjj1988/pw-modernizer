# Closed-loop validation against REAL GitHub tests

> The synthetic corpus (fake apps like `shop.acme.test`) hid the defects below —
> live grounding + execution can't run against an app that doesn't exist. Pulling
> REAL tests off GitHub and running the full closed loop (`ground → generate →
> RUN vs the live app → repair → accept only when green`) surfaced them within
> the first two tests. Each became a concrete, committed fix — not a vague
> "it's flaky".

## The tests (real, off GitHub, against public SUTs)

| # | Source repo (provenance) | Source FW | SUT | Notable difficulty |
|---|---|---|---|---|
| 1 | `hardyyudha/Cypress_SauceDemo` → `add_cart.cy.js` | Cypress | saucedemo.com | data-driven via `Cypress.env('cart_data')`; chained `.parent().parent().find()` traversal; requires login |
| 2 | `Cryzalis/cypress-the-internet.herokuapp.com` → `login.cy.js` | Cypress | the-internet.herokuapp.com | 3 scenarios incl. **negative-path** flash-message assertions; `before()`-once vs PW per-test isolation |
| 3 | `aecioprado/automacao-selenium-saucedemo-java` → `LoginPageTests.java` | Selenium/JUnit (Java) | saucedemo.com | cross-framework; selectors live in a separate `LoginPage.java` → grounding must fill them |

## Defects the validation surfaced → fixes

### IMP8 — repair was blind to the page it failed on
The repair loop re-snapshotted the **base URL** for grounding, which only ever
shows the login/landing page. When a test failed *deeper* (e.g. a locator on the
post-login inventory page), the repair model never saw the page the broken
locator ran against, so it kept guessing (3 wasted iterations on test #1).
**Fix:** feed Playwright's own `error-context.md` — the aria tree captured *at
the moment of failure* (the exact, already-authenticated page) — into the repair
prompt; fall back to a base-URL snap only when there's no page (a setup-time
failure). `extractPageSnapshot` / `findFailureSnapshot` / `selectRepairSnapshot`,
6 unit tests.

### IMP9 — migrated auth was not self-contained
Test #1's migration emitted an `authenticated.fixture` with
`storageState: 'playwright/.auth/saucedemo.json'` — the idiomatic Playwright
pre-baked-auth pattern — but **nothing in the pipeline creates that file**, so
every test died at setup (ENOENT) before a page loaded. It COMPILED and passed
every static gate. The repair loop couldn't fix it: it edits locators, and it
never saw the SOURCE test (which logs in inline in `beforeEach`).
**Fix:** (a) give the repair loop the `--source` test as the intent reference;
(b) `isAuthBootstrapFailure()` detects the storageState/ENOENT class and adds a
directive to make auth self-contained — preferred: inline `beforeEach` login
from the source's steps via a LoginPage, env creds with an unattended fallback.
**Result:** test #1 reached GREEN in 1 repair iteration (the repair converted the
dangling `storageState` fixture to inline login; the execution gate independently
confirmed `github-saucedemo-cart.spec.ts runs GREEN against saucedemo.com`).
Plus a durable **prevent-layer**: `validate-auth-self-contained.ts` fails a tree
that references a `storageState` file with no producer — deterministically, at
zero token cost, before the live gate (7 unit tests; wired into the wall).

### IMP10 — the repair loop could repair (and corrupt) the WRONG file
Test #2's spec was free-named `internet-login.spec.ts` by the model (input was
`github-internet-login.cy.js`). `findGeneratedSpec` had no kebab-name match, so it
fell back to the **lexically-first** spec — `force-clicks.spec.ts`, an unrelated
**committed example** — and the repair loop edited + overwrote *that*, reporting a
**misattributed green** while the real spec stayed red.
**Fix:** resolve by the **plan-provenance header** every spec carries
(`// See outputs/plans/<input>.md`), which ties a spec to its migration
regardless of filename; and when nothing matches across multiple specs, return
`null` (refuse to guess) instead of corrupting an arbitrary file. The corrupted
example was restored from git. 7 unit tests incl. the exact reproduction.

## Results

| # | Genuine GREEN on the correctly-resolved spec? | Repair iterations | Notes |
|---|---|---|---|
| 1 | ✅ yes — execution gate confirmed (`github-saucedemo-cart.spec.ts`) | 1 | data-driven cart + inline-login auth fix |
| 2 | ✅ yes — execution gate confirmed (`internet-login.spec.ts`) after the IMP10 fix | 1 | first migrate run's "green" was the IMP10 false-green on force-clicks; the fix made the repair edit the correct file, green via IMP8's failure-time snapshot |
| 3 | ✅ yes — execution gate confirmed (`github-login-page-tests.spec.ts`) | 0 (correct first-try) | **cross-framework** Selenium/Java → Playwright TS; grounding filled the selectors that lived in a separate `LoginPage.java`; the auth-self-contained gate passed |
| 4 | ✅ yes — execution gate confirmed (`github-internet-add-remove.spec.ts`) | 0 (correct first-try) | the-internet add/remove: Cypress `before()` SHARED state across 3 tests → the migration correctly made each PW test self-contained (re-establishes state), and handled the dynamically-added delete buttons (absent from the initial snapshot) with a `count()>0` control-flow loop |
| 5 | ✅ yes — execution gate confirmed (`github-internet-checkbox.spec.ts`) | 0 (correct first-try) | the-internet checkboxes: toggle an unchecked box → assert checked |

**5 / 5 real GitHub tests reach a genuine, gate-confirmed GREEN on the correctly-resolved spec.** Across 2 source frameworks (Cypress, Selenium/JUnit-Java) and 2 public SUTs (saucedemo.com, the-internet.herokuapp.com). 3 of 5 needed **zero** repair (the grounded generate + static wall produced a working migration first-try); 2 needed exactly one execution-guided repair iteration. No committed example was corrupted (IMP10 holding).

## Honest status

The closed-loop *machinery* is materially stronger: IMP8/9/10 + the auth gate each
closed a real hole the synthetic corpus hid, and every one was found by running a
real test against a real app — not by reading code. The headline metric —
"reaches a genuine, gate-confirmed green on an arbitrary real GitHub test" — now
holds **5/5** across 2 frameworks and 2 SUTs, with the file-resolution and
false-green hazards closed. This is no longer "it compiles"; it's "it runs green
on the live app, on the correct file, and didn't corrupt anything to get there".

What this does NOT yet prove: breadth (5 tests, 2 SUTs — not hundreds), apps
behind real auth/CAPTCHA, or long multi-page user journeys. Those are the next
rungs. But the core loop is now validated on real-world inputs, which is the
thing that was missing.
