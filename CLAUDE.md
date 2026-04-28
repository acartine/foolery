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

## kno Workflows Are Authoritative

kno `.loom` workflows are the single source of truth; Foolery TS must never override, extend, or post-process them (no synthetic transitions, no parallel canonical graph). Correction actions that skip gates must be named as such and invoke kno idiomatically with `force: true` (see `KnotsBackend.close()`); details in `docs/DEVELOPING.md`.

## State Classification Is Loom-Derived

Corollary to "kno Workflows Are Authoritative". Foolery TS must NEVER hardcode state names or test for state classification by string pattern. State classification (queue / action / terminal / initial / retake) lives on the loom-derived `MemoryWorkflowDescriptor` produced by `toDescriptor` in `src/lib/backends/knots-backend-workflows.ts`, which reads `kno profile list --json` (`profile.states`, `profile.queue_states`, `profile.action_states`, `profile.terminal_states`, etc.).

Use the descriptor fields directly:

- "Is this a queue state?" → `descriptor.queueStates.includes(state)`
- "Is this an action state?" → `descriptor.actionStates.includes(state)`
- "Is this terminal?" → `descriptor.terminalStates.includes(state)`
- "Where does this beat start?" → `descriptor.initialState`
- "Where does Retake send it?" → `descriptor.retakeState`

Do NOT:

- Test classification by prefix (`state.startsWith("ready_for_")`, `state.endsWith("_review")`).
- Hardcode state names in caller logic (`state === "ready_for_implementation"`, `["shipped", "abandoned"].includes(state)`, `state === "implementation"`).
- Maintain a parallel constant table of "queue states we know about" — that table will silently drift the moment a custom `.loom` profile adds, renames, or removes a state.
- Coalesce a missing descriptor field with a hardcoded default (`?? "ready_for_implementation"`, `?? ["shipped"]`).

The `ready_for_*` prefix is a kno-side naming convention used by the builtin `autopilot` / `semiauto` profiles. It is NOT a contract — a custom loom profile may use any name kno accepts. Treating the prefix as load-bearing logic silently breaks every non-builtin profile and quietly drifts when names change in `kno`.

Two narrow exceptions:

1. **Builtin profile catalogs** that mirror the canonical loom shape (e.g. `src/lib/workflows.ts`'s `BUILTIN_PROFILE_CATALOG`) may list state names because the file IS the descriptor source for legacy / non-knots backends. Treat these tables like loom files themselves — never read from them in caller logic, only feed them into `toDescriptor` / `descriptorFromProfileConfig`.
2. **Pure presentation theming** (e.g. mapping a state string to a CSS color in a row badge) where the renderer has no descriptor in scope. Acceptable, but prefer plumbing the descriptor through when feasible.

If a code site needs to ask "is this state a queue state?", and the descriptor is not in scope, the fix is to plumb the descriptor through — not to add a prefix check. See `src/components/beat-detail.tsx`'s `validNextStates` and `src/components/beat-detail-state-dropdown.tsx`'s `RewindSubmenu` for the canonical pattern.

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

This rule covers backend resolution as well as agent dispatch.
`AutoRoutingBackend` (see `src/lib/backend-factory.ts`) MUST throw
`DispatchFailureError` (kind `"backend"`) when `repoPath` is missing or no
memory-manager marker is present. The escape hatch is the explicit
`FOOLERY_BACKEND=cli|knots|beads|stub` env var, not a silent default.

Historical incidents this rule protects against:

1. `getFallbackCommand` returned the first registered agent when no pool or
   action was configured. Since OpenCode was first in the user's TOML, every
   unrouted dispatch silently ran OpenCode — for months — while the real
   bug (non-SDLC workflow states were never consulting the configured pools)
   stayed invisible.
2. `AutoRoutingBackend` defaulted to the BD/CLI backend when `repoPath` was
   missing or unrecognised. Knots-only repos surfaced as
   `table not found: issues` from the unrelated BD store instead of pointing
   at the real config gap (no `_repo` query param, or no `.knots/` /
   `.beads/` marker). A loud failure at the resolver layer caught it on the
   first take.

See `src/lib/dispatch-pool-resolver.ts` for the canonical implementation:
`resolveDispatchAgent` + `DispatchFailureError` + `emitDispatchFailureBanner`.
Reuse those primitives; do not invent a parallel failure mode. API route
handlers should wrap their backend calls with `withDispatchFailureHandling`
(see `src/lib/backend-http.ts`) so failures surface as a structured 500 with
the red banner in the body.

## Quality Gates

Before committing changes, ensure that the codebase passes all quality checks. Run the following commands:
- **Linting:** `bun run lint`
- **Type Checking:** `bunx tsc --noEmit`
- **Testing:** `bun run test` (or `bun run test:all` for unit + storybook)
- **Building:** `bun run build`

Do not push code that fails these checks unless explicitly instructed.

**Fix all failures, not just yours.** Unless you are working on a specific non-implementation knot step (e.g., plan review, shipment review), you must fix all broken lint errors, type errors, formatting issues, and failing tests — even if they are pre-existing and not caused by your changes. Leave the codebase cleaner than you found it.

## Hermetic Test Policy

Tests in the default suite (`src/**/__tests__/`) MUST NOT touch the host environment. No `process.env`, no real fs (`tmpdir`, `mkdtemp`, real cwd reads), no `execFile`/`spawn`/`bash -c`, no real network or ports, no host binaries (`git`, `kno`, `node`, `bun`), no wall-clock timers. If a function depends on any of these, push the resolution up the stack and inject the dependency so tests target the deep, deterministic logic.

Tests that genuinely must exercise the environment (e.g. shell-script integration, launcher generation) go in `src/**/__manual_tests__/` and run only via `bun run test:manual`. They are excluded from `bun run test`, `bun run test:all`, and CI on purpose. A failing manual test is not a CI failure.

Full rationale and examples in `docs/DEVELOPING.md` → "Hermetic Test Policy".
