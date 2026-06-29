# Migration report — EmployeesTest.java

## Source → Target

- Input: `inputs/selenium-java/EmployeesTest.java`
- Output: `outputs/tests/employees.spec.ts` (29 LOC)
- Source LOC: 40
- Output LOC: 29
- LOC delta: -11

## Notes

Single-file migration. JUnit + WebDriver -> pwm-blueprint spec backed by
EmployeesPage. The Output basename derives from the input
(EmployeesTest.java -> employees.spec.ts) and the claimed 29 LOC matches
wc -l on the emitted file, so the metric self-check is clean.
