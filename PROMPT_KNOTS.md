<!-- FOOLERY_GUIDANCE_PROMPT_START -->
## Foolery Agent Handoff Contract

This repository uses Knots (`kno`) as the source of truth for work tracking.

Required workflow:
1. Before any code/doc/commit, claim work with `kno claim <id>`.
2. Implement and validate changes in a dedicated git worktree.
3. **Run quality gates** (if code changed) - Tests, linters, builds
4. If code changed, commit and capture short hash as a tag, also adding handoff_capsule:
   `SHORT_SHA=$(git rev-parse --short HEAD); kno update <id> --add-tag "<SHORT_SHA>" --add-handoff-capsule "<summary>"`
5. If code did not change, simply add a handoff_capsule:
   `kno update <id> --add-handoff-capsule "<summary>"`
6. Do **not** move knots to terminal states unless explicitly instructed.
7. If code changed, push work to remote before ending session:
   `git pull --rebase && git push`
8. **Clean up** - Clear stashes, worktrees, prune remote branches
9. **Verify** - All changes committed AND pushed
10. **Hand off** - Provide context for next session in the knot.  If you already did this in step 4, you can skip this step.

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- FOOLERY_GUIDANCE_PROMPT_END -->
