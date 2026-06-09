---
name: knots
description: >-
  Use the Knots workflow through `kno` when asked to create a knot, work on a
  specific knot, claim or execute a knot, advance a knot to its next state, or
  recover or roll back a knot safely after blocked or failed work.
---

# Knots

## Agent identity

Create or receive a lease before writing workflow metadata:

```bash
kno lease create --nickname "<session-name>"
```

Bind that lease to every claim, creation, advance, note, and handoff-capsule
command you run for the session. Agent identity for notes, handoff capsules,
state transitions, and gate decisions comes from the bound lease.

Do not copy legacy `--*-agentname/model/version` identity flags from telemetry
or command history. They are deprecated, ignored by current `kno`, and can
leave metadata attributed as `[unknown <date>]` when no lease is bound.

## Create a knot

Run:

```bash
kno new "<title>" -d "<description>" --lease <lease-id>
```

Use a short action-oriented title. Write the description with the expected
outcome, relevant context, and constraints for the next agent. Add handoff
context for the next actor with:

```bash
kno update <id> -H "<capsule>" --lease <lease-id>
```

## Execute a knot

Follow this sequence:

```bash
kno claim <id> --lease <lease-id>
```

- If you are working inside a git worktree, run Knots commands as
  `kno -C <path_to_repo> ...` because Knots is installed for the repo root,
  not the worktree path.
- Record the current state from the claim output.
- Use the claim output to determine the current state's completion goals.
- Do the work and validate it.
- If the goals were met, advance with a guarded state check:

```bash
kno next <id> --expected-state <current_state> --lease <lease-id>
```

- If you are blocked, validation fails, or the state's goals were not met, roll back safely:

```bash
kno rollback <id> --lease <lease-id>
```

If the claimed knot lists children, handle the children first:
- Claim each child knot and follow that child prompt to completion.
- When the child knots are handled, evaluate the outcomes.
- If every child advanced, advance the parent.
- If any child rolled back, roll the parent back too.

Do not invent alternate transition workflows. Prefer `claim`, `next`, and
`rollback` over manual state mutation unless the user explicitly asks for it.

## Session close behavior

- In an interactive session, briefly say what changed and ask what to do next.
- In a non-interactive session, stop cleanly after the knot workflow is complete.
