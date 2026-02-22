# Workflow-to-Operations Map

> Surface audit of foolery workflows and the implementation-neutral backend
> operations they require.

---

## 1. Workflow Catalog

### 1.1 Bead CRUD

Create, read, update, delete individual beads.

| Entry point | Route / File | Method |
|---|---|---|
| Create Bead dialog | `src/components/create-bead-dialog.tsx` | UI |
| Bead detail page | `src/app/beads/[id]/page.tsx` | UI |
| Bead form (edit) | `src/components/bead-form.tsx` | UI |
| List beads | `GET /api/beads` | API |
| Create bead | `POST /api/beads` | API |
| Show bead | `GET /api/beads/[id]` | API |
| Update bead | `PATCH /api/beads/[id]` | API |
| Delete bead | `DELETE /api/beads/[id]` | API |
| Close bead | `POST /api/beads/[id]/close` | API |

Backend calls: `listBeads`, `searchBeads`, `createBead`, `showBead`,
`updateBead`, `deleteBead`, `closeBead` (all in `src/lib/bd.ts`).

Close triggers `regroomAncestors` (auto-close parents whose children are all
closed) via `src/lib/regroom.ts`.

Update enforces a verification edit-lock: if `transition:verification` is
present, PATCH and DELETE return 409.

### 1.2 Dependency Management

Add/remove/list dependency edges between beads.

| Entry point | Route / File | Method |
|---|---|---|
| Dep tree component | `src/components/dep-tree.tsx` | UI |
| Relationship picker | `src/components/relationship-picker.tsx` | UI |
| List deps | `GET /api/beads/[id]/deps` | API |
| Add dep | `POST /api/beads/[id]/deps` | API |
| Batch list deps | `GET /api/beads/batch-deps?ids=...` | API |

Backend calls: `listDeps`, `addDep`, `removeDep` (in `src/lib/bd.ts`).

Deps are directional: a blocker "blocks" a blocked bead. The `blocks`
relationship type is the primary edge used by the wave planner.

### 1.3 Status Transitions

State machine governing bead lifecycle.

**Statuses**: `open` | `in_progress` | `blocked` | `deferred` | `closed`

Transitions are applied via `updateBead` (field: `status`) or `closeBead`.
There is no enforced state machine in the backend -- any status can be set
directly. The following conventions are observed:

| From | To | Trigger |
|---|---|---|
| `open` | `in_progress` | Agent picks up work (`bd update --status in_progress`) |
| `in_progress` | `closed` | Verification passes or manual close |
| `in_progress` | `blocked` | External dependency discovered |
| `blocked` | `open` | Blocker resolved |
| `*` | `deferred` | User defers bead |
| `*` | `closed` | `closeBead(id, reason?)` |

**Label-driven transitions** (verification workflow, `src/lib/verification-workflow.ts`):

- `transition:verification` -- transient lock during active verification
- `stage:verification` -- bead queued/undergoing verification
- `stage:retry` -- verification failed, awaiting retry
- `attempt:N` -- monotonic counter of verification attempts
- `commit:<sha>` -- short SHA of implementing commit

Stage labels are mutually exclusive: setting one auto-removes others.

### 1.4 Sync / Collaboration

How data is synchronized between the bd CLI data store and foolery.

| Entry point | Route / File | Method |
|---|---|---|
| (implicit) | `src/lib/bd.ts` exec pipeline | Internal |

**Mechanisms**:

1. All bd commands run through a serialized execution queue per repo
   (`withRepoSerialization`) with process-level file locking.
2. Out-of-sync errors (SQLite vs JSONL drift) trigger automatic
   `bd sync --import-only` before retrying the original command.
3. Label remove operations use `--no-daemon` flag to bypass daemon persistence
   bugs, followed by a `bd sync` to flush changes.
4. Read-only commands default to `BD_NO_DB=true` (JSONL mode) to avoid
   embedded Dolt panics.
5. Commands have configurable timeouts with retry for idempotent operations.

There is no real-time push sync. The UI polls the API for fresh data.

### 1.5 Query / Filter

Searching, filtering, and sorting beads.

| Entry point | Route / File | Method |
|---|---|---|
| Filter bar | `src/components/filter-bar.tsx` | UI |
| Search bar | `src/components/search-bar.tsx` | UI |
| Bead table | `src/components/bead-table.tsx` | UI |
| URL state sync | `src/components/url-state-sync.tsx` | UI |
| List (with filters) | `GET /api/beads?status=...&q=...` | API |
| Ready beads | `GET /api/beads/ready` | API |
| Query (expression) | `POST /api/beads/query` | API |
| Client API | `src/lib/api.ts` | Client |
| App store | `src/stores/app-store.ts` | State |

**Filter dimensions**: status, type, priority, assignee, free-text search.

**Ready beads** (`/api/beads/ready`): merges `open` + `in_progress` beads,
excludes those with `stage:verification`, and filters out descendants whose
parent chain is not visible (`filterByVisibleAncestorChain`).

**Hierarchy**: `buildHierarchy` (`src/lib/bead-hierarchy.ts`) sorts beads
into parent-first DFS order with depth annotations.

**Sorting**: `src/lib/bead-sort.ts` provides natural sort with tiebreakers.

### 1.6 Breakdown / Orchestration

AI-assisted decomposition and orchestration of work.

#### 1.6.1 Breakdown (single-bead decomposition)

| Entry point | Route / File | Method |
|---|---|---|
| Breakdown view | `src/components/breakdown-view.tsx` | UI |
| Start session | `POST /api/breakdown` | API |
| Stream events | `GET /api/breakdown/[sessionId]` (SSE) | API |
| Apply plan | `POST /api/breakdown/apply` | API |
| Abort session | `DELETE /api/breakdown` | API |

Backend: `src/lib/breakdown-manager.ts`

Flow: parent bead selected -> agent spawned with decomposition prompt ->
NDJSON stream of wave drafts -> final plan -> user applies -> child beads
created under parent with wave slugs and dependency edges.

#### 1.6.2 Orchestration (multi-bead coordination)

| Entry point | Route / File | Method |
|---|---|---|
| Orchestration view | `src/components/orchestration-view.tsx` | UI |
| Existing orchestrations | `src/components/existing-orchestrations-view.tsx` | UI |
| List sessions | `GET /api/orchestration` | API |
| Start session | `POST /api/orchestration` | API |
| Stream events | `GET /api/orchestration/[sessionId]` (SSE) | API |
| Apply plan | `POST /api/orchestration/apply` | API |
| Restage plan | `POST /api/orchestration/restage` | API |
| Abort session | `DELETE /api/orchestration` | API |

Backend: `src/lib/orchestration-manager.ts`, `src/lib/orchestration-state.ts`,
`src/lib/orchestration-restage.ts`

Restaging creates a new session from a manually edited plan without re-running
the agent.

#### 1.6.3 Wave Planning

| Entry point | Route / File | Method |
|---|---|---|
| Wave planner | `src/components/wave-planner.tsx` | UI |
| Compute waves | `GET /api/waves` | API |

Backend: `src/lib/wave-planner.ts`, `src/lib/wave-slugs.ts`

Computes a dependency-ordered wave plan from all non-closed beads and their
dep edges. Classifies each bead's readiness (runnable, in_progress, blocked,
verification, gate, unschedulable) and produces a prioritized runnable queue.

### 1.7 Merge Operations

Merging two beads into one.

| Entry point | Route / File | Method |
|---|---|---|
| Merge dialog | `src/components/merge-beads-dialog.tsx` | UI |
| Merge beads | `POST /api/beads/merge` | API |

Flow: user selects survivor and consumed bead -> API fetches both ->
appends consumed description/notes/labels to survivor -> closes consumed
with reason "Merged into {survivorId}".

### 1.8 Doctor / Health

Diagnostic health checks and auto-fix.

| Entry point | Route / File | Method |
|---|---|---|
| (command palette) | `src/components/command-palette.tsx` | UI |
| Run diagnostics | `GET /api/doctor` | API |
| Stream diagnostics | `GET /api/doctor?stream=1` (NDJSON) | API |
| Fix issues | `POST /api/doctor` | API |

Backend: `src/lib/doctor.ts`

**Check categories**:

| Check | Description |
|---|---|
| `agent-ping` | Verify registered agents are reachable |
| `updates` | Check for new foolery releases |
| `settings-defaults` | Verify settings.toml has required defaults |
| `corrupt-bead-verification` | Find beads with stage:verification but wrong status |
| `stale-parent` | Find parents where all children are closed |
| `prompt-guidance` | Verify AGENTS.md/CLAUDE.md has foolery prompt |

Each diagnostic can be fixable with selectable strategies.

### 1.9 Agent History

Tracking and viewing agent interaction sessions.

| Entry point | Route / File | Method |
|---|---|---|
| Agent history view | `src/components/agent-history-view.tsx` | UI |
| Agent info bar/line | `src/components/agent-info-bar.tsx`, `agent-info-line.tsx` | UI |
| Read history | `GET /api/agent-history` | API |

Backend: `src/lib/agent-history.ts`, `src/lib/interaction-logger.ts`,
`src/lib/agent-history-types.ts`

Reads JSONL/gzipped interaction logs from disk. Each log file contains
session_start, prompt, response, and session_end events. Produces a
beat-summary view (beadId, session count, take/scene counts) and a
detailed session timeline for a selected bead.

### 1.10 Registry

Managing registered beads repositories.

| Entry point | Route / File | Method |
|---|---|---|
| Repo registry | `src/components/repo-registry.tsx` | UI |
| Repo switcher | `src/components/repo-switcher.tsx` | UI |
| Settings repos | `src/components/settings-repos-section.tsx` | UI |
| Directory browser | `src/components/directory-browser.tsx` | UI |
| List repos | `GET /api/registry` | API |
| Add repo | `POST /api/registry` | API |
| Remove repo | `DELETE /api/registry` | API |
| Browse dirs | `GET /api/registry/browse?path=...` | API |

Backend: `src/lib/registry.ts`, `src/lib/browse.ts`

Registry is a JSON file at `~/.config/foolery/registry.json`. Adding a repo
validates the presence of a `.beads/` directory.

### 1.11 Settings

Application configuration management.

| Entry point | Route / File | Method |
|---|---|---|
| Settings sheet | `src/components/settings-sheet.tsx` | UI |
| Settings sections | `src/components/settings-*-section.tsx` | UI |
| Load settings | `GET /api/settings` | API |
| Update settings | `PUT /api/settings` | API |
| List actions | `GET /api/settings/actions` | API |
| List agents | `GET /api/settings/agents` | API |
| Scan agents | `GET /api/settings/agents/scan` | API |

Backend: `src/lib/settings.ts`, `src/lib/settings-api.ts`

Settings are stored in `~/.config/foolery/settings.toml` and validated
against `foolerySettingsSchema` (Zod).

### 1.12 Terminal

Running agent commands against beads.

| Entry point | Route / File | Method |
|---|---|---|
| Terminal panel | `src/components/terminal-panel.tsx` | UI |
| Terminal store | `src/stores/terminal-store.ts` | State |
| Start session | `POST /api/terminal` | API |
| Stream output | `GET /api/terminal/[sessionId]` (SSE) | API |

Backend: `src/lib/terminal-manager.ts`, `src/lib/terminal-api.ts`

### 1.13 Version

Release version checking.

| Entry point | Route / File | Method |
|---|---|---|
| App header | `src/components/app-header.tsx` | UI |
| Check version | `GET /api/version` | API |

Backend: `src/lib/release-version.ts`

---

## 2. Operations Catalog

Implementation-neutral operation signatures derived from the workflows above.

### 2.1 Bead Operations

```
listBeads(filters?: BeadFilters, repoPath?: string) -> Bead[]
  Filters: { status?, type?, priority?, assignee?, q? (text search) }

getReadyBeads(filters?: BeadFilters, repoPath?: string) -> Bead[]
  Returns open+in_progress beads, excluding verification-locked,
  filtered by visible ancestor chain.

queryBeads(expression: string, opts?: { limit?, sort? }, repoPath?: string) -> Bead[]
  Free-form query expression against the bead store.

searchBeads(query: string, filters?: BeadFilters, repoPath?: string) -> Bead[]
  Full-text search across bead fields.

getBead(id: string, repoPath?: string) -> Bead
  Returns a single bead by ID.

createBead(input: CreateBeadInput, repoPath?: string) -> { id: string }
  Input: { title, description?, type?, priority?, labels?, assignee?,
           due?, acceptance?, notes?, parent?, estimate? }

updateBead(id: string, input: UpdateBeadInput, repoPath?: string) -> void
  Input: { title?, description?, type?, status?, priority?, parent?,
           labels? (to add), removeLabels?, assignee?, due?,
           acceptance?, notes?, estimate? }
  Enforces verification edit-lock (409 if transition:verification present).
  Stage labels are mutually exclusive (auto-removes stale stage labels).

deleteBead(id: string, repoPath?: string) -> void
  Enforces verification edit-lock.

closeBead(id: string, reason?: string, repoPath?: string) -> void
  Triggers regroomAncestors (auto-close parent chain).
```

### 2.2 Dependency Operations

```
listDeps(beadId: string, repoPath?: string, opts?: { type? }) -> BeadDependency[]

listBatchDeps(beadIds: string[], repoPath?: string) -> Record<string, BeadDependency[]>
  Batch fetch deps for multiple beads in parallel.

addDep(blockerId: string, blockedId: string, repoPath?: string) -> void
  Creates a "blocks" relationship: blockerId blocks blockedId.

removeDep(blockerId: string, blockedId: string, repoPath?: string) -> void
```

### 2.3 Hierarchy & Ancestry Operations

```
buildHierarchy(beads: Bead[], sortFn?) -> HierarchicalBead[]
  Parent-first DFS ordering with depth annotations.

filterByVisibleAncestorChain(beads: Bead[]) -> Bead[]
  Remove beads whose parent chain is not fully present in the set.

regroomAncestors(beadId: string, repoPath?: string) -> void
  Walk up the parent chain; auto-close any parent whose children
  are all closed. Cascades upward.
```

### 2.4 Merge Operations

```
mergeBeads(survivorId: string, consumedId: string, repoPath?: string)
    -> { survivorId, consumedId }
  Composite: getBead(survivor) + getBead(consumed) + updateBead(survivor,
  merged fields) + closeBead(consumed, "Merged into survivorId").
```

### 2.5 Wave Planning Operations

```
computeWavePlan(repoPath?: string) -> WavePlan
  Composite: listBeads (open+in_progress+blocked) + listDeps (all) +
  computeWaves (topological sort) + inferReadiness + computeSummary +
  computeRunnableQueue.

  Output: { waves: Wave[], unschedulable: WaveBead[], summary: WaveSummary,
            recommendation?: WaveRecommendation, runnableQueue: WaveRecommendation[],
            computedAt: string }
```

### 2.6 Breakdown Operations

```
startBreakdown(repoPath: string, parentBeadId: string) -> BreakdownSession
  Composite: getBead(parentBeadId) + spawn agent process + stream events.

streamBreakdownEvents(sessionId: string) -> AsyncStream<BreakdownEvent>
  SSE stream of log, plan, status, error, exit events.

applyBreakdownPlan(sessionId: string, repoPath: string) -> ApplyBreakdownResult
  Composite: for each wave in plan, createBead (wave container as epic) +
  addDep (chain waves sequentially) + createBead (child tasks under wave).
  Output: { createdBeadIds: string[], waveCount: number }

abortBreakdown(sessionId: string) -> void
  Sends SIGTERM/SIGKILL to agent process.
```

### 2.7 Orchestration Operations

```
startOrchestration(repoPath: string, objective?: string) -> OrchestrationSession
  Spawns agent to produce a multi-wave orchestration plan.

streamOrchestrationEvents(sessionId: string) -> AsyncStream<OrchestrationEvent>
  SSE stream of log, plan, status, error, exit events.

listOrchestrationSessions() -> OrchestrationSession[]

applyOrchestrationPlan(sessionId: string, repoPath: string,
    overrides?: { waveNames?, waveSlugs? }) -> ApplyOrchestrationResult
  Creates wave containers and child beads from the orchestration plan.
  Output: { applied: AppliedWaveResult[], skipped: string[] }

restageOrchestration(repoPath: string, plan: OrchestrationPlan,
    objective?: string) -> OrchestrationSession
  Creates a new completed session from a manually-edited plan without
  running an agent.

abortOrchestration(sessionId: string) -> void
```

### 2.8 Verification Operations

```
computeEntryLabels(currentLabels: string[]) -> { add: string[], remove: string[] }
  Idempotent: noop if transition:verification already present.

computePassLabels(currentLabels: string[]) -> { add: string[], remove: string[] }
  Removes transition and stage labels on successful verification.

computeRetryLabels(currentLabels: string[]) -> { add: string[], remove: string[] }
  Sets stage:retry, increments attempt counter.

acquireVerificationLock(beadId: string) -> boolean
releaseVerificationLock(beadId: string) -> void
hasVerificationLock(beadId: string) -> boolean

buildVerifierPrompt(ctx: VerifierPromptContext) -> string
parseVerifierResult(output: string) -> VerificationOutcome | null

isVerificationEligibleAction(action: ActionName) -> boolean
```

### 2.9 Doctor Operations

```
runDoctor() -> DoctorReport
  Runs all health checks in parallel. Output: { timestamp, diagnostics[],
  summary: { errors, warnings, infos, fixable } }

streamDoctor() -> AsyncGenerator<DoctorStreamEvent>
  Yields one event per check category, then a summary event.

runDoctorFix(strategies?: FixStrategies) -> DoctorFixReport
  Runs diagnostics, then applies fixes for approved checks.
  Output: { timestamp, fixes[], summary: { attempted, succeeded, failed } }
```

Individual checks (each returns `Diagnostic[]`):
```
checkAgents() -> Diagnostic[]
checkUpdates() -> Diagnostic[]
checkSettingsDefaults() -> Diagnostic[]
checkCorruptTickets(repos: RegisteredRepo[]) -> Diagnostic[]
checkStaleParents(repos: RegisteredRepo[]) -> Diagnostic[]
checkPromptGuidance(repos: RegisteredRepo[]) -> Diagnostic[]
```

### 2.10 Agent History Operations

```
readAgentHistory(query?: AgentHistoryQuery) -> AgentHistoryPayload
  Query: { repoPath?, beadId?, beadRepoPath?, sinceHours? }
  Output: { beats: AgentHistoryBeatSummary[], sessions: AgentHistorySession[],
            selectedBeadId?, selectedRepoPath? }
```

Supporting internal operations:
```
collectLogFiles(dir: string) -> string[]
readLogFile(filePath: string) -> string | null
  Handles .jsonl and .jsonl.gz files.
parseSession(content: string, query: AgentHistoryQuery) -> SessionParseResult | null
```

### 2.11 Registry Operations

```
listRepos() -> RegisteredRepo[]

addRepo(repoPath: string) -> RegisteredRepo
  Validates .beads/ directory exists. Prevents duplicates.

removeRepo(repoPath: string) -> void

listDirectory(dirPath?: string) -> DirEntry[]
  Browse filesystem directories, marking which contain .beads/ repos.
```

### 2.12 Settings Operations

```
loadSettings() -> FoolerySettings
  Reads and validates ~/.config/foolery/settings.toml.

updateSettings(partial: Partial<FoolerySettings>) -> FoolerySettings
  Merges and writes back to settings.toml.

getActionAgent(action: ActionName) -> RegisteredAgent
  Resolves which agent command to use for a given action.

getRegisteredAgents() -> Record<string, RegisteredAgent>

inspectSettingsDefaults() -> { fileMissing, missingPaths[], error? }
backfillMissingSettingsDefaults() -> { changed, missingPaths[], error? }

scanAgents() -> ScannedAgent[]
  Discovers available agent binaries on the system.
```

### 2.13 Terminal Operations

```
startTerminalSession(beadId: string, repoPath: string, ...) -> TerminalSession
  Spawns an agent process for interactive work on a bead.

streamTerminalOutput(sessionId: string) -> AsyncStream<TerminalEvent>
  SSE stream of stdout, stderr, exit events.
```

### 2.14 Version Operations

```
getReleaseVersionStatus(force?: boolean) -> ReleaseVersionStatus
  Output: { installedVersion, latestVersion, updateAvailable }
```

### 2.15 Cross-Repo Operations

```
fetchBeadsFromAllRepos(repos: RegisteredRepo[], filters?) -> BeadWithRepo[]
  Queries all registered repos in parallel, tags each bead with _repoPath
  and _repoName.
```

---

## 3. Workflow-to-Operations Mapping

| Workflow | Operations Used |
|---|---|
| **Bead CRUD** | `listBeads`, `searchBeads`, `getBead`, `createBead`, `updateBead`, `deleteBead`, `closeBead`, `regroomAncestors` |
| **Dependency management** | `listDeps`, `listBatchDeps`, `addDep`, `removeDep` |
| **Status transitions** | `updateBead` (status field), `closeBead`, `computeEntryLabels`, `computePassLabels`, `computeRetryLabels` |
| **Sync / collaboration** | (internal to bd.ts exec pipeline: serialization, locking, auto-sync, timeout retry) |
| **Query / filter** | `listBeads`, `searchBeads`, `queryBeads`, `getReadyBeads`, `buildHierarchy`, `filterByVisibleAncestorChain`, `fetchBeadsFromAllRepos` |
| **Breakdown** | `startBreakdown` (uses `getBead`, agent spawn), `streamBreakdownEvents`, `applyBreakdownPlan` (uses `createBead`, `addDep`), `abortBreakdown` |
| **Orchestration** | `startOrchestration`, `streamOrchestrationEvents`, `listOrchestrationSessions`, `applyOrchestrationPlan` (uses `createBead`, `addDep`), `restageOrchestration`, `abortOrchestration` |
| **Wave planning** | `computeWavePlan` (uses `listBeads`, `listDeps`, `computeWaves`, `inferReadiness`) |
| **Merge** | `mergeBeads` (uses `getBead` x2, `updateBead`, `closeBead`) |
| **Doctor / health** | `runDoctor`, `streamDoctor`, `runDoctorFix`, `checkAgents`, `checkUpdates`, `checkSettingsDefaults`, `checkCorruptTickets` (uses `listBeads`), `checkStaleParents` (uses `listBeads`), `checkPromptGuidance`, `listRepos` |
| **Agent history** | `readAgentHistory`, `collectLogFiles`, `readLogFile`, `parseSession` |
| **Registry** | `listRepos`, `addRepo`, `removeRepo`, `listDirectory` |
| **Settings** | `loadSettings`, `updateSettings`, `getActionAgent`, `getRegisteredAgents`, `inspectSettingsDefaults`, `backfillMissingSettingsDefaults`, `scanAgents` |
| **Terminal** | `startTerminalSession`, `streamTerminalOutput` |
| **Version** | `getReleaseVersionStatus` |
| **Verification** | `computeEntryLabels`, `computePassLabels`, `computeRetryLabels`, `acquireVerificationLock`, `releaseVerificationLock`, `buildVerifierPrompt`, `parseVerifierResult`, `isVerificationEligibleAction`, `updateBead` |

---

## 4. Shared Infrastructure

Operations that multiple workflows depend on:

| Infrastructure | Used By |
|---|---|
| `bd.ts` exec pipeline (serialization, locking, timeout, retry) | All bead/dep operations |
| Error suppression (`bd-error-suppression.ts`) | List, show, ready endpoints |
| Bead normalization (`normalizeBead`) | All read operations |
| Label normalization and mutual exclusion | Update, verification, doctor |
| Wave slug allocation (`wave-slugs.ts`) | Breakdown apply, orchestration apply |
| Interaction logger (`interaction-logger.ts`) | Breakdown, orchestration, terminal |
| Agent adapter (`agent-adapter.ts`) | Breakdown, orchestration, terminal |
