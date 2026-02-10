# Agent Instructions

This repository uses `bd` (Beads) as the single source of truth for work tracking.

## Repository Overrides

These repo-level rules are mandatory for all agents working in this project:

1. Always use Beads (`bd`) to track and coordinate work.
2. Never close Beads unless the user explicitly instructs you to close them.
3. Never use a PR workflow unless the user explicitly instructs you to use PRs.
4. Instead of closing completed work, mark it for verification with:
   `bd update <id> --add-label stage:verification`
5. Before any code change, docs edit, or git commit, move the Bead to `in_progress`:
   `bd update <id> --status in_progress`
6. Do not start work unless the target Bead is in `in_progress`.
7. `bd update <id> --claim` is optional for assignee metadata and does not replace setting status.

## Git Worktree Policy (Hard Override)

This repository supports parallel agent work using Git worktrees.

1. Do implementation work in a dedicated Git worktree.
2. Worktrees may use short-lived local branches for isolation.
3. Final integrated changes must be pushed to remote `main` (`origin/main`).
4. Do not require reviews or pull requests unless the user explicitly requests them.

## Beads-First Flow

```bash
bd ready
bd show <id>
bd update <id> --status in_progress
# optional metadata only:
# bd update <id> --claim
# ...do the work and run verification...
bd update <id> --status open --add-label stage:verification
```
