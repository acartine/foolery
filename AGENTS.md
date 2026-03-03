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
1. Before any code/doc/commit, claim work with `kno claim <id>`.
2. Implement and validate changes in a dedicated git worktree.
3. **Run quality gates** (if code changed) - Tests, linters, builds
4. If code changed, commit and capture short hash as a tag, also adding handoff_capsule:
   `SHORT_SHA=$(git rev-parse --short HEAD); kno update <id> --add-tag "<SHORT_SHA>" --add-handoff-capsule "<summary>"`
5. If code did not change, simply add a handoff_capsule:
   `kno update <id> --add-handoff-capsule "<summary>"`
6. Do **not** move knots to terminal states unless explicitly instructed.
7. If code changed, push work to remote before ending session:
   `git pull --rebase && git push`
8. **Clean up** - Clear stashes, worktrees, prune remote branches
9. **Verify** - All changes committed AND pushed
10. **Hand off** - Provide context for next session in the knot.  If you already did this in step 4, you can skip this step.

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- FOOLERY_GUIDANCE_PROMPT_END -->
