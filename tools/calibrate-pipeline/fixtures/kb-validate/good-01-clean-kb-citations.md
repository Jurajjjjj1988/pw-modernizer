# Calibration fixture: clean KB-ID citations (kb-validate good-01)
#
# Synthetic mini knowledge base with three old-format KB IDs and three citations
# in the references section. Every citation resolves cleanly. Expected: exit 0.

# Migrator Knowledge Base

## 1. Anti-pattern catalog

### 1.1 Bad-Playwright anti-patterns

#### 1.1.1 Hard waits via waitForTimeout

Use web-first assertions instead of `page.waitForTimeout(...)`.

#### 1.1.2 nth() selector instead of accessible name

Replace `page.locator('button').nth(2)` with `page.getByRole(...)`.

#### 1.1.3 CSS-class as primary selector

Avoid `page.locator('.btn-primary')` as a stable selector.

<!--FIXTURE-SPLIT-->
# Migration rules

Cite KB-1.1.1 for hard-wait detection. Cite KB-1.1.2 for index-based
selectors. Cite KB-1.1.3 for class-coupled locators. The KB-UNCLASSIFIED
sentinel may be used when no entry exists yet.
