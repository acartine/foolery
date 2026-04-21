---
name: knots-plan-orchestrator
description: >-
  Use the Knots workflow through `kno` when asked to orchestrate an execution
  plan from start to finish, processing waves sequentially, steps within each
  wave sequentially, and launching knots within each step concurrently.
---

# Knots Plan Orchestrator

## Load the plan

```bash
kno show <plan-id> --json
```

Parse the `execution_plan` field from the JSON output. The plan contains an
ordered `waves` array, each wave contains an ordered `steps` array, and each
step contains a `knot_ids` array representing the concurrent work set.

- If you are working inside a git worktree, run Knots commands as
  `kno -C <path_to_repo> ...` because Knots is installed for the repo root,
  not the worktree path.

## Orchestration protocol

Process the plan using these sequencing rules:

1. **Waves are sequential.** Process waves in ascending `wave_index` order.
   Do not start wave N+1 until every knot in wave N has reached a terminal or
   passive waiting state.
2. **Steps within a wave are sequential.** Process steps in ascending
   `step_index` order. Do not start step N+1 until every knot in step N has
   reached a terminal or passive waiting state.
3. **Knots within a step are concurrent.** Launch every knot in one step at
   the same time. Follow your own protocol for launching and managing coding
   agents — this skill does not prescribe how agents are spawned.

## Process each step

For each step in the current wave:

- Read the `knot_ids` array from the step.
- For each knot id, check its current state:

```bash
kno show <knot-id> --json
```

- Skip knots already in a terminal state (`SHIPPED`) or a passive waiting
  state (`BLOCKED`, `DEFERRED`).
- Launch all remaining knots concurrently. Delegate to your agent-launching
  protocol; do not inline the execution of a knot inside the orchestrator.
- Wait for every launched knot to reach `SHIPPED`, `BLOCKED`, or `DEFERRED`
  before moving to the next step.

## Handle outcomes

- If a knot reaches `BLOCKED` or `DEFERRED`, record the outcome and continue
  to the next step. Do not retry automatically.
- If the plan cannot make meaningful progress because too many knots are
  blocked or deferred, stop and report the failure.
- At the end of each wave, summarize the outcomes of every knot in that wave
  before starting the next wave.

## Complete the plan

When every wave has been processed:

- Report the final state of every knot referenced in the plan.
- Summarize which knots shipped and which are blocked or deferred.
- If the plan knot itself is still active, advance it with a guarded state
  check:

```bash
kno next <plan-id> --expected-state <current_state>
```

- If the plan cannot be advanced because required knots did not ship, roll
  the plan back:

```bash
kno rollback <plan-id>
```

## Session close behavior

- In an interactive session, briefly report the plan execution summary and
  ask what to do next.
- In a non-interactive session, stop cleanly after the orchestration is
  complete.
