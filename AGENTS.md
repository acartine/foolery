# Agent Instructions

## Codex Configuration

When using Codex CLI in this project:
- **approval_policy**: `never` (autonomous mode for routine work)
- **model_reasoning_effort**: `xhigh` (complex codebase, needs deep reasoning)

Override with: `codex -c approval_policy=ask` or `codex -c model_reasoning_effort=medium` as needed.

## Repository Overrides

These repo-level rules are mandatory for all agents working in this project:

1. Always use Beads (`bd`) to track and coordinate work.
2. Never close Beads unless the user explicitly instructs you to close them.
3. Never use a PR workflow unless the user explicitly instructs you to use PRs.

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



<!-- FOOLERY_GUIDANCE_PROMPT_START -->
## Foolery Agent Handoff Contract

This repository uses `bd` (Beads) as the source of truth for work tracking and `foolery` for tracking visibility.

Required workflow:
1. Pick a bead and inspect scope with `bd show <id>`.
2. Before any code/doc/commit, set status:
   `bd update <id> --status in_progress`
3. Implement and validate changes in a dedicated git worktree.
4. **Run quality gates** (if code changed) - Tests, linters, builds
5. Commit and capture short hash:
   `SHORT_SHA=$(git rev-parse --short HEAD)`
6. Add handoff labels in this order:
   `bd update <id> --add-label commit:$SHORT_SHA`
   `bd update <id> --add-label stage:verification`
7. Do **not** close the bead unless explicitly instructed.
8. Push work to remote before ending session:
   `git pull --rebase && bd sync && git push`
9. **Clean up** - Clear stashes, worktrees, prune remote branches
10. **Verify** - All changes committed AND pushed
11. **Hand off** - Provide context for next session as handoff capsule in the bead.

Rules:
- Never add `stage:verification` without `commit:<short-sha>`.
- Keep beads open for verification handoff.

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- FOOLERY_GUIDANCE_PROMPT_END -->

