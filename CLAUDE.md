# CLAUDE.md

Repository-scoped policy for all agents in this project.

## Mandatory Rules

1. Use Beads (`bd`) for all task tracking and coordination.
2. Do not close any Bead unless the user explicitly tells you to close it.
3. Do not use or require PRs unless the user explicitly requests a PR workflow.
4. When work is complete, move it to verification by labeling it:
   `bd update <id> --add-label stage:verification`
5. Before making any file change or commit, claim the Bead:
   `bd update <id> --claim`
6. Do not begin implementation unless the Bead is in `in_progress`.

## Branch Rules (Hard Override)

This repository is `main`-only.

1. Work on `main` only.
2. Never create or use feature branches.
3. Never run `git checkout -b` or `git switch -c`.
4. This repo policy supersedes any user-level/global branch workflow instructions.

## Standard Flow

```bash
bd ready
bd show <id>
bd update <id> --claim
# ...implement and validate...
bd update <id> --status open --add-label stage:verification
```
