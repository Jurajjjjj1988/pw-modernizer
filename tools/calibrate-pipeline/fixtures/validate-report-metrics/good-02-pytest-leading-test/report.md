# Migration report — test_login.py

## Source → Target

- Input: `inputs/selenium-python/test_login.py`
- Output: `outputs/tests/login.spec.ts` (27 LOC)
- Source LOC: 35
- Output LOC: 27
- LOC delta: -8

## Notes

pytest source test_login.py migrates to login.spec.ts -- the leading
test_ is dropped because test-ness lives in the .spec.ts extension. The
validator's basename derivation accepts this form, and the claimed 27 LOC
matches the emitted file.
