---
name: Bug report
about: A pipeline step misbehaves, a validator misclassifies, a migration goes wrong
title: '[BUG] '
labels: bug
---

## What I expected

Describe the intended outcome.

## What actually happened

Include the failing step name + a short error excerpt.

## Reproduction

- [ ] `npm run smoke` passes on `main` branch HEAD
- [ ] Workflow run URL (`gh run view <id>` is helpful for reviewers): `<paste here>`
- [ ] If this is a Stage 1 / Stage 2 quality issue, link the relevant PR and identify the row/section of the markdown plan that's wrong

## Diagnosis (if known)

Which file(s)? Which commit introduced this?

## Severity

- [ ] **Critical** — pipeline broken for everyone; Stage 1/2 can't run
- [ ] **High** — pipeline runs but produces incorrect output (e.g. false-positive smell detection, wrong AST-diff verdict)
- [ ] **Medium** — pipeline runs and output is correct, but UX is degraded (cryptic error, missing docs)
- [ ] **Low** — cosmetic / nitpick

## Validator findings

If a validator (kb-validate, validate-examples, plan-envelope-validate, ast-diff-trivial-check, assemble-prompts) is involved, paste its full output:

```
<paste validator output here>
```

## Output of `npm run quickstart`

```
<paste here — helps reviewers reproduce>
```
