# Confidence without breadth — how we trust the tool without running 300 migrations

> **Thesis.** `confidence = (proven gates) × (failure-mode coverage) × (measured
> determinism)` — **not** test count. Running 300 migrations is brute-force
> breadth: expensive, slow, token-heavy, and it still only samples the input
> space. The cheaper, stronger path is to make each migration *self-certifying*
> against gates we have independently proven correct, cover the failure **modes**
> (not the input count), and measure determinism on a small set. This doc is the
> playbook; it names what is DONE in the repo and what is NEXT.

## Why 300 tests is the weak way

A passing migration tells you that ONE input, on ONE app, on ONE run, was green.
300 of them is 300 anecdotes. They do not tell you *why* it passed, whether it
would pass again, or whether the gate that accepted it can be trusted. Worse,
every run costs Sonnet+Opus tokens and minutes. Breadth has a place (it surfaces
unknown failure modes — see the 10-test batch that exposed the iframe class), but
it is the most expensive bit of confidence you can buy, so spend it last and
deliberately, not as the primary instrument.

## The six levers

### 1. Proven gates = self-certification  ⟶ the #1 lever

The closed loop only accepts a migration that passes the validator wall + the
live execution gate. So if **every gate is independently proven** (it accepts the
goods and rejects the bads), then every migration the loop accepts is certified
by construction — you trust the *gate*, not 300 manual reviews.

- **DONE.** 16 validators are calibrated against a good/bad fixture corpus
  (`npm run calibrate`); an uncalibrated validator is worse than none (false
  confidence), so each one proves accept-goods/reject-bads before it can block.
- **DONE (this round).** `validate-url-portability` converts the soft "use
  baseURL + relative paths" prompt rule into a **hard structural gate** —
  exactly this lever: a durable gate beats a prompt nudge.
- **NEXT.** Audit each remaining *soft* prompt rule (forbidden-patterns,
  metrics-schema) for a missing structural gate, and promote the highest-value
  ones. A prompt rule with no gate is an un-enforced wish.

### 2. Mutation-test the gates (meta-testing)

For each gate, **inject the exact failure it claims to catch** and assert it
REJECTS. This proves the gate *works* with ~3 fixtures, not 300 migrations.

- **DONE.** The calibrate corpus is partly this: every `bad-NN` fixture is an
  injected failure the gate must reject (false-green verdict, weakened assertion,
  dangling storageState, absolute URL, dropped network stub, co-authored POM).
- **NEXT.** Make it systematic: for each closed-loop gate (verdict parser,
  assertion-strength B1, network-completeness B2, provenance), add a deliberate
  mutation fixture if one is missing. A gate with no `bad-` fixture is unproven.

### 3. Failure-mode matrix, not test count

Cover the **(failure-class × framework)** grid, one test per cell — ~30–40 cells,
not 300 random inputs. Coverage by *mode*, not by *count*.

- **PARTIAL.** The 17 measured greens already span Cypress / Selenium-Java /
  Selenium-Python × {dialog, iframe, dynamic-load, network, hover, status-code}.
- **NEXT.** Draw the grid explicitly (see the appendix) and fill the empty cells
  on purpose — each empty cell is a known blind spot, not a guess.

### 4. Flake-rate on a SMALL set run N times

Determinism is a property you measure by REPETITION, not variety. 10 greens × 20
runs = statistical confidence in determinism, far cheaper than 300 distinct
inputs. A green that fails on its 2nd run is a hidden red.

- **NOT DONE — highest-value cheap measurement available.** Each green has been
  run once. Re-run the existing greens N× and record the pass-rate distribution.
  One app behind real auth × 20 runs tells you more than 50 demo apps × 1.

### 5. Property / metamorphic invariants

Instead of checking N specific outputs, assert an INVARIANT that must hold for
ANY migration. One property covers infinite inputs.

- **DONE (partial).** B1 assertion-strength ("output assertions are never weaker
  than source") and DOM-grounding ("every accepted locator resolves on the live
  DOM") are exactly such properties.
- **NEXT.** Add **mutation-parity** (offline): the migrated test must kill the
  same source-mutants the original did — a metamorphic check that needs no live
  app and catches silent assertion loss the tier-lattice can miss.

### 6. Adversarial self-audit agent

A read-the-code defect hunt finds failure **classes**, each closed once by a gate
— covering infinite instances. The multi-agent hunt found 24 defects by *reading*,
not by 300 runs.

- **DONE.** `docs/DEFECT-HUNT-FINDINGS.md` (24 defects) drove B1/B2/DEF1/DEF2/the
  hang-fix and this round's B3/B4.
- **NEXT.** Re-run the hunt after each batch of fixes; what it finds is the next
  round of gates. Treat "the hunt found nothing new twice in a row" as the real
  done-signal, not "N tests passed".

## What "enough" looks like (the budget, not 300)

| Instrument | Cost | Buys |
| --- | --- | --- |
| Calibrate corpus (gates proven) | ~free, seconds | self-certification (lever 1+2) |
| Failure-mode matrix (~30 cells) | ~30 runs, once | breadth by *mode* (lever 3) |
| Flake-rate (10 greens × 20) | ~200 runs, one app-set | determinism (lever 4) |
| Property gates | ~free per migration | infinite-input coverage (lever 5) |
| Self-audit hunt | ~1 agent sweep | unknown failure classes (lever 6) |

That is **~30 deliberate runs + repetition on a small set**, proven gates, and a
recurring audit — never 300 random migrations.

## Prioritised next actions

1. **Flake-rate measurement** (lever 4) — cheapest high-value; re-run existing
   greens N× and publish the determinism distribution. *(autonomous-doable)*
2. **Mutation-parity property** (lever 5) — offline, no app, catches silent
   assertion loss.
3. **Failure-mode matrix** (lever 3) — draw the grid, fill empty cells on purpose.
4. **One app behind real auth** (breadth, spend last) — the biggest *unknown*,
   needs a human decision on which app.

## Appendix — the failure-mode matrix (draw it, fill the gaps)

Rows = failure classes the closed loop must handle; columns = source frameworks.
A filled cell = one proven migration; an empty cell = a deliberate, named gap.

| Failure class | bad-PW | Cypress | Selenium-Java | Selenium-Python |
| --- | :--: | :--: | :--: | :--: |
| hard-wait → web-first assertion | ✓ | ✓ | ✓ | ✓ |
| dialog / confirm | – | ✓ | – | – |
| iframe | – | ✓ | – | – |
| dynamic load / controls | – | ✓ | – | – |
| network stub (intercept) | – | ✓ | – | – |
| hover / context-click | – | ✓ | – | – |
| auth / storageState | – | – | ✓ | – |
| multi-file / page-object split | – | – | ✓ | ✓ |
| absolute-URL portability | ✓ (gate) | ✓ (gate) | ✓ (gate) | ✓ (gate) |

`✓` proven by a real migration; `✓ (gate)` proven by a deterministic gate +
fixtures (no migration run needed); `–` an open cell to fill deliberately.
