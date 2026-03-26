/**
 * Built-in skill prompt overrides keyed by action-state name.
 *
 * When `kno skill <state>` fails (e.g. the binary lacks a built-in skill for
 * that state), the fallback path checks this map before propagating the error.
 * Only states that need a local override should appear here.
 */

export const BUILTIN_SKILL_PROMPTS: Readonly<
  Record<string, string>
> = Object.freeze({
  shipment: `# Shipment

## Input
- Knot in \`ready_for_shipment\` state
- Implementation work from a prior phase

## Actions
1. Check if implementation code is already committed to \`main\`. If so, skip to Completion.
2. Check if implementation code is committed to a feature branch. If so, merge the branch into \`main\`, push, then skip to Completion.
3. Search the repository for committed code that references this knot ID or the problem description. If matching commits are found, go back to step 1.
4. If no committed code is found anywhere, roll back:
   \`kno update <id> --status ready_for_implementation --add-note "No committed implementation found; rolling back to implementation."\`

## Output
- Implementation code merged and pushed to \`main\`
- Transition: \`kno next <id> --expected-state <currentState> --actor-kind agent\`

## Failure Modes
- Merge conflicts: \`kno update <id> --status ready_for_implementation --add-note "<blocker details>"\`
- CI failure after merge: \`kno update <id> --status ready_for_implementation --add-note "<blocker details>"\`
- No implementation found: \`kno update <id> --status ready_for_implementation --add-note "No committed implementation found; rolling back."\``,

  shipment_review: `# Shipment Review

## Input
- Knot in \`ready_for_shipment_review\` state
- Code merged to main, CI green

## Actions
1. Check if implementation code is committed to \`main\`. If so, skip to Completion.
2. Check if implementation code is committed to a feature branch. If so, merge the branch into \`main\`, push, then skip to Completion.
3. Search the repository for committed code that references this knot ID or the problem description. If matching commits are found, go back to step 1.
4. If no committed code is found anywhere, roll back:
   \`kno update <id> --status ready_for_implementation --add-note "No committed implementation found; rolling back to implementation."\`

## Output
- Approved: \`kno next <id> --expected-state <currentState> --actor-kind agent\`
- Needs revision: \`kno update <id> --status ready_for_implementation --add-note "<blocker details>"\`

## Failure Modes
- Deployment issue: \`kno update <id> --status ready_for_shipment --add-note "<blocker details>"\`
- Regression detected: \`kno update <id> --status ready_for_implementation --add-note "<blocker details>"\``,
});
