# Provenance: AsyncScriptJupiterTest.java

## Source
- **Upstream:** [bonigarcia/selenium-webdriver-java](https://github.com/bonigarcia/selenium-webdriver-java)
- **License:** Apache-2.0
- **Path in upstream:** `selenium-webdriver-junit5/src/test/java/io/github/bonigarcia/webdriver/jupiter/ch04/javascript/AsyncScriptJupiterTest.java`
- **Fetched on:** 2026-06-09 via `gh api` (P3 batch 2)

## Topic
- **Anti-pattern domain:** JavaScript
- **Summary:** executeAsyncScript with explicit callback

## Why included
P3 batch 2 expansion (5 tests). Cumulative coverage with batch 1: 10 new bonigarcia tests across ch04/05 domains. Stage 1 + Stage 2 + verify CANDOR signal for SHIP IT rate calibration.

## Modifications from upstream
None. Verbatim copy.

## Test plan
- plan.yml fires on push (`inputs/**` trigger), opens `migrator:plan` PR
- Reviewer merges plan → migrate.yml fires Stage 2 with v0.1.0-bound hardened `generate.md`
- Expected output: `outputs/tests/asyncscriptjupitertest.spec.ts` per kebab-case convention
