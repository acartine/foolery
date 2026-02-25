<!-- FOOLERY_GUIDANCE_PROMPT_START -->
## Foolery Agent Handoff Contract
FOOLERY_PROMPT_PROFILE: beads-coarse-human-gated

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
   `bd update <id> --add-label wf:state:verification`
7. Do **not** close the bead unless explicitly instructed.
8. Push work to remote before ending session:
   `git pull --rebase && bd sync && git push`
9. **Clean up** - Clear stashes, worktrees, prune remote branches
10. **Verify** - All changes committed AND pushed
11. **Hand off** - Provide context for next session as handoff capsule in the bead.

Rules:
- Never add `wf:state:verification` without `commit:<short-sha>`.
- Keep beads open for verification handoff.

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- FOOLERY_GUIDANCE_PROMPT_END -->
