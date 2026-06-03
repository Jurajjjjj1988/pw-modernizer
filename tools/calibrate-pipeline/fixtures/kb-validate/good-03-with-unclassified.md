# Calibration fixture: KB-UNCLASSIFIED sentinel (kb-validate good-03)
#
# Demonstrates correct use of the KB-UNCLASSIFIED sentinel. The sentinel is
# NOT a defined KB ID — kb-validate.ts treats it as a documented allowlist
# entry and must NOT flag references to it. Expected: exit 0.

# Migrator Knowledge Base

## 1. Anti-pattern catalog

### 1.1 Bad-Playwright anti-patterns

#### 1.1.1 Hard waits via waitForTimeout

Hard-wait anti-pattern under legacy numeric scheme.

#### 1.1.6 Missing await on Playwright action

Async actions without `await` silently no-op.

#### 1.1.14 Hardcoded environment URL

Hardcoded production URLs trap migrations in single-env tests.

<!--FIXTURE-SPLIT-->
# Migration rules

A typical row table cites KB-1.1.1 for hard-wait detection and KB-1.1.6
for missing-await. When a novel smell shows up with no KB entry yet, the
emitter uses KB-UNCLASSIFIED and the validator must NOT complain about
the sentinel. Legacy URL pattern is covered by KB-1.1.14.
