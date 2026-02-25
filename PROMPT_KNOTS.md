<!-- FOOLERY_GUIDANCE_PROMPT_START -->
## Foolery Agent Handoff Contract
FOOLERY_PROMPT_PROFILE: knots-granular-autonomous

This repository uses `knots` as the source of truth for work tracking and `foolery` for tracking visibility.

Required workflow:
1. Pick a knot and inspect scope with `knots show <id>`.
2. Before any code/doc/commit, move to active state:
   `knots update <id> --status implementing`
3. Implement and validate changes in a dedicated git worktree.
4. **Run quality gates** (if code changed) - Tests, linters, builds
5. Commit and capture short hash:
   `SHORT_SHA=$(git rev-parse --short HEAD)`
6. Add handoff tags in this order:
   `knots update <id> --add-tag commit:$SHORT_SHA`
   `knots update <id> --status reviewing`
7. Do **not** close the knot unless explicitly instructed.
8. Push work to remote before ending session:
   `git pull --rebase && knots sync && git push`
9. **Clean up** - Clear stashes, worktrees, prune remote branches
10. **Verify** - All changes committed AND pushed
11. **Hand off** - Provide context for next session as handoff capsule on the knot.

Rules:
- Never move to `reviewing` without `commit:<short-sha>`.
- Keep knots open for verification handoff.

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- FOOLERY_GUIDANCE_PROMPT_END -->
