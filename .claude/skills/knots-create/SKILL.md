---
name: knots-create
description: >-
  Use the Knots workflow through `kno` when asked to create a new knot from a
  rough request and you need a concise goal, exact acceptance criteria, and
  repeatable verification steps.
---

# Knots Create

## Outcome

Create one well-defined knot. Keep the title short and action-oriented. Put the
goal, verification steps, and constraints in `-d`. Put only numbered
acceptance criteria in `--acceptance`.

## Description format

Write `-d` with these sections:

- `Goal:` one short paragraph describing the user-visible outcome.
- `Verification:` a numbered list of repeatable checks with exact commands or
  UI actions and the expected result for each step.
- `Constraints:` optional non-obvious requirements, exclusions, or scope
  boundaries.

Write `--acceptance` as a numbered list of observable outcomes. Reference exact
interfaces when they exist: CLI commands and flags, API routes, file paths,
state names, schema fields, event names, or UI surfaces. Avoid vague criteria
such as "works well", "clean up", or "handle edge cases".

## Command

Run:

```bash
kno new "<title>" -d $'Goal:\n<goal>\n\nVerification:\n1. <step>\n2. <step>' \
  --acceptance $'1. <criterion>\n2. <criterion>'
```

If verification is not yet repeatable, make that gap explicit in the knot so
the agent can close it as part of the work.
