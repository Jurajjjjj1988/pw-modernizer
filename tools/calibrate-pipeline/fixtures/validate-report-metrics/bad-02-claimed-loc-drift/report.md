# Migration report — EmployeesTest.java

## Source → Target

- Input: `inputs/selenium-java/EmployeesTest.java`
- Output: `outputs/tests/employees.spec.ts`
- Output LOC: 99

## Notes

Basename derives correctly and the file exists, but the report claims the
emitted spec is 99 lines while it is actually 20. No Source LOC / delta
lines are present, so the single violation is the Output LOC drift.
