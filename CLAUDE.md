# CLAUDE.md

Repository-scoped policy for all agents in this project.

## Mandatory Rules

1. Use Beads (`bd`) for all task tracking and coordination.
2. Do not close any Bead unless the user explicitly tells you to close it.
3. Do not use or require PRs unless the user explicitly requests a PR workflow.
4. Before making any file change or commit, move the Bead to `in_progress`:
   `bd update <id> --status in_progress`
5. Do not begin implementation unless the Bead is in `in_progress`.
6. `bd update <id> --claim` is optional for assignee metadata and does not replace setting status.
7. For verification handoff, add labels in this order:
   `bd update <id> --add-label commit:<short-commit-hash>`
   `bd update <id> --add-label stage:verification`
8. Never add `stage:verification` without a matching `commit:<short-commit-hash>` label.

## Worktree Rules (Hard Override)

This repository supports parallel agent work through Git worktrees.

1. Do implementation work in a dedicated Git worktree.
2. Worktrees may use short-lived local branches for isolation.
3. Land final integrated changes on `main` and push to `origin/main`.
4. Do not require reviews or pull requests unless the user explicitly requests them.

## Standard Flow

```bash
bd ready
bd show <id>
bd update <id> --status in_progress
# optional metadata only:
# bd update <id> --claim
# ...implement and validate...
SHORT_SHA=$(git rev-parse --short HEAD)
bd update <id> --add-label commit:$SHORT_SHA
bd update <id> --add-label stage:verification
```

## Bead Lifecycle Structure

1. Pick an unblocked Bead and review context with `bd show <id>`.
2. Set the Bead to `in_progress` before file edits or commits.
3. Implement and run validation for the scoped work.
4. Commit changes and add `commit:<short-commit-hash>`.
5. Add `stage:verification` after the commit label.
