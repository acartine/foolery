# Agent Instructions

## Codex Configuration

When using Codex CLI in this project:
- **approval_policy**: `never` (autonomous mode for routine work)
- **model_reasoning_effort**: `xhigh` (complex codebase, needs deep reasoning)

Override with: `codex -c approval_policy=ask` or `codex -c model_reasoning_effort=medium` as needed.

## Repository Overrides

These repo-level rules are mandatory for all agents working in this project:

1. Use Knots (`kno`) as the only work-tracking system.
2. Do not use any alternate tracker in this repository.
3. Never move knots to terminal states unless the user explicitly instructs you.
4. Never use a PR workflow unless the user explicitly instructs you to use PRs.

## Git Worktree Policy (Hard Override)

This repository supports parallel agent work using Git worktrees.

1. Do implementation work in a dedicated Git worktree.
2. Worktrees may use short-lived local branches for isolation.
3. Final integrated changes must be pushed to remote `main` (`origin/main`).
4. Do not require reviews or pull requests unless the user explicitly requests them.

## Worktree Dependency Bootstrap

Each Git worktree is a separate checkout and does not share `node_modules`.

1. After creating or switching to a worktree, run:
   `bun install --frozen-lockfile`
2. Run dependency install before lint, typecheck, test, or build commands.
3. Prefer `bun run <script>` over `bunx <tool>` so plugins resolve from local project dependencies.
4. If `node_modules` is missing in the worktree, treat lint/typecheck results as invalid until install completes.

## Code Style Constraints

- **File length:** max 500 lines per source file
- **Function length:** max 100 lines per function
- **Line length:** max 100 columns per line

These are enforced by ESLint (`max-lines`, `max-lines-per-function`, `max-len`).

## Fail Loudly, Never Silently

Silent fallbacks on configured resources are banned.

When a lookup for a configured resource (an agent, a pool, an action mapping,
a command, a workflow descriptor, a backend) cannot resolve, the code MUST:

1. Throw an error that halts the current operation.
2. Write an ANSI-red banner block to the server log via `console.error`.
3. Surface the failure to any user-visible session buffer as a stderr banner
   event so the UI shows it.
4. Include the greppable marker phrase `FOOLERY DISPATCH FAILURE` (or a
   similarly distinctive marker for other subsystems) in both the thrown
   error message and the banner.
5. Name the specific thing that was missing (beat id, state, pool key,
   workflow id, action name) and the exact config that would fix it.

Do NOT:

- Return "the first registered X" as a fallback (`Object.values(x)[0]`).
- Coalesce missing configuration with `?? "default"`, `?? "claude"`,
  `?? "implementation"`, or any other literal that hides the missing
  configuration from the user.
- Substitute a legacy mapping when the intended new mapping returns null.
- Catch a dispatch failure and downgrade it to a warning.

Historical incident this rule protects against: `getFallbackCommand` returned
the first registered agent when no pool or action was configured. Since
OpenCode was first in the user's TOML, every unrouted dispatch silently ran
OpenCode — for months — while the real bug (non-SDLC workflow states were
never consulting the configured pools) stayed invisible. A loud failure at
the dispatch layer would have caught it on the first take.

See `src/lib/dispatch-pool-resolver.ts` for the canonical implementation:
`resolveDispatchAgent` + `DispatchFailureError` + `emitDispatchFailureBanner`.
Reuse those primitives; do not invent a parallel failure mode.

## Quality Gates

Before committing changes, ensure that the codebase passes all quality checks. Run the following commands:
- **Linting:** `bun run lint`
- **Type Checking:** `bunx tsc --noEmit`
- **Testing:** `bun run test` (or `bun run test:all` to run all tests)
- **Building:** `bun run build`

Do not push code that fails these checks unless explicitly instructed.

**Fix all failures, not just yours.** Unless you are working on a specific non-implementation knot step (e.g., plan review, shipment review), you must fix all broken lint errors, type errors, formatting issues, and failing tests — even if they are pre-existing and not caused by your changes. Leave the codebase cleaner than you found it.
