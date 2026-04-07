# Foolery Lease Log Forensics

## Primary Files

### Lease lifecycle

- Dev: `.foolery-logs/_leases/YYYY-MM-DD/leases.jsonl`
- Installed runtime: `~/.config/foolery/logs/_leases/YYYY-MM-DD/leases.jsonl`

Common events:

- `lease_create_requested`
- `lease_create_succeeded`
- `lease_claim_binding_check`
- `prompt_delivered`
- `lease_terminate_requested`
- `lease_terminate_succeeded`
- `lease_terminate_failed`
- `lease_attached`

Important keys:

- `sessionId`
- `beatId`
- `knotsLeaseId`
- `interactionType`
- `agentName`
- `agentModel`
- `data.queueType`
- `data.reason`

### Session / interaction logs

- `{root}/{repoSlug}/YYYY-MM-DD/{sessionId}.jsonl`

Useful kinds:

- `session_start`
- `prompt`
- `response`
- `beat_state`
- `token_usage`
- `session_end`

Useful `beat_state.phase` values:

- `before_prompt`
- `after_prompt`
- `rollback`

### Server logs

- Dev: `.foolery-logs/_server/YYYY-MM-DD/console.log`
- Dev: `.foolery-logs/_server/YYYY-MM-DD/server.jsonl`

Use these when you need:

- `child close: code=...`
- `post-close beat state: ...`
- invariant warnings
- retry / agent rotation context

## Known Good Patterns

### Clean next iteration

This normally looks like:

1. `prompt_delivered`
2. child exits
3. `lease_terminate_requested` with `reason: "next_iteration"`
4. `lease_terminate_succeeded`
5. new lease create events for the next agent or next step

### Clean session completion

This normally looks like:

1. `prompt_delivered`
2. child exits `0`
3. `session_end` with `status: "completed"`
4. `lease_terminate_requested` with `reason: "session_completed"`
5. `lease_terminate_succeeded`

## Proven Failure Classes

### Hung / still-open turn

Evidence:

- last lease event is `prompt_delivered`
- no `session_end`
- no matching `lease_terminate_succeeded`
- session `response` rows continue after the last lease event

### Completed turn without advancing or rolling back

Evidence:

- `session_end.exitCode == 0`
- lease termination succeeded
- `before_prompt` is a queue state such as `ready_for_plan_review`
- `after_prompt` is still the action state such as `plan_review`

Interpretation:

- The child process exited successfully, but the workflow action did not move
  the knot to the expected next queue state or prior queue state.
- This usually means the agent reasoned, reviewed, or commented, but did not
  run the completion command from the claim prompt.

### Lease cleanup failure

Evidence:

- `lease_terminate_failed`
- server warning about a dangling lease
- no terminal cleanup after a completed or errored session

## Step Outcome Heuristic

For a completed turn, compare the claimed queue state against the `after_prompt`
state:

- `ready_for_planning` should usually become `ready_for_plan_review`
- `ready_for_plan_review` should usually become `ready_for_implementation` or
  `ready_for_planning`
- `ready_for_implementation` should usually become
  `ready_for_implementation_review` or `ready_for_plan_review`
- `ready_for_implementation_review` should usually become
  `ready_for_shipment` or `ready_for_implementation`
- `ready_for_shipment` should usually become `ready_for_shipment_review` or
  `ready_for_implementation_review`
- `ready_for_shipment_review` should usually become `shipped` or
  `ready_for_shipment`

If the post-exit state is the active/review state itself, classify the turn as
"completed without progress."

## Recent Confirmed Examples

### Dev `foolery`

Session:
`/Users/cartine/foolery/.foolery-logs/foolery/2026-04-06/term-1775494730943-ft7rmc.jsonl`

Lease log:
`/Users/cartine/foolery/.foolery-logs/_leases/2026-04-06/leases.jsonl`

Examples:

- iteration 2: `ready_for_plan_review -> plan_review`
- iteration 4: `ready_for_plan_review -> plan_review`
- iteration 8: `ready_for_implementation_review -> implementation_review`
- iteration 10: `ready_for_implementation_review -> implementation_review`

Likely cause:

- The agent produced review commentary and exited `0`, but did not execute the
  claim completion command.

### Installed runtime example

Session:
`/Users/cartine/.config/foolery/logs/knots/2026-04-07/term-1775558265805-ust873.jsonl`

Lease log:
`/Users/cartine/.config/foolery/logs/_leases/2026-04-07/leases.jsonl`

Examples:

- iteration 2: `ready_for_plan_review -> ready_for_plan_review`
- iteration 4: `ready_for_implementation -> implementation`

This proves the same class of issue can occur in the installed runtime too.
