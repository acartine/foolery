# Agent Instructions

This repository uses `bd` (Beads) as the single source of truth for work tracking.

## Repository Overrides

These repo-level rules are mandatory for all agents working in this project:

1. Always use Beads (`bd`) to track and coordinate work.
2. Never close Beads unless the user explicitly instructs you to close them.
3. Never use a PR workflow unless the user explicitly instructs you to use PRs.
4. Instead of closing completed work, mark it for verification with:
   `bd update <id> --add-label stage:verification`

## Beads-First Flow

```bash
bd ready
bd show <id>
bd update <id> --status in_progress
# ...do the work and run verification...
bd update <id> --add-label stage:verification
```
