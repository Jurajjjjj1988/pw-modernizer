# Calibration fixture: mixed old + new format IDs (kb-validate good-02)
#
# KB defines both numeric (KB-1.1.1) and kebab-case (pw/timing/hard-wait) IDs.
# Migration rules cite a mix. Both formats must resolve cleanly. Expected: exit 0.

# Migrator Knowledge Base

## 1. Anti-pattern catalog

### 1.1 Bad-Playwright anti-patterns

#### 1.1.1 Hard waits via waitForTimeout

Old numeric ID still valid during transition.

#### [pw/timing/hard-wait] Hard waits via waitForTimeout (kebab alias)

Same anti-pattern under the new kebab-case scheme.

#### [cy/timing/cy-wait] cy.wait(N) hard wait

Cypress hard-wait under new scheme.

#### [sel/selector/xpath-positional] By.xpath positional XPath

Selenium positional XPath under new scheme.

<!--FIXTURE-SPLIT-->
# Migration rules

The old numeric KB-1.1.1 is referenced here for legacy compatibility. New
kebab references pw/timing/hard-wait and cy/timing/cy-wait must both resolve.
Selenium tests should cite sel/selector/xpath-positional when emitting an
XPath smell row.
