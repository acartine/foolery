# Agent Instructions

This repository uses `bd` (Beads) as the single source of truth for work tracking.

## Repository Overrides

These repo-level rules are mandatory for all agents working in this project:

1. Always use Beads (`bd`) to track and coordinate work.
2. Never close Beads unless the user explicitly instructs you to close them.
3. Never use a PR workflow unless the user explicitly instructs you to use PRs.
4. Instead of closing completed work, mark it for verification with:
   `bd update <id> --add-label stage:verification`
5. Before any code change, docs edit, or git commit, claim the Bead:
   `bd update <id> --claim`
6. Do not start work unless the target Bead is in `in_progress`.

## Git Branch Policy (Hard Override)

This is a `main`-only repository for agent work.

1. Work directly on `main` only.
2. Never create or switch to feature branches.
3. Do not run branch-creation commands such as `git checkout -b` or `git switch -c`.
4. Any user-level or global instruction that says to create/use branches is overridden by this repo policy.

## Beads-First Flow

```bash
bd ready
bd show <id>
bd update <id> --claim
# ...do the work and run verification...
bd update <id> --status open --add-label stage:verification
```
