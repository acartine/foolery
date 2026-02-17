<!-- FOOLERY_GUIDANCE_PROMPT_START -->
## Foolery Agent Handoff Contract

This repository uses `bd` (Beads) as the source of truth for work tracking.

Required workflow:
1. Pick a bead and inspect scope with `bd show <id>`.
2. Before any code/doc/commit, set status:
   `bd update <id> --status in_progress`
3. Implement and validate changes in a dedicated git worktree.
4. Commit and capture short hash:
   `SHORT_SHA=$(git rev-parse --short HEAD)`
5. Add handoff labels in this order:
   `bd update <id> --add-label commit:$SHORT_SHA`
   `bd update <id> --add-label stage:verification`
6. Do **not** close the bead unless explicitly instructed.
7. Push work to remote before ending session:
   `git pull --rebase && bd sync && git push`

Rules:
- Never add `stage:verification` without `commit:<short-sha>`.
- Keep beads open for verification handoff.
- Do not use PR/review workflow unless explicitly requested.
<!-- FOOLERY_GUIDANCE_PROMPT_END -->
