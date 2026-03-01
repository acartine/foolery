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



<!-- FOOLERY_GUIDANCE_PROMPT_START -->
## Foolery Agent Handoff Contract

This repository uses Knots (`kno`) as the source of truth for work tracking.

Required workflow:
1. Pick a knot and inspect scope with `kno show <id>`.
2. Before any code/doc/commit, claim work with `kno claim <id>` (or `kno poll --claim`).
3. Implement and validate changes in a dedicated git worktree.
4. **Run quality gates** (if code changed) - Tests, linters, builds
5. Commit and capture short hash:
   `SHORT_SHA=$(git rev-parse --short HEAD)`
6. Add handoff context to the knot:
   `kno update <id> --add-handoff-capsule "<summary>"`
7. Do **not** move knots to terminal states unless explicitly instructed.
8. Push work to remote before ending session:
   `git pull --rebase && git push`
9. **Clean up** - Clear stashes, worktrees, prune remote branches
10. **Verify** - All changes committed AND pushed
11. **Hand off** - Provide context for next session in the knot.

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- FOOLERY_GUIDANCE_PROMPT_END -->


## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File follow-up knots** - Create knots for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update knot status** - Advance state as appropriate (non-terminal unless instructed)
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
