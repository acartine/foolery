# Agent Instructions

This repository uses `bd` (Beads) as the single source of truth for work tracking.

## Repository Overrides

These repo-level rules are mandatory for all agents working in this project:

1. Always use Beads (`bd`) to track and coordinate work.
2. Never close Beads unless the user explicitly instructs you to close them.
3. Never use a PR workflow unless the user explicitly instructs you to use PRs.
4. `ship_with_review` is disabled in this repository unless the user explicitly requests `ship_with_review` or a PR workflow.
5. Before any code change, docs edit, or git commit, move the Bead to `in_progress`:
   `bd update <id> --status in_progress`
6. Do not start work unless the target Bead is in `in_progress`.
7. `bd update <id> --claim` is optional for assignee metadata and does not replace setting status.
8. For verification handoff, labels must be added in this order:
   `bd update <id> --add-label commit:<short-commit-hash>`
   `bd update <id> --add-label stage:verification`
9. Do not add `stage:verification` without a matching `commit:<short-commit-hash>` label.

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

## Beads-First Flow

```bash
bd ready
bd show <id>
bd update <id> --status in_progress
# optional metadata only:
# bd update <id> --claim
# ...do the work and run verification...
SHORT_SHA=$(git rev-parse --short HEAD)
bd update <id> --add-label commit:$SHORT_SHA
bd update <id> --add-label stage:verification
```

## Bead Lifecycle Structure

1. Select an unblocked Bead and inspect scope with `bd show <id>`.
2. Transition to `in_progress` before touching files or commits.
3. Implement and validate changes tied to that Bead.
4. Commit changes, capture the short hash, and add `commit:<short-commit-hash>`.
5. Add `stage:verification` after the commit label.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Keep Beads open unless instructed, and for completed work add:
   `commit:<short-commit-hash>` then `stage:verification`
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
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
