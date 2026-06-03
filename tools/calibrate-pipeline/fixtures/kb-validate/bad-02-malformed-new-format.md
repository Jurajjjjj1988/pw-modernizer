# Calibration fixture: malformed new-format KB ID (kb-validate bad-02)
#
# KB header `#### [pw/timing/3hard-wait]` has a topic segment starting with
# a digit. The header regex `[a-z0-9-]+` accepts it, but the strict regex
# `[a-z][a-z0-9-]*` (required by NEW_FORMAT_STRICT) rejects names that do
# not start with a lowercase letter. Expected: exit 1 with `new-format KB ID`
# error.

# Migrator Knowledge Base

## 1. Anti-pattern catalog

### 1.1 Bad-Playwright anti-patterns

#### [pw/timing/3hard-wait] Hard waits via waitForTimeout

Third segment starts with `3` — strict regex requires `[a-z]` first.
The validator must reject this on the header line as malformed.

#### [pw/timing/hard-wait] Hard waits via waitForTimeout (clean alias)

Clean reference present so the bad header does not also produce a
secondary missing-reference noise. Required to isolate the regex
violation.

<!--FIXTURE-SPLIT-->
# Migration rules

Cite pw/timing/hard-wait in the smell table. The malformed
pw/timing/3hard-wait alias is the calibration target — kb-validate
must reject it on the header line for failing the strict regex.
