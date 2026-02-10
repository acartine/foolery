# CLAUDE.md

Repository-scoped policy for all agents in this project.

## Mandatory Rules

1. Use Beads (`bd`) for all task tracking and coordination.
2. Do not close any Bead unless the user explicitly tells you to close it.
3. Do not use or require PRs unless the user explicitly requests a PR workflow.
4. When work is complete, move it to verification by labeling it:
   `bd update <id> --add-label stage:verification`

## Standard Flow

```bash
bd ready
bd show <id>
bd update <id> --status in_progress
# ...implement and validate...
bd update <id> --add-label stage:verification
```
