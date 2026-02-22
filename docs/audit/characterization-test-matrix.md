# Characterization Test Matrix

This matrix catalogs the testable behaviors of the beads subsystem that must be
locked before the separation work begins. Each test case captures **current**
behavior so that post-refactor parity can be verified mechanically.

## Conventions

- **Priority**: `must-have` = blocks separation, `nice-to-have` = coverage gap, not blocking.
- **Status**: `scaffolded` = `it.todo()` stub exists, `implemented` = assertion-complete,
  `existing` = already covered in the current test suite, `pending` = not yet written.
- **Test file**: `src/lib/__tests__/beads-characterization.test.ts` unless noted.

---

## 1. Library -- bd.ts (CLI wrapper)

| ID       | Description                                                    | Input / Preconditions                           | Expected Behavior (current)                             | Priority   | Status   |
|----------|----------------------------------------------------------------|-------------------------------------------------|---------------------------------------------------------|------------|----------|
| LIB-001  | `normalizeBead` maps `issue_type` to `type`                   | Raw JSON with `issue_type: "bug"`               | `bead.type === "bug"`                                   | must-have  | existing |
| LIB-002  | `normalizeBead` defaults `status` to `"open"`                 | Raw JSON missing `status`                       | `bead.status === "open"`                                | must-have  | existing |
| LIB-003  | `normalizeBead` defaults `type` to `"task"`                   | Raw JSON missing `issue_type` and `type`        | `bead.type === "task"`                                  | must-have  | existing |
| LIB-004  | `normalizeBead` maps `created_at`/`updated_at`                | Raw JSON with `created_at`, `updated_at`        | `bead.created`, `bead.updated` set                      | must-have  | existing |
| LIB-005  | `normalizeBead` maps `acceptance_criteria`                    | Raw JSON with `acceptance_criteria`             | `bead.acceptance` set                                   | must-have  | existing |
| LIB-006  | `normalizeBead` maps `estimated_minutes`                      | Raw JSON with `estimated_minutes: 60`           | `bead.estimate === 60`                                  | must-have  | existing |
| LIB-007  | `normalizeBead` filters empty labels                          | Labels array `["a","","  ","b"]`                | `bead.labels === ["a","b"]`                             | must-have  | existing |
| LIB-008  | `inferParent` from `dependencies` array                       | Dependencies with `type:"parent-child"`         | Returns `depends_on_id`                                 | must-have  | existing |
| LIB-009  | `inferParent` from dot-notation ID                            | ID `"proj.child"`, no deps                      | Returns `"proj"`                                        | must-have  | existing |
| LIB-010  | `inferParent` prefers explicit parent over deps               | Explicit parent set                             | Returns explicit value                                  | must-have  | scaffolded |
| LIB-011  | `inferParent` returns undefined for top-level IDs             | ID `"proj-abc"`, no deps, no explicit           | Returns `undefined`                                     | must-have  | scaffolded |
| LIB-012  | `listBeads` passes `--all` when no status filter              | No filters                                      | CLI args contain `--all`                                | must-have  | existing |
| LIB-013  | `listBeads` omits `--all` when status filter present          | `{ status: "open" }`                            | CLI args contain `--status open`, not `--all`           | must-have  | existing |
| LIB-014  | `searchBeads` maps priority to min/max                        | `{ priority: "1" }`                             | `--priority-min 1 --priority-max 1`                     | must-have  | existing |
| LIB-015  | `createBead` joins labels with comma                          | `{ labels: ["a","b"] }`                         | `--labels a,b`                                          | must-have  | existing |
| LIB-016  | `createBead` falls back to raw stdout as ID                   | Non-JSON stdout                                 | Returns stdout as `data.id`                             | must-have  | existing |
| LIB-017  | Auto-sync on out-of-sync error                                | First call returns out-of-sync                  | Runs `sync --import-only`, retries                      | must-have  | existing |
| LIB-018  | `isReadOnlyCommand` classification                            | Various command names                           | Correctly identifies read-only vs write commands         | must-have  | scaffolded |
| LIB-019  | `isIdempotentWriteCommand` classification                     | Various command/subcommand pairs                | Correctly identifies idempotent writes                   | must-have  | scaffolded |
| LIB-020  | `canRetryAfterTimeout` returns true for reads+idem writes     | Read commands and idempotent write commands      | Returns true                                            | must-have  | scaffolded |
| LIB-021  | `shouldUseNoDbByDefault` respects env vars                    | Various env flag combos                         | Returns correct boolean                                 | nice-to-have | scaffolded |
| LIB-022  | `updateBead` stage label mutual exclusivity                   | Adding `stage:verification` with existing stage | Old stage label auto-removed                            | must-have  | scaffolded |
| LIB-023  | `updateBead` label normalize deduplication                    | Duplicate labels in add array                   | Deduped before CLI call                                 | must-have  | scaffolded |

## 2. Library -- bd-error-suppression.ts

| ID       | Description                                                    | Input / Preconditions                           | Expected Behavior (current)                             | Priority   | Status   |
|----------|----------------------------------------------------------------|-------------------------------------------------|---------------------------------------------------------|------------|----------|
| SUP-001  | `isSuppressibleError` matches lock patterns                   | Error string `"database is locked"`             | Returns `true`                                          | must-have  | existing |
| SUP-002  | `isSuppressibleError` rejects unknown errors                  | Error string `"parse failed"`                   | Returns `false`                                         | must-have  | existing |
| SUP-003  | Success clears failure state and updates cache                | Previous failure then success                   | Failure state cleared, cache updated                    | must-have  | existing |
| SUP-004  | First failure returns cached data                             | Cached data exists, first suppressible error    | Returns cached data silently                            | must-have  | existing |
| SUP-005  | Failures beyond window return degraded message                | Continuous failures > 2 minutes                 | Returns `DEGRADED_ERROR_MESSAGE`                        | must-have  | existing |
| SUP-006  | Cache eviction on MAX_CACHE_ENTRIES                           | 65 cache entries                                | Oldest entry evicted                                    | must-have  | existing |
| SUP-007  | Cache TTL expiry                                              | Cache entry > 10 minutes old                    | Entry evicted, raw error returned                       | must-have  | scaffolded |
| SUP-008  | Non-suppressible errors pass through immediately              | Parse error with cached data                    | Returns raw error, ignores cache                        | must-have  | scaffolded |
| SUP-009  | No cached data on first lock error returns degraded           | No prior cache, lock error                      | Returns `DEGRADED_ERROR_MESSAGE`                        | must-have  | scaffolded |

## 3. Library -- bead-sort.ts

| ID       | Description                                                    | Input / Preconditions                           | Expected Behavior (current)                             | Priority   | Status   |
|----------|----------------------------------------------------------------|-------------------------------------------------|---------------------------------------------------------|------------|----------|
| SRT-001  | `naturalCompare` sorts numerically                            | `"bead-2"` vs `"bead-10"`                       | `"bead-2" < "bead-10"`                                  | must-have  | implemented |
| SRT-002  | `naturalCompare` sorts text segments lexicographically        | `"alpha-1"` vs `"beta-1"`                       | `"alpha-1" < "beta-1"`                                  | must-have  | implemented |
| SRT-003  | `naturalCompare` handles equal strings                        | Same string twice                               | Returns `0`                                             | must-have  | implemented |
| SRT-004  | `compareBeadsByPriorityThenStatus` primary sort by priority   | Two beads, different priority                   | Lower priority number first                             | must-have  | implemented |
| SRT-005  | `compareBeadsByPriorityThenStatus` secondary sort by status   | Same priority, open vs closed                   | Open before closed                                      | must-have  | implemented |
| SRT-006  | `compareBeadsByPriorityThenStatus` tertiary sort by title     | Same priority+status, different titles          | Alphabetical by title                                   | must-have  | implemented |
| SRT-007  | `compareBeadsByPriorityThenStatus` quaternary sort by ID      | Same priority+status+title, different IDs       | Alphabetical by ID                                      | must-have  | implemented |
| SRT-008  | `compareBeadsByHierarchicalOrder` delegates to naturalCompare | Two beads with sequential IDs                   | Natural order by ID                                     | must-have  | scaffolded |

## 4. Library -- bead-hierarchy.ts

| ID       | Description                                                    | Input / Preconditions                           | Expected Behavior (current)                             | Priority   | Status   |
|----------|----------------------------------------------------------------|-------------------------------------------------|---------------------------------------------------------|------------|----------|
| HIR-001  | Flat list of root beads has depth 0                           | Beads with no parent                            | All `_depth === 0`                                      | must-have  | implemented |
| HIR-002  | Children nested under parent                                  | Parent + child with matching parent field       | Child `_depth === 1`, after parent                      | must-have  | implemented |
| HIR-003  | Three-level nesting                                           | Grandparent -> parent -> child                  | Depths 0, 1, 2                                         | must-have  | implemented |
| HIR-004  | Orphaned children treated as top-level                        | Child with parent not in dataset                | `_depth === 0`                                          | must-have  | implemented |
| HIR-005  | Circular references skipped                                   | Two beads pointing to each other as parent      | No infinite loop, all beads in result                   | must-have  | scaffolded |
| HIR-006  | `_hasChildren` flag set correctly                             | Mix of parents and leaf beads                   | Parents have `true`, leaves have `false`                | must-have  | implemented |
| HIR-007  | `sortChildren` comparator reorders siblings                   | Custom comparator provided                      | Siblings sorted within parent group                     | must-have  | scaffolded |

## 5. Library -- bead-utils.ts

| ID       | Description                                                    | Input / Preconditions                           | Expected Behavior (current)                             | Priority   | Status   |
|----------|----------------------------------------------------------------|-------------------------------------------------|---------------------------------------------------------|------------|----------|
| UTL-001  | `beadToCreateInput` extracts copyable fields                  | Full Bead object                                | Returns CreateBeadInput with correct fields              | must-have  | implemented |
| UTL-002  | `beadToCreateInput` excludes id, parent, status, timestamps   | Full Bead object                                | Output lacks `id`, `parent`, `status`, `created`, etc.  | must-have  | implemented |

## 6. Library -- ready-ancestor-filter.ts

| ID       | Description                                                    | Input / Preconditions                           | Expected Behavior (current)                             | Priority   | Status   |
|----------|----------------------------------------------------------------|-------------------------------------------------|---------------------------------------------------------|------------|----------|
| RAF-001  | Top-level beads always visible                                | Beads with no parent                            | All included in result                                  | must-have  | scaffolded |
| RAF-002  | Child with parent in set is visible                           | Parent + child both in array                    | Child included                                          | must-have  | scaffolded |
| RAF-003  | Child with missing parent is hidden                           | Child whose parent is not in array              | Child excluded                                          | must-have  | scaffolded |
| RAF-004  | Grandchild with broken chain is hidden                        | Grandchild present, parent missing              | Grandchild excluded                                     | must-have  | scaffolded |
| RAF-005  | Circular parent chain handled safely                          | Two beads referencing each other                | No infinite loop, excluded                              | must-have  | scaffolded |

## 7. Library -- schemas.ts (Zod validation)

| ID       | Description                                                    | Input / Preconditions                           | Expected Behavior (current)                             | Priority   | Status   |
|----------|----------------------------------------------------------------|-------------------------------------------------|---------------------------------------------------------|------------|----------|
| SCH-001  | `createBeadSchema` requires title                             | Empty object                                    | Validation fails                                        | must-have  | scaffolded |
| SCH-002  | `createBeadSchema` defaults type to "task"                    | `{ title: "x" }`                                | `parsed.data.type === "task"`                           | must-have  | scaffolded |
| SCH-003  | `createBeadSchema` defaults priority to 2                     | `{ title: "x" }`                                | `parsed.data.priority === 2`                            | must-have  | scaffolded |
| SCH-004  | `updateBeadSchema` all fields optional                        | Empty object                                    | Validation passes                                       | must-have  | scaffolded |
| SCH-005  | `beadTypeSchema` accepts all valid types                      | Each of the 8 bead types                        | All accepted                                            | must-have  | scaffolded |
| SCH-006  | `beadStatusSchema` accepts all valid statuses                 | Each of the 5 bead statuses                     | All accepted                                            | must-have  | scaffolded |
| SCH-007  | `beadPrioritySchema` accepts 0-4                              | Each of 0, 1, 2, 3, 4                           | All accepted                                            | must-have  | scaffolded |
| SCH-008  | `queryBeadSchema` requires expression                         | Empty object                                    | Validation fails                                        | must-have  | scaffolded |

## 8. Library -- verification-workflow.ts

| ID       | Description                                                    | Input / Preconditions                           | Expected Behavior (current)                             | Priority   | Status   |
|----------|----------------------------------------------------------------|-------------------------------------------------|---------------------------------------------------------|------------|----------|
| VRF-001  | `extractCommitLabel` returns SHA                              | Labels `["commit:abc123"]`                      | Returns `"abc123"`                                      | must-have  | scaffolded |
| VRF-002  | `extractCommitLabel` returns null when missing                | Labels `["stage:verification"]`                 | Returns `null`                                          | must-have  | scaffolded |
| VRF-003  | `extractAttemptNumber` returns number                         | Labels `["attempt:3"]`                          | Returns `3`                                             | must-have  | scaffolded |
| VRF-004  | `extractAttemptNumber` returns 0 when missing                 | Empty labels                                    | Returns `0`                                             | must-have  | scaffolded |
| VRF-005  | `computeEntryLabels` is idempotent                            | Already has `transition:verification`           | Returns empty add/remove                                | must-have  | scaffolded |
| VRF-006  | `computeEntryLabels` adds transition + stage                  | No existing verification labels                 | Adds both labels                                        | must-have  | scaffolded |
| VRF-007  | `computeEntryLabels` removes stage:retry on re-entry          | Has `stage:retry`                               | Removes retry, adds transition+stage                    | must-have  | scaffolded |
| VRF-008  | `computePassLabels` removes transition + stage                | Has both verification labels                    | Removes both                                            | must-have  | scaffolded |
| VRF-009  | `computeRetryLabels` increments attempt counter               | Has `attempt:1`                                 | Removes `attempt:1`, adds `attempt:2`                   | must-have  | scaffolded |
| VRF-010  | `parseVerifierResult` extracts outcome                        | Output containing `VERIFICATION_RESULT:pass`    | Returns `"pass"`                                        | must-have  | scaffolded |
| VRF-011  | `parseVerifierResult` returns null for no match               | Output without result line                      | Returns `null`                                          | must-have  | scaffolded |
| VRF-012  | `isVerificationEligibleAction` classifies actions             | `"take"`, `"scene"`, `"breakdown"`, `"direct"`  | take+scene eligible, breakdown+direct not               | must-have  | scaffolded |
| VRF-013  | `acquireVerificationLock` prevents double-acquire             | Acquire same bead twice                         | Second returns false                                    | must-have  | scaffolded |
| VRF-014  | `acquireVerificationLock` allows re-acquire after stale       | Lock older than 10 minutes                      | Returns true                                            | must-have  | scaffolded |
| VRF-015  | `buildVerifierPrompt` includes all context fields             | Full context object                             | Prompt contains bead ID, title, SHA, description, etc.  | must-have  | scaffolded |

## 9. Library -- regroom.ts

| ID       | Description                                                    | Input / Preconditions                           | Expected Behavior (current)                             | Priority   | Status   |
|----------|----------------------------------------------------------------|-------------------------------------------------|---------------------------------------------------------|------------|----------|
| RGM-001  | Auto-closes parent when all children closed                   | Parent with 2 children, both closed             | Parent closed via `closeBead`                           | must-have  | scaffolded |
| RGM-002  | Does not close parent when some children open                 | Parent with 1 open and 1 closed child           | Parent remains open                                     | must-have  | scaffolded |
| RGM-003  | Cascades up multiple levels                                   | Grandparent -> parent -> child, all closed      | Both parent and grandparent closed                      | must-have  | scaffolded |
| RGM-004  | Stops cascading when ancestor has open children               | Mixed ancestry                                  | Only fully-closed ancestors are closed                  | must-have  | scaffolded |
| RGM-005  | Swallows errors without propagating                           | `listBeads` fails                               | No exception thrown                                     | must-have  | scaffolded |

## 10. Library -- api.ts (client-side API wrappers)

| ID       | Description                                                    | Input / Preconditions                           | Expected Behavior (current)                             | Priority   | Status   |
|----------|----------------------------------------------------------------|-------------------------------------------------|---------------------------------------------------------|------------|----------|
| API-001  | `fetchBeads` builds correct query string                      | Params `{ status: "open" }`, repo path          | Fetches `GET /api/beads?status=open&_repo=...`          | nice-to-have | scaffolded |
| API-002  | `fetchReadyBeads` calls `/api/beads/ready`                    | No params                                       | Fetches correct endpoint                                | nice-to-have | scaffolded |
| API-003  | `createBead` sends POST with body                             | CreateBeadInput                                 | POST to `/api/beads` with JSON body                     | nice-to-have | scaffolded |
| API-004  | `mergeBeads` sends POST with survivorId/consumedId            | Two bead IDs                                    | POST to `/api/beads/merge` with body                    | nice-to-have | scaffolded |
| API-005  | `fetchBeadsFromAllRepos` fans out and merges                  | Two registered repos                            | Returns beads from both repos with `_repoPath`          | nice-to-have | scaffolded |
| API-006  | Error response maps to `{ ok: false }`                        | fetch returns 500                               | Result `ok === false`                                   | nice-to-have | scaffolded |

## 11. Stores -- app-store.ts (beads filter state)

| ID       | Description                                                    | Input / Preconditions                           | Expected Behavior (current)                             | Priority   | Status   |
|----------|----------------------------------------------------------------|-------------------------------------------------|---------------------------------------------------------|------------|----------|
| STR-001  | Initial filter is `{ status: "ready" }`                       | Fresh store                                     | `filters.status === "ready"`                            | must-have  | scaffolded |
| STR-002  | `setFilter` updates single key                                | Call `setFilter("type", "bug")`                 | `filters.type === "bug"`                                | must-have  | scaffolded |
| STR-003  | `resetFilters` returns to defaults                            | Filters modified, then reset                    | `filters === { status: "ready" }`                       | must-have  | scaffolded |
| STR-004  | `setActiveRepo` persists to localStorage                      | Call `setActiveRepo("/path")`                   | `activeRepo` set, persisted                             | nice-to-have | scaffolded |

---

## Coverage Summary

| Category                  | Total | Must-Have | Implemented | Scaffolded | Existing | Pending |
|---------------------------|-------|-----------|-------------|------------|----------|---------|
| Library (bd.ts)           | 23    | 21        | 0           | 6          | 17       | 0       |
| Error Suppression         | 9     | 9         | 0           | 3          | 6        | 0       |
| Bead Sort                 | 8     | 8         | 7           | 1          | 0        | 0       |
| Bead Hierarchy            | 7     | 7         | 6           | 1          | 0        | 0       |
| Bead Utils                | 2     | 2         | 2           | 0          | 0        | 0       |
| Ready Ancestor Filter     | 5     | 5         | 0           | 5          | 0        | 0       |
| Schemas                   | 8     | 8         | 0           | 8          | 0        | 0       |
| Verification Workflow     | 15    | 15        | 0           | 15         | 0        | 0       |
| Regroom                   | 5     | 5         | 0           | 5          | 0        | 0       |
| API (client)              | 6     | 0         | 0           | 6          | 0        | 0       |
| Stores                    | 4     | 3         | 0           | 4          | 0        | 0       |
| **Total**                 | **92**| **83**    | **15**      | **54**     | **23**   | **0**   |

**Notes:**
- "Existing" means the test already exists in `src/lib/__tests__/bd.test.ts` or other existing test files.
- "Implemented" tests are new, assertion-complete tests in the characterization file.
- "Scaffolded" tests are `it.todo()` stubs that need implementation.
- The characterization test file focuses on behaviors not covered by existing tests.
