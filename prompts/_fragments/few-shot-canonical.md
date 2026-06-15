# Canonical anchor examples (per framework)

These three migrations are the qa-master canonical examples for each source
framework. Stage 1 sees them on every invocation regardless of retrieval
mode - they are the static few-shot anchor the rest of the RAG context
augments. Phase 1, ADR-0001.

Use them as **style anchors** for plan structure, KB-ID citation style,
anti-pattern table format, locator confidence levels, hallucination-defense
pin shape. Do NOT copy scenario IDs or specific locator pins verbatim;
adapt them to the actual input.

## Anchor 1 - bad-playwright (subtractive migration)

**Source:** `examples/bad-playwright-01-flaky-waits/input.spec.ts`
**Plan:** `examples/bad-playwright-01-flaky-waits/expected-plan.md`

The canonical "input is already Playwright, just remove anti-patterns"
case. Demonstrates: `KB-1.1.1` hard-wait removal, `KB-1.1.5` sync-probe
removal, web-first assertions, `getByRole` upgrade for accessible
elements. Scenario IDs are `1.1` / `1.2` (positive / negative login).

Read this anchor when the input is `inputs/bad-playwright/*.spec.ts`,
when removing `waitForTimeout`, or when migrating sync probes to web-first
assertions.

## Anchor 2 - cypress (intercept + session)

**Source:** `examples/cypress-04-session-auth/input.spec.ts`
**Plan:** `examples/cypress-04-session-auth/expected-plan.md`

The canonical "Cypress idioms -> Playwright fixtures" case. Demonstrates:
`cy.session` -> `storageState` fixture migration, `cy.intercept` ->
`page.route` route stub (lifted into a fixture per qa-master), test
data constants in `helper/test-data/`. Scenario IDs are `1.1` / `1.2`
(authenticated dashboard load / mocked teams roster).

Read this anchor when the input is `inputs/cypress/*.cy.js`, when the
input uses session APIs, or when route mocks need lifting out of specs
into fixtures.

## Anchor 3 - selenium-java (multi-file PageFactory)

**Source:** `examples/selenium-java-03-multifile-login/input/`
**Plan:** `examples/selenium-java-03-multifile-login/expected-plan.md`

The canonical multi-file Selenium Java -> Playwright TS case.
Demonstrates: `@FindBy` PageFactory -> `getByRole` / `getByLabel`,
`WebDriverWait` -> Playwright auto-wait, `org.junit.jupiter.api.Test` ->
Playwright `test(...)`, `DriverFactory` helper -> base fixture extension,
POM class -> `outputs/helper/page-object/pages/<name>.page.ts`.

Read this anchor when the input is `inputs/selenium-java/<test-dir>/`,
when PageFactory POMs need restructuring, or when JUnit lifecycle hooks
need fixture translation.

---

**Why these three:**

- bad-playwright covers the subtractive shape (no framework translation)
- cypress covers Cypress-specific idioms (interceptors, sessions)
- selenium-java covers cross-language + multi-file + PageFactory

selenium-python is a near-mirror of selenium-java with `WebDriverWait` and
`pytest` lifecycle hooks instead of `@BeforeEach`; Anchor 3's structure
applies with framework token swapped. Adding a fourth anchor for sel-python
specifically is parked until corpus growth justifies the extra ~1.5K tokens
in the cached prefix.
