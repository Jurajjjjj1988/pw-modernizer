# Migration report — EmployeesTest.java

## Source → Target

- Input: `inputs/selenium-java/EmployeesTest.java`
- Output: `outputs/tests/using_selenium_tests.spec.ts` (21 LOC)

## Notes

The Output line carries a snake_case filename copy-pasted from a different
migration's report. It does not derive from EmployeesTest.java (which should
produce employees-test.spec.ts / employees.spec.ts). The LOC claim matches
the emitted file, so the ONLY violation is the basename mismatch -- the
PR #13 root cause.
