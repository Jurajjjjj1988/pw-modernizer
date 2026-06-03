# Calibration fixture: duplicate KB-ID definition (kb-validate bad-03)
#
# KB defines `1.1.1` twice with different titles. The validator must emit
# a `duplicate KB ID: 1.1.1` violation. Expected: exit 1.

# Migrator Knowledge Base

## 1. Anti-pattern catalog

### 1.1 Bad-Playwright anti-patterns

#### 1.1.1 Hard waits via waitForTimeout

First definition. Legit.

#### 1.1.2 nth() selector instead of accessible name

Control entry. Should resolve cleanly.

#### 1.1.1 Duplicate entry — wrong, validator must catch

Same numeric ID `1.1.1` repeated under a different title. This is the
calibration trigger.

<!--FIXTURE-SPLIT-->
# Migration rules

Cite KB-1.1.1 and KB-1.1.2 in the smell table. The references resolve
fine — the violation lives in the duplicate KB definition, not in the
references section.
