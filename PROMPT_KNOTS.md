<!-- FOOLERY_GUIDANCE_PROMPT_START -->
## Foolery Agent Handoff Contract
FOOLERY_PROMPT_PROFILE: autopilot

This repository uses `kno` (Knots) as the source of truth for work tracking and `foolery` for tracking visibility.

Required workflow:
1. Pick a knot and inspect scope with `kno show <id>`.
2. Claim the knot before implementation:
   `kno claim <id> --json`
3. Follow the returned `prompt` field verbatim and run the completion command from that claim output.
4. **Run quality gates** (if code changed) - Tests, linters, builds
5. Commit and capture short hash:
   `SHORT_SHA=$(git rev-parse --short HEAD)`
6. Add handoff metadata in this order:
   `kno update <id> --add-tag commit:$SHORT_SHA`
   `kno update <id> --add-handoff-capsule "<summary>"`
7. Do **not** close the knot unless explicitly instructed.
8. Push work to remote before ending session:
   `git pull --rebase && kno sync && git push`
9. **Clean up** - Clear stashes, worktrees, prune remote branches
10. **Verify** - All changes committed AND pushed
11. **Hand off** - Provide context for next session as handoff capsule on the knot.

Rules:
- Never skip `kno claim <id>` before implementation.
- Never run manual multi-state transitions for a claimed knot.
- Stop working on a knot immediately after the claim-provided completion command succeeds.
- Keep knots open for verification handoff.

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- FOOLERY_GUIDANCE_PROMPT_END -->
