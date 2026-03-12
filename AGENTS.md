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

## Quality Gates

Before committing changes, ensure that the codebase passes all quality checks. Run the following commands:
- **Linting:** `bun run lint`
- **Type Checking:** `bunx tsc --noEmit`
- **Testing:** `bun run test` (or `bun run test:all` to run all tests)
- **Building:** `bun run build`

Do not push code that fails these checks unless explicitly instructed.
