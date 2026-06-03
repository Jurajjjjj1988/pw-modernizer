# Calibration fixture: dangling KB-ID citation (kb-validate bad-01)
#
# Migration rules cite KB-9.9.9 which is NOT defined in the KB section.
# The validator must emit a `referenced but not defined` violation. Expected: exit 1.

# Migrator Knowledge Base

## 1. Anti-pattern catalog

### 1.1 Bad-Playwright anti-patterns

#### 1.1.1 Hard waits via waitForTimeout

Real KB entry. The bad reference KB-9.9.9 below is not defined.

#### 1.1.2 nth() selector instead of accessible name

Real KB entry. Used as a control to confirm partial-passes still get
flagged for the dangling cite.

<!--FIXTURE-SPLIT-->
# Migration rules

For hard-waits we cite KB-1.1.1. For phantom future smell we cite
KB-9.9.9 — this MUST be flagged as `KB ID '9.9.9' referenced but not
defined in config/knowledge-base.md`. KB-1.1.2 should resolve cleanly.
