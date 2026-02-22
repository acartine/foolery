# Beads Usage Inventory

Surface audit of all beads (`bd`) touchpoints in the Foolery codebase.

**Generated:** 2026-02-22
**Bead:** foolery-1guy.1.1

---

## API Routes

All Next.js API route handlers under `src/app/api/` that interact with beads.

| Path | HTTP Methods | Purpose | Imports from `@/lib/bd` |
|------|-------------|---------|------------------------|
| `src/app/api/beads/route.ts` | GET, POST | List/search beads; create a new bead | `listBeads`, `searchBeads`, `createBead` |
| `src/app/api/beads/[id]/route.ts` | GET, PATCH, DELETE | Show, update, or delete a single bead; caches detail on lock timeouts | `showBead`, `updateBead`, `deleteBead` |
| `src/app/api/beads/[id]/close/route.ts` | POST | Close a bead with optional reason; triggers ancestor regroom | `closeBead` |
| `src/app/api/beads/[id]/deps/route.ts` | GET, POST | List dependencies for a bead; add a blocking dependency | `listDeps`, `addDep` |
| `src/app/api/beads/batch-deps/route.ts` | GET | Fetch dependencies for multiple beads in parallel | `listDeps` |
| `src/app/api/beads/query/route.ts` | POST | Execute a bd query expression against the bead store | `queryBeads` |
| `src/app/api/beads/ready/route.ts` | GET | List open + in_progress beads excluding verification queue; applies ancestor-chain filter | `listBeads` |
| `src/app/api/beads/merge/route.ts` | POST | Merge two beads: append description/notes/labels from consumed bead to survivor, close consumed | `showBead`, `updateBead`, `closeBead` |
| `src/app/api/waves/route.ts` | GET | Compute wave plan from all non-closed beads and their dependency graph | `listBeads`, `listDeps` |
| `src/app/api/breakdown/route.ts` | POST, DELETE | Start or abort a breakdown session; fetches parent bead to seed prompt | `showBead` |
| `src/app/api/terminal/route.ts` | GET, POST, DELETE | List terminal sessions; create Take!/Scene! sessions referencing bead IDs; abort sessions | (indirect via `terminal-manager`) |
| `src/app/api/agent-history/route.ts` | GET | Read agent interaction history, optionally filtered by bead ID | (indirect via `agent-history`) |
| `src/app/api/orchestration/restage/route.ts` | POST | Create a restaged orchestration session from an edited wave plan with bead references | (indirect via `orchestration-manager`) |

---

## Library / Utility Modules

Core server-side modules in `src/lib/` that wrap or support beads operations.

### `src/lib/bd.ts` -- bd CLI Wrapper (757 lines)

Primary interface to the `bd` CLI binary. All beads CRUD operations flow through this module.

| Export | Purpose | bd Commands Used |
|--------|---------|-----------------|
| `listBeads()` | List beads with filters | `bd list --json` |
| `readyBeads()` | List ready beads | `bd ready --json` |
| `searchBeads()` | Full-text search beads | `bd search <query> --json` |
| `queryBeads()` | Query beads with expression | `bd query <expr> --json` |
| `showBead()` | Fetch single bead by ID | `bd show <id> --json` |
| `createBead()` | Create a new bead | `bd create --json` |
| `updateBead()` | Update bead fields and labels | `bd update <id>`, `bd label add/remove`, `bd sync` |
| `closeBead()` | Close a bead | `bd close <id>` |
| `deleteBead()` | Delete a bead | `bd delete <id> --force` |
| `listDeps()` | List bead dependencies | `bd dep list <id> --json` |
| `addDep()` | Add blocking dependency | `bd dep <blocker> --blocks <blocked>` |
| `removeDep()` | Remove a dependency | `bd dep remove <blocked> <blocker>` |

Internal infrastructure:
- Per-repo serialization queue with file-system process locks
- Auto-sync on out-of-sync errors (`bd sync --import-only`)
- Dolt panic detection with JSONL fallback
- Configurable timeouts (read/write) with retry policy
- `--no-daemon` fallback for label operations

### `src/lib/bd-error-suppression.ts` -- Error Suppression Cache (170 lines)

| Export | Purpose |
|--------|---------|
| `withErrorSuppression()` | Wraps `BdResult<Bead[]>` with stale-while-revalidate cache for lock errors |
| `isSuppressibleError()` | Detects lock/access errors worth suppressing |
| `DEGRADED_ERROR_MESSAGE` | Constant for user-facing degraded-mode message |
| `_resetCaches()` | Test helper to clear internal caches |

### `src/lib/types.ts` -- Bead Type Definitions (315 lines)

| Type | Purpose |
|------|---------|
| `Bead` | Core bead entity (id, title, status, type, priority, labels, etc.) |
| `BeadType` | Union of bead type literals: bug, feature, task, epic, chore, merge-request, molecule, gate |
| `BeadStatus` | Union: open, in_progress, blocked, deferred, closed |
| `BeadPriority` | Literal union: 0-4 |
| `BeadDependency` | Dependency relationship between beads |
| `BdResult<T>` | Generic result wrapper (`ok`, `data`, `error`) |
| `BeadWithRepo` | Bead extended with `_repoPath` and `_repoName` for multi-repo views |
| `TerminalSession` | Terminal session tied to bead ID(s) |
| `WaveBead`, `Wave`, `WavePlan` | Wave planner types built from beads + deps |
| `OrchestrationWaveBead`, `OrchestrationWave`, `OrchestrationPlan` | Orchestration plan types referencing beads |
| `BreakdownBeadSpec`, `BreakdownWave`, `BreakdownPlan` | Breakdown plan types for decomposing beads |

### `src/lib/api.ts` -- Client-Side API Layer (188 lines)

Fetch wrappers for all `/api/beads/*` endpoints consumed by React components.

| Export | Endpoint |
|--------|----------|
| `fetchBeads()` | `GET /api/beads` |
| `fetchReadyBeads()` | `GET /api/beads/ready` |
| `queryBeads()` | `POST /api/beads/query` |
| `fetchBead()` | `GET /api/beads/:id` |
| `createBead()` | `POST /api/beads` |
| `updateBead()` | `PATCH /api/beads/:id` |
| `deleteBead()` | `DELETE /api/beads/:id` |
| `closeBead()` | `POST /api/beads/:id/close` |
| `fetchDeps()` | `GET /api/beads/:id/deps` |
| `fetchBatchDeps()` | `GET /api/beads/batch-deps` |
| `addDep()` | `POST /api/beads/:id/deps` |
| `mergeBeads()` | `POST /api/beads/merge` |
| `fetchBeadsFromAllRepos()` | Fan-out `fetchBeads` across registered repos |

### `src/lib/bead-hierarchy.ts` -- Hierarchy Builder (48 lines)

| Export | Purpose |
|--------|---------|
| `buildHierarchy()` | Sorts flat bead list into parent-first DFS order with `_depth` field |
| `HierarchicalBead` | Bead extended with `_depth` and `_hasChildren` |

### `src/lib/bead-sort.ts` -- Bead Sorting (59 lines)

| Export | Purpose |
|--------|---------|
| `naturalCompare()` | Natural string comparison for bead IDs |
| `compareBeadsByPriorityThenStatus()` | Sort comparator: priority, then status, then title |
| `compareBeadsByHierarchicalOrder()` | Sort comparator: natural ID order for siblings |

### `src/lib/bead-utils.ts` -- Bead Utilities (23 lines)

| Export | Purpose |
|--------|---------|
| `beadToCreateInput()` | Extract copyable fields from a Bead for cross-project moves |

### `src/lib/regroom.ts` -- Ancestor Auto-Close (93 lines)

| Export | Purpose |
|--------|---------|
| `regroomAncestors()` | Walk up parent hierarchy; auto-close ancestors whose children are all closed |

Uses `listBeads()` and `closeBead()` from `@/lib/bd`.

### `src/lib/ready-ancestor-filter.ts` -- Ready View Filter (35 lines)

| Export | Purpose |
|--------|---------|
| `filterByVisibleAncestorChain()` | Hide descendants whose parent chain is not in the visible set |

### `src/lib/wave-planner.ts` -- Wave Computation

| Export | Purpose |
|--------|---------|
| `computeWaves()` | Topological sort of `WaveBead[]` into dependency waves with cycle detection |

### `src/lib/wave-slugs.ts` -- Wave Label Helpers

| Export | Purpose |
|--------|---------|
| `ORCHESTRATION_WAVE_LABEL` | Constant: `"orchestration:wave"` |
| `isWaveLabel()`, `isInternalLabel()`, `isReadOnlyLabel()` | Label classification predicates |
| `isTransitionLocked()` | Check if bead is locked by `transition:verification` |
| `extractWaveSlug()`, `buildWaveSlugLabel()` | Wave slug label manipulation |
| `allocateWaveSlug()` | Allocate unique wave slug from existing beads |

### `src/lib/verification-workflow.ts` -- Verification State Machine

Label constants, state transitions, and prompt generation for auto-verification.

| Export | Purpose |
|--------|---------|
| `LABEL_TRANSITION_VERIFICATION` | `"transition:verification"` |
| `LABEL_STAGE_VERIFICATION` | `"stage:verification"` |
| `LABEL_STAGE_RETRY` | `"stage:retry"` |
| `LABEL_PREFIX_COMMIT`, `LABEL_PREFIX_ATTEMPT` | Label prefixes |
| `extractCommitLabel()` | Parse `commit:<sha>` from labels |
| `computeEntryLabels()`, `computePassLabels()`, `computeRetryLabels()` | Compute label mutations |
| `buildVerifierPrompt()` | Generate verification prompt from bead metadata |
| `parseVerifierResult()` | Parse pass/fail from verifier output |
| `acquireVerificationLock()`, `releaseVerificationLock()` | In-memory dedup locks |

### `src/lib/verification-orchestrator.ts` -- Verification Driver (388 lines)

| Export | Purpose |
|--------|---------|
| `onAgentComplete()` | Entry point: triggered after agent invocation; drives verification workflow |
| `getVerificationEvents()` | Return recent verification lifecycle events |

Uses `showBead()`, `updateBead()`, `closeBead()` from `@/lib/bd`.

### `src/lib/terminal-manager.ts` -- Terminal Session Manager (~1200 lines)

| Export | Purpose |
|--------|---------|
| `createSession()` | Create a Take! session for a single bead; spawns agent with bead context |
| `createSceneSession()` | Create a Scene! session for multiple beads |
| `abortSession()` | Abort a running terminal session |
| `listSessions()` | List all terminal sessions |

Uses `listBeads()`, `showBead()` from `@/lib/bd`. Invokes `onAgentComplete()` post-execution.

### `src/lib/terminal-api.ts` -- Client Terminal API

| Export | Purpose |
|--------|---------|
| `startSession()` | POST to create Take! session with beadId |
| `startSceneSession()` | POST to create Scene! session with beadIds |
| `abortSession()` | DELETE to abort session |
| `connectToSession()` | SSE connection for terminal output |

### `src/lib/orchestration-manager.ts` -- Orchestration Manager (~1100 lines)

| Export | Purpose |
|--------|---------|
| `createOrchestrationSession()` | Create orchestration from beads via AI planning |
| `createRestagedOrchestrationSession()` | Create orchestration from a pre-built plan |
| `applyOrchestrationSession()` | Apply plan: create child beads, set deps, assign wave labels |

Uses `addDep`, `closeBead`, `createBead`, `listBeads`, `removeDep`, `showBead`, `updateBead` from `@/lib/bd`.

### `src/lib/breakdown-manager.ts` -- Breakdown Manager (~600 lines)

| Export | Purpose |
|--------|---------|
| `createBreakdownSession()` | Start AI breakdown of a parent bead into sub-beads |
| `applyBreakdownPlan()` | Apply breakdown: create child beads under parent |

Uses `addDep`, `createBead`, `listBeads` from `@/lib/bd`.

### `src/lib/breakdown-api.ts` -- Client Breakdown API

| Export | Purpose |
|--------|---------|
| `startBreakdown()` | POST to start breakdown with parentBeadId |
| `applyBreakdown()` | POST to apply breakdown plan |
| `connectToBreakdown()` | SSE connection for breakdown events |

### `src/lib/breakdown-prompt.ts` -- Breakdown Prompt Builder

| Export | Purpose |
|--------|---------|
| `buildBeadBreakdownPrompt()` | Generate breakdown prompt from bead title/description |
| `DIRECT_PREFILL_KEY` | LocalStorage key for direct-mode bead prefill |
| `setDirectPrefillPayload()`, `consumeDirectPrefillPayload()` | Stash/retrieve bead data for direct-mode |

### `src/lib/doctor.ts` -- Health Diagnostics (~600+ lines)

| Export | Purpose |
|--------|---------|
| `runDoctor()` | Run all diagnostic checks including beads-specific ones |
| `streamDoctor()` | Stream diagnostic check results |
| `checkCorruptTickets()` | Detect beads with corrupt/missing fields |
| `checkStaleParents()` | Detect orphaned parent references |
| `checkPromptGuidance()` | Verify CLAUDE.md/AGENTS.md contain guidance prompt |
| `runDoctorFix()` | Apply fixes for detected issues |

Uses `listBeads()` from `@/lib/bd`.

### `src/lib/interaction-logger.ts` -- Interaction Log Writer

| Export | Purpose |
|--------|---------|
| `startInteractionLog()` | Create log file for agent interactions; accepts `beadIds` |
| `InteractionType` | Union includes "take", "scene", "verification", etc. |

### `src/lib/agent-history.ts` -- Agent History Reader

| Export | Purpose |
|--------|---------|
| `readAgentHistory()` | Read interaction logs, optionally filtered by `beadId` |

### `src/lib/agent-history-api.ts` -- Client Agent History API

| Export | Purpose |
|--------|---------|
| `fetchAgentHistory()` | GET agent history with optional `beadId` filter |

### `src/lib/agent-history-types.ts` -- Agent History Types

| Type | Purpose |
|------|---------|
| `AgentHistoryEntry` | Interaction log entry with `beadIds` |
| `AgentHistorySession` | Session group with `beadIds`, `interactionType` |
| `AgentHistoryBeatSummary` | Per-bead summary across sessions |

### `src/lib/browse.ts` -- Directory Browser

| Export | Purpose |
|--------|---------|
| `listDirectory()` | List directory entries; marks entries with `.beads/` as `isBeadsRepo: true` |

---

## React Components

Components in `src/components/` that consume or display beads data.

| Path | Purpose | Beads Data Consumed |
|------|---------|-------------------|
| `src/components/bead-table.tsx` | Main bead table with inline editing, hierarchy display, actions | `Bead[]`, `HierarchicalBead`, updateBead, closeBead |
| `src/components/bead-detail.tsx` | Full bead detail view with field editing, label management, dep tree | `Bead`, `UpdateBeadInput`, fetchBead, fetchDeps, updateBead, addDep |
| `src/components/bead-detail-lightbox.tsx` | Modal wrapper for BeadDetail | `Bead` (via BeadDetail) |
| `src/components/bead-form.tsx` | Create/edit bead form with Zod validation | `CreateBeadInput`, `UpdateBeadInput` |
| `src/components/bead-preview-pane.tsx` | Side panel bead preview with actions | `Bead`, fetchBead, fetchDeps, updateBead, addDep |
| `src/components/bead-columns.tsx` | Column definitions for bead table; verify/reject button handlers | `Bead`, `ColumnDef`, updateBead, closeBead |
| `src/components/bead-status-badge.tsx` | Badge component for bead status | `BeadStatus` |
| `src/components/bead-type-badge.tsx` | Badge component for bead type | `BeadType` |
| `src/components/bead-priority-badge.tsx` | Badge component for bead priority | `BeadPriority` |
| `src/components/filter-bar.tsx` | Filter controls for status/type/priority/assignee | `BeadStatus`, `BeadType`, `BeadPriority` |
| `src/components/create-bead-dialog.tsx` | Dialog for creating new beads | `createBead` from api, `CreateBeadInput` |
| `src/components/merge-beads-dialog.tsx` | Dialog to merge two beads | `mergeBeads` from api |
| `src/components/move-to-project-dialog.tsx` | Dialog to move bead to another repo | `createBead`, `deleteBead`, `fetchBeadsFromAllRepos`, `beadToCreateInput` |
| `src/components/notes-dialog.tsx` | Dialog for editing bead notes field | `Bead` notes field |
| `src/components/dep-tree.tsx` | Dependency tree visualization | `BeadDependency[]` |
| `src/components/relationship-picker.tsx` | UI for picking bead relationships/deps | `fetchBeads`, `Bead[]` |
| `src/components/retake-dialog.tsx` | Dialog to re-take a bead (retry verification) | `Bead` with label manipulation |
| `src/components/retakes-view.tsx` | View for beads in retry stage | `fetchBeads`, `updateBead`, filtered by `stage:retry` |
| `src/components/final-cut-view.tsx` | View for beads in verification stage | `fetchBeads`, filtered by `stage:verification` |
| `src/components/breakdown-view.tsx` | Breakdown session UI; generates sub-beads from parent | `startBreakdown`, `applyBreakdown`, references parentBeadId |
| `src/components/orchestration-view.tsx` | Orchestration session UI; plans wave execution of beads | Bead references in orchestration plans |
| `src/components/existing-orchestrations-view.tsx` | List existing orchestration sessions | Orchestration sessions referencing beads |
| `src/components/wave-planner.tsx` | Wave plan visualization | Fetches `/api/waves`, displays `WavePlan` with `WaveBead[]` |
| `src/components/command-palette.tsx` | Global command palette with bead search | `fetchBeads`, navigates to bead IDs |
| `src/components/search-bar.tsx` | Search bar for beads | Search query passed to bead list |
| `src/components/terminal-panel.tsx` | Terminal panel for agent sessions | `ActiveTerminal` with `beadId`, `beadIds` |
| `src/components/directory-browser.tsx` | Browse directories; identifies beads repos | `DirEntry.isBeadsRepo` |
| `src/components/repo-registry.tsx` | Manage registered repos | `RegisteredRepo[]` (repos containing `.beads/`) |
| `src/components/settings-actions-section.tsx` | Settings for action-to-agent mappings | References bead actions (take, scene, direct, breakdown) |
| `src/components/settings-repos-section.tsx` | Settings for repo management | `RegisteredRepo[]` |
| `src/components/settings-verification-section.tsx` | Settings for auto-verification toggle | Verification settings that affect bead lifecycle |
| `src/components/url-state-sync.tsx` | Sync URL params to Zustand store | Bead filter state (status, type, priority) |
| `src/components/agent-history-view.tsx` | View agent interaction history | `AgentHistoryPayload` with bead references |
| `src/components/app-header.tsx` | App header with verification badge | `useVerificationCount` for bead verification count |

---

## Hooks

Custom React hooks in `src/hooks/` that interact with beads.

| Path | Purpose |
|------|---------|
| `src/hooks/use-update-url.ts` | Sync bead filter state (status, type, priority, assignee) to URL params and Zustand store |
| `src/hooks/use-verification-count.ts` | Poll for beads with `stage:verification` label; provides count for header badge |
| `src/hooks/use-verification-notifications.ts` | Watch verification bead list for new arrivals; fire toast notifications |

---

## Stores

Zustand stores in `src/stores/` that manage beads-related state.

| Path | Purpose | Beads State |
|------|---------|-------------|
| `src/stores/app-store.ts` | Global app state: filters, active repo, view mode | `Filters` (status, type, priority, assignee), `RegisteredRepo[]`, `activeRepo` |
| `src/stores/notification-store.ts` | Notification state | `Notification` with optional `beadId`, `lastVerificationCount` |
| `src/stores/terminal-store.ts` | Terminal panel state | `ActiveTerminal` with `beadId`, `beadTitle`, `beadIds` |

---

## App Pages

Next.js page routes that display beads.

| Path | Purpose |
|------|---------|
| `src/app/page.tsx` | Root redirect to `/beads` |
| `src/app/beads/page.tsx` | Main beads dashboard: table, filters, lightbox, orchestration, breakdown, retakes, final-cut views |
| `src/app/beads/[id]/page.tsx` | Bead detail redirect: redirects `/beads/:id` to `/beads?bead=:id` |

---

## Schemas

Zod validation schemas in `src/lib/schemas.ts` for beads data.

| Schema | Purpose | Fields Validated |
|--------|---------|-----------------|
| `beadTypeSchema` | Validate bead type enum | bug, feature, task, epic, chore, merge-request, molecule, gate |
| `beadStatusSchema` | Validate bead status enum | open, in_progress, blocked, deferred, closed |
| `beadPrioritySchema` | Validate bead priority | 0, 1, 2, 3, 4 |
| `createBeadSchema` | Validate bead creation input | title (required), description, type, priority, labels, assignee, due, acceptance, notes, parent, estimate |
| `updateBeadSchema` | Validate bead update input | All create fields (optional) + removeLabels, status |
| `closeBeadSchema` | Validate bead close input | reason (optional) |
| `queryBeadSchema` | Validate bd query input | expression (required), limit, sort |
| `addDepSchema` | Validate dependency addition | blocks (required) |

Inline schema in `src/app/api/beads/merge/route.ts`:

| Schema | Purpose |
|--------|---------|
| `mergeBeadsSchema` | Validate merge input: `survivorId`, `consumedId` |

---

## Scripts

Shell scripts that reference `bd` or beads.

| Path | Purpose | bd Commands Used |
|------|---------|-----------------|
| `scripts/setup-beads-dolt-hooks.sh` | Install Dolt-native git hooks (pre-push, post-merge, post-checkout) for beads sync | `bd config set`, `bd sql`, `bd vc commit`, `bd hooks list`, `bd doctor` |
| `scripts/setup.sh` | Interactive repo discovery and agent configuration wizard | Scans for `.beads/` directories; no direct `bd` invocations |
| `scripts/install.sh` | Foolery installer | Checks `bd` is on PATH (line 1207) |
| `scripts/agent-wizard.sh` | Agent discovery wizard | References bead actions in prompts ("execute single bead", "multi-bead orchestration") |

---

## Config / Infrastructure

Configuration and infrastructure files that reference beads.

| Path | Purpose |
|------|---------|
| `.beads/config.yaml` | Beads repository configuration: sync-branch (`beads-sync`), git-remote, daemon, JSONL settings |
| `.beads/metadata.json` | Database metadata: backend=dolt, embedded mode, database name (`beads_foolery`) |
| `.beads/issues.jsonl` | JSONL issue database (source of truth for beads data) |
| `.beads/.gitignore` | Ignores SQLite DBs, daemon files, Dolt database, merge artifacts, sync state |
| `.beads/README.md` | Beads directory documentation |
| `.gitattributes` | Custom merge driver: `.beads/issues.jsonl merge=beads` |
| `CLAUDE.md` | Agent instructions: mandates `bd` usage, handoff contract with `bd update`/`bd sync` commands |
| `AGENTS.md` | Agent instructions (subset of CLAUDE.md): `bd show`, `bd update`, `bd sync` commands |
| `PROMPT.md` | Guidance prompt template appended to repo CLAUDE.md/AGENTS.md during setup: `bd show`, `bd update`, `bd sync` |
| `.claude/settings.local.json` | Claude Code local settings (may reference beads repo paths) |

---

## Tests

Test files in `src/lib/__tests__/` that exercise beads modules.

| Path | Module Under Test |
|------|------------------|
| `src/lib/__tests__/bd.test.ts` | `bd.ts` -- core bd CLI wrapper |
| `src/lib/__tests__/bd-error-suppression.test.ts` | `bd-error-suppression.ts` |
| `src/lib/__tests__/bd-error-suppression-extended.test.ts` | Extended error suppression scenarios |
| `src/lib/__tests__/bd-uncovered.test.ts` | Uncovered bd.ts edge cases |
| `src/lib/__tests__/bd-update-labels.test.ts` | Label add/remove in updateBead |
| `src/lib/__tests__/bd-read-no-db.test.ts` | JSONL-only read mode |
| `src/lib/__tests__/bd-serialization.test.ts` | Repo serialization queue |
| `src/lib/__tests__/bd-timeout.test.ts` | Timeout/retry behavior |
| `src/lib/__tests__/bd-auto-import-sync.test.ts` | Auto-import sync on out-of-sync errors |
| `src/lib/__tests__/bead-hierarchy.test.ts` | Hierarchy builder |
| `src/lib/__tests__/bead-sort.test.ts` | Bead sorting comparators |
| `src/lib/__tests__/bead-sort-tiebreaker.test.ts` | Sort tiebreaker edge cases |
| `src/lib/__tests__/bead-review-fields.test.ts` | Review field extraction |
| `src/lib/__tests__/bead-columns-helpers.test.ts` | Column helper functions |
| `src/lib/__tests__/breakdown-prompt.test.ts` | Breakdown prompt generation |
| `src/lib/__tests__/doctor.test.ts` | Doctor diagnostics |
| `src/lib/__tests__/doctor-applyfix.test.ts` | Doctor fix application |
| `src/lib/__tests__/ready-ancestor-filter.test.ts` | Ready ancestor-chain filter |
| `src/lib/__tests__/ready-ancestor-cycle.test.ts` | Cycle detection in ancestor filter |
| `src/lib/__tests__/verification-orchestrator.test.ts` | Verification orchestrator |
| `src/lib/__tests__/verification-workflow.test.ts` | Verification state machine |
| `src/lib/__tests__/agent-history.test.ts` | Agent history reader |

---

## Storybook Stories

Storybook stories in `src/stories/` for beads UI components.

| Path | Component |
|------|-----------|
| `src/stories/bead-status-badge.stories.tsx` | BeadStatusBadge |
| `src/stories/bead-type-badge.stories.tsx` | BeadTypeBadge |
| `src/stories/bead-priority-badge.stories.tsx` | BeadPriorityBadge |
| `src/stories/bead-table.stories.tsx` | BeadTable |
| `src/stories/bead-form.stories.tsx` | BeadForm |
| `src/stories/command-palette.stories.tsx` | CommandPalette (bead search) |

---

## Summary

| Category | Count |
|----------|-------|
| API Routes (direct beads) | 8 |
| API Routes (indirect beads) | 5 |
| Library Modules (beads-specific) | 8 |
| Library Modules (beads-consuming) | 12 |
| React Components | 30 |
| Hooks | 3 |
| Stores | 3 |
| Scripts | 4 |
| Config/Infrastructure Files | 9 |
| Schemas (Zod) | 8 |
| Tests | 22 |
| Stories | 6 |
| **Total touchpoints** | **118** |
