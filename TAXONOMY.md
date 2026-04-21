# Foolery Taxonomy

> Shared vocabulary for this codebase. Humans: edit freely — your definitions win.
> Agents: read before writing code. Update via `/taxonomize` (preserves human edits).

Last auto-run: 2026-04-16 · Scope: `/` (full repo)

## How to read this file

- **Nouns** are domain entities and concepts.
- **Verbs** are operations performed on nouns.
- **Phrases** are compound terms that carry more meaning than their parts.
- Citations like `path/file.ext:42` anchor each term to real usage.
- `<!-- human -->` marks hand-written entries; `<!-- auto -->` marks generated ones.
- ⚠ markers flag things to review: `overloaded`, `ambiguous`, `stale`, `divergence`.

---

## Nouns

### Action <!-- auto -->
A dispatchable agent operation mapped to one or more agents. One of `take`, `scene`, `scopeRefinement`.
- `src/lib/types.ts:382` — `ActionName` union
- `src/lib/schemas.ts:134` — action schema

### ActionOwnerKind <!-- auto -->
Who is responsible for the next action on a beat: `agent`, `human`, or `none`.
- `src/lib/types.ts:18`

### Agent <!-- auto -->
An autonomous LLM-driven CLI (claude, copilot, codex, gemini, opencode) that Foolery launches and monitors through a terminal session.
- `README.md:106`
- `src/lib/types.ts:365` — `RegisteredAgent`

### Agent Dialect <!-- auto -->
The specific CLI flavor of an agent, which determines command shape, output parsing, and event naming. See also: `AgentProviderId`.
- `README.md:108`
- `src/lib/agent-identity.ts:3`

### Agent Pool <!-- auto -->
A weighted list of agents eligible for a given workflow step under advanced dispatch. See `PoolEntry`.
- `src/lib/types.ts:494`
- `README.md:130`

### AutoRoutingBackend <!-- auto -->
Per-repo meta-backend that picks the concrete `BackendPort` implementation (Knots, Beads, stub) based on memory-manager marker directories.
- `src/lib/backend-factory.ts:27`
- `ARCHITECTURE.md:14`

### Backend <!-- auto --> ⚠ overloaded
Memory-manager abstraction that implements `BackendPort` (Knots, Beads, stub). Separate from the *execution backend* (see Review Queue).
- `src/lib/backend-port.ts:122`
- `docs/FOOLERY_AGENT_MEMORY_CONTRACT.md:1`

### BackendCapabilities <!-- auto -->
Feature-flag matrix declared by each backend (`canCreate`, `canUpdate`, `canClose`, `canSearch`, etc.) used to branch UI and API behavior.
- `src/lib/backend-capabilities.ts:10`

### BackendError <!-- auto --> ⚠ overloaded
Error taxonomy returned by backends. Exists as both an interface shape (`BackendPort`-level) and an Error subclass (runtime).
- `src/lib/backend-port.ts:24` — interface form
- `src/lib/backend-errors.ts:52` — class form

### BackendPort <!-- auto -->
The core interface every memory-manager backend must implement: list/search/query/get/create/update/close/delete of beats, dependency ops, prompt building.
- `src/lib/backend-port.ts:122`

### BackendResult <!-- auto -->
Envelope returned by every `BackendPort` method: `{ ok, data?, error? }` where error is a `BackendError`.
- `src/lib/backend-port.ts:43`

### Bead <!-- auto -->
A work item in the Beads backend. Semantically equivalent to a Beat in the UI. Stored as `RawBead` in JSONL on disk.
- `src/lib/backends/beads-jsonl-dto.ts:21`
- Aliases: `Beat` (UI-side), `Knot` (Knots backend)

### Beat <!-- auto -->
The UI-level unit of work — a single task with state, priority, labels, dependencies, and workflow assignment. Foolery's internal abstraction; translated to `knot_id` / `bead_id` at backend boundaries.
- `src/lib/types.ts:63`
- `docs/MANIFEST.md:550`
- Aliases: `Knot` (Knots backend), `Bead` (Beads backend)

### BeatPriority <!-- auto -->
Integer severity 0 (lowest) through 4 (emergency/blocker).
- `src/lib/types.ts:12`
- `src/lib/schemas.ts:23`

### BeatType <!-- auto -->
Open string categorization of a beat: `work`, `task`, `bug`, `feature`, `chore`, `epic`, `merge-request`, `molecule`, `gate`.
- `src/lib/types.ts:10`
- `docs/MANIFEST.md:156`

### Capsule <!-- auto -->
Bundled session artifact (context, output, metadata) produced at handoff between agents or between agent and human.
- `src/lib/knots.ts:164` — `handoff_capsules` in `KnotUpdateInput`
- `README.md:152`

### Dependency <!-- auto -->
Typed edge between beats: `blocks`, `blocked_by`, or `parent_of`.
- `src/lib/types.ts:93` — `BeatDependency`
- `src/lib/knots.ts:158` — `KnotEdge`

### DirEntry <!-- auto -->
A browsable directory entry annotated with memory-manager type and Foolery compatibility flags.
- `src/lib/types.ts:121`

### Dispatch <!-- auto -->
The mechanism that picks which agent runs a given action — either per-action mapping (`basic`) or weighted per-step pool (`advanced`).
- `README.md:120`
- `src/lib/agent-pool.ts`

### DispatchMode <!-- auto -->
`basic` (one agent per action) or `advanced` (weighted pools per workflow step).
- `src/lib/schemas.ts:240`
- `README.md:121`

### Doctor <!-- auto -->
Diagnostic subsystem that inspects repo and settings health, reports issues, and optionally applies fixes.
- `src/lib/doctor.ts`
- `README.md:224`

### ExecutionLease <!-- auto -->
Active work assignment held by an agent for a beat. Carries lease id, claimed flag, completion action, and rollback action.
- `src/lib/execution-port.ts:25`

### ExecutionMode <!-- auto -->
How a lease is being exercised: `take` (single beat), `scene` (orchestrated multi-beat), or `poll` (opportunistic claim).
- `src/lib/execution-port.ts:5`

### ExecutionPlan <!-- auto -->
Knots-native staged plan: waves of beats assigned to agents, persisted alongside the knot record. Distinct from `OrchestrationPlan` (which may produce it).
- `src/lib/knots.ts:56` — `ExecutionPlanRecord`

### ExecutionSnapshot <!-- auto -->
Point-in-time capture of a beat's state, workflow, dependencies, and children.
- `src/lib/execution-port.ts:41`

### Final Cut <!-- auto -->
Post-session review surface for beats that have reached a terminal state but warrant human inspection.
- `src/components/final-cut-view.tsx`

### Gate <!-- auto -->
A wave slot or beat that represents a human decision or blocker rather than executable work.
- `src/lib/types.ts:181` — `WaveReadiness.gate`
- `docs/API.md:462`

### Handoff <!-- auto -->
Transition of beat ownership between actors (human↔agent or agent↔agent), optionally capsuled for context preservation.
- `README.md:152`
- `src/lib/knots.ts:164`

### Harness <!-- auto -->
An agent CLI wrapper/adapter; each supported CLI (`claude`, `copilot`, `codex`, etc.) is a harness with its own dialect.
- `docs/interactive-agent-session-protocol.md:30`

### Hot Keys <!-- auto -->
The keyboard shortcut reference overlay (Shift+H). See `README.md` shortcut table.
- `README.md:168`

### Invariant <!-- auto -->
A declared `Scope` or `State` constraint attached to a beat that the agent or workflow must uphold.
- `src/lib/types.ts:22`
- `src/lib/schemas.ts:30`

### Iteration <!-- auto -->
A single turn within a Take/Scene loop — one prompt-to-result cycle inside an agent session.
- `docs/interactive-agent-session-protocol.md:217`
- `ARCHITECTURE.md:47`

### Knot <!-- auto -->
A work item in the Knots backend. Equivalent to Beat at the UI layer; carries extended fields like lease id, profile, invariants, handoff capsules.
- `src/lib/knots.ts:69` — `KnotRecord`
- Aliases: `Beat` (UI-side), `Bead` (Beads backend)

### Lease <!-- auto -->
An agent's active claim on a beat during execution. Prevents concurrent takes; must be released (or rolled back) when the session ends.
- `src/lib/execution-port.ts:25` — `ExecutionLease`
- `src/lib/knots-lease-runtime.ts`

### MemoryWorkflowDescriptor <!-- auto -->
Runtime definition of a workflow: states, transitions, terminal states, owners per step, profile id, prompt id.
- `src/lib/types.ts:36`

### Memory Manager <!-- auto -->
The pluggable system of record behind a repo: Knots (primary, `kno` CLI) or Beads (`bd` CLI / `.beads/issues.jsonl`). Detected via marker directories.
- `docs/FOOLERY_AGENT_MEMORY_CONTRACT.md:1`
- `src/lib/memory-manager-detection.ts`

### OrchestrationPlan <!-- auto -->
AI-generated plan with waves, agent assignments, step ordering, and assumptions. Applied to produce real beats.
- `src/lib/types.ts:244`

### OrchestrationSession <!-- auto -->
A running or completed orchestration run: id, repo, status, plan, timestamps, error.
- `src/lib/types.ts:257`

### PlanDocument <!-- auto -->
Immutable persisted plan: waves, beat assignments, objective, summary, assumptions. Versioned via `PlanLineage`.
- `src/lib/orchestration-plan-types.ts:22`

### PlanLineage <!-- auto -->
Plan-version chain: the id of the original plan and the list of plans that superseded it.
- `src/lib/orchestration-plan-types.ts:43`

### PlanProgress <!-- auto -->
Runtime progress over a `PlanDocument`: satisfied beats, next step, per-wave completion.
- `src/lib/orchestration-plan-types.ts:78`

### Pool — see Agent Pool

### Priority — see BeatPriority

### Profile <!-- auto -->
Workflow configuration template (e.g. `autopilot`, `autopilot_with_pr`, `semiauto`) that defines which steps are agent-owned vs human-gated.
- `src/lib/workflows.ts:162`
- `src/lib/knots.ts:132` — `KnotProfileDefinition`

### Readiness <!-- auto -->
A wave beat's schedulability classification: `runnable`, `in_progress`, `blocked`, `humanAction`, `gate`, `unschedulable`.
- `src/lib/types.ts:181` — `WaveReadiness`

### RegisteredAgent <!-- auto -->
An agent configured in settings: command, provider, model, version, flavor, label.
- `src/lib/types.ts:365`

### RegisteredRepo <!-- auto --> ⚠ divergence
A repo tracked in the registry: path, name, addedAt, memoryManagerType. Defined identically in two places — see Review Queue.
- `src/lib/types.ts:114`
- `src/lib/registry.ts:8`

### Registry <!-- auto -->
The persistent catalog of repos Foolery knows about, with add/remove/inspect/backfill operations.
- `src/lib/registry.ts`
- `ARCHITECTURE.md:53`

### Repo <!-- auto -->
A git working tree registered with Foolery, associated with exactly one memory manager.
- `src/lib/registry.ts:8`
- `README.md:54`

### Retake <!-- auto --> ⚠ overloaded
(a) The operation of reopening a shipped/closed beat from `ready_for_implementation` for regression investigation; (b) the Retakes view/lane for shipped-beat review.
- `src/lib/retake.ts:2` — `RETAKE_TARGET_STATE`, `RETAKE_SOURCE_STATES`
- `src/components/retakes-view.tsx`

### Scene <!-- auto --> ⚠ overloaded
(a) A named agent Action for orchestrated multi-beat execution; (b) an informal name for an `OrchestrationSession`.
- `src/lib/schemas.ts:135`
- `README.md:126`

### ScopeRefinement <!-- auto -->
Agent-driven clarification of a beat's scope or acceptance criteria. Queued via the scope-refinement worker.
- `src/lib/scope-refinement-queue.ts:51`
- `src/stores/scope-refinement-pending-store.ts`

### Session <!-- auto --> ⚠ overloaded
An umbrella term. Could mean `TerminalSession`, `OrchestrationSession`, or `AgentSessionRuntime`. Always qualify.
- `src/lib/types.ts:138`
- `src/lib/agent-session-runtime.ts:139`

### Setlist <!-- auto -->
UI view presenting the execution plan as a Gantt-style wave schedule.
- `src/components/setlist-view.tsx`

### StepPhase <!-- auto -->
A workflow step's two-phase lifecycle: `Queued` (ready_for_*) or `Active` (in-progress).
- `src/lib/workflows.ts:34`

### Take <!-- auto --> ⚠ overloaded
(a) A named agent Action for single-beat execution; (b) the prompt output `TakePromptResult` used to initiate one.
- `src/lib/schemas.ts:134`
- `src/lib/backend-port.ts:62`

### TerminalEvent <!-- auto -->
Stream event emitted by a terminal session: `stdout`, `stderr`, `exit`, `stream_end`, `agent_switch`.
- `src/lib/types.ts:154`

### TerminalSession <!-- auto -->
An interactive agent session rendered via xterm.js — one per Take or Scene launch.
- `src/lib/types.ts:138`
- `ARCHITECTURE.md:48`

### TerminalSessionStatus <!-- auto -->
`idle` | `running` | `completed` | `error` | `aborted` | `disconnected`.
- `src/lib/types.ts:136`

### Turn <!-- auto -->
A single agent response cycle within an interactive session (one prompt in, one result out).
- `docs/interactive-agent-session-protocol.md:19`

### Wave <!-- auto --> ⚠ ambiguous
A parallel-executable group of beats. Multiple `Wave` types exist across planners: `Wave` (wave-planner), `OrchestrationWave`, `PlanWave`, `ExecutionPlanWaveRecord`.
- `src/lib/types.ts:175` — `Wave` (wave-planner form)
- `src/lib/types.ts:234` — `OrchestrationWave`
- See Review Queue

### WavePlan <!-- auto -->
Top-level output of the wave-planner: ordered waves, unschedulable beats, summary, recommendations.
- `src/lib/types.ts:206`

### WaveReadiness — see Readiness

### WorkflowStep <!-- auto -->
The six-state spine: `Planning`, `PlanReview`, `Implementation`, `ImplementationReview`, `Shipment`, `ShipmentReview`.
- `src/lib/workflows.ts:23`

---

## Workflow States

Canonical beat states, listed in execution order. Each step has a `ready_for_*` (Queued) and active form (Active) — see `StepPhase`.

### ready_for_planning <!-- auto -->
Queued for the planning phase. Default initial state in full workflows.
- `src/lib/workflows.ts:47`

### planning <!-- auto -->
Agent is actively drafting a plan for the beat.
- `src/lib/workflows.ts:48`

### ready_for_plan_review <!-- auto -->
Planning is done; awaiting plan review (agent or human depending on profile).
- `src/lib/workflows.ts:49`

### plan_review <!-- auto -->
Plan is actively being reviewed.
- `src/lib/workflows.ts:50`

### ready_for_implementation <!-- auto -->
Plan approved; queued for implementation. Also the target state of a `Retake`.
- `src/lib/workflows.ts:51`
- `src/lib/retake.ts:2`

### implementation <!-- auto -->
Active coding / implementation phase.
- `src/lib/workflows.ts:52`

### ready_for_implementation_review <!-- auto -->
Implementation complete; queued for review.
- `src/lib/workflows.ts:53`

### implementation_review <!-- auto -->
Implementation actively under review.
- `src/lib/workflows.ts:54`

### ready_for_shipment <!-- auto -->
Implementation approved; queued for ship step.
- `src/lib/workflows.ts:55`

### shipment <!-- auto -->
Active shipment (merge, tag, release).
- `src/lib/workflows.ts:56`

### ready_for_shipment_review <!-- auto -->
Shipment complete; queued for final review.
- `src/lib/workflows.ts:57`

### shipment_review <!-- auto -->
Shipment under final review.
- `src/lib/workflows.ts:58`

### shipped <!-- auto -->
Canonical terminal state — work delivered.
- `src/lib/workflows.ts:272`

### abandoned <!-- auto -->
Terminal state — beat cancelled without completion.
- `src/lib/workflows.ts:274`

### deferred <!-- auto -->
Paused indefinitely; reachable from any state. Not part of normal flow.
- `src/lib/workflows.ts:273`

### blocked <!-- auto -->
Legacy / compat state for a beat that cannot progress due to a dependency. Prefer dependency edges + `ready_for_*` in new code.
- `docs/API.md:112`

### closed <!-- auto --> ⚠ overloaded
Terminal state in Beads/legacy workflows. Mapped from Knots `shipped`/`done`/`approved` for display compat.
- `src/lib/workflows-runtime.ts:68`

### open <!-- auto -->
Legacy compat state; normalized to `ready_for_planning`.
- `src/lib/workflows-runtime.ts:148`

### in_progress <!-- auto -->
Legacy compat state; normalized to `implementation`.
- `src/lib/workflows-runtime.ts:82`

---

## Verbs

### abort <!-- auto -->
Terminate a session without completing its work. Applies to `TerminalSession` and `OrchestrationSession`.
- `src/lib/terminal-manager.ts:131`
- `docs/interactive-agent-session-protocol.md:263`

### apply <!-- auto -->
Materialize an orchestration plan into real beats in the registry.
- `docs/API.md:624`

### audit <!-- auto -->
Inspect leases / permissions / registry state for validity and coverage; does not mutate unless paired with a fix.
- `src/lib/registry.ts:279` — `inspectRegistryPermissions`
- `docs/API.md` — `lease-audit`

### backfill <!-- auto -->
Populate missing fields with defaults (e.g. `memoryManagerType` on pre-existing repos, pool entries on legacy settings).
- `src/lib/registry.ts:203` — `backfillMissingRepoMemoryManagerTypes`
- `src/lib/settings-maintenance.ts:217`

### cascade-close <!-- auto -->
Close a parent beat and all open descendants, leaf-first.
- `src/lib/cascade-close.ts:74`
- `docs/API.md:239`

### claim <!-- auto -->
Acquire a lease on a beat for the duration of an agent session.
- `src/lib/knots-operations.ts:223`

### close <!-- auto -->
Mark a beat complete without shipping. Distinct from `ship`.
- `docs/API.md:218`

### create <!-- auto -->
Allocate a new beat / session / lease / plan.
- `src/lib/backend-port.ts` — `BackendPort.create*`

### dispatch <!-- auto -->
Route an action to an agent via either per-action mapping or pool selection.
- `src/lib/agent-pool.ts`

### drain <!-- auto -->
Close stdin on an agent child process after a turn completes.
- `docs/interactive-agent-session-protocol.md:186`

### escalate <!-- auto -->
Upgrade a shutdown signal (SIGTERM → SIGKILL) when a process ignores termination.
- `docs/interactive-agent-session-protocol.md:247`

### handoff <!-- auto -->
Pass ownership of a beat between agents or between agent and human, optionally with a `Capsule` for context.
- `src/lib/knots.ts:164`

### merge <!-- auto -->
Combine two beats into one (unidirectional consolidation).
- `docs/API.md:309`

### poll <!-- auto -->
Opportunistically probe a backend for claimable work without holding a specific beat in mind. Also an `ExecutionMode`.
- `src/lib/knots-operations.ts:185`
- `src/lib/execution-port.ts:5`

### query <!-- auto -->
Search beats via an expression language (jq-style filters and sort).
- `src/lib/bd-queries.ts:79`

### rehydrate <!-- auto -->
Refresh an entity's in-memory state from the backing store. Used for knots and for terminal session reconnection.
- `src/lib/knots.ts:478`
- `src/hooks/use-terminal-panel-effects.ts`

### restage <!-- auto -->
Recompute an orchestration plan and resume from the next unfinished wave.
- `src/lib/orchestration-manager.ts:25`

### retake <!-- auto -->
Reopen a shipped/closed beat for regression investigation by transitioning to `ready_for_implementation`.
- `src/lib/retake.ts:2`

### rollback <!-- auto -->
Revert a beat's state to a prior queue state — inverse of the forward workflow transition.
- `src/lib/terminal-manager-workflow.ts:231`

### scan <!-- auto -->
Detect installed agent CLIs on the system and their available models.
- `src/lib/settings-agent-detect.ts:328`

### scene <!-- auto -->
Launch an orchestrated multi-beat agent session. Also an Action name.
- `src/lib/schemas.ts:135`

### settle <!-- auto -->
Finalize a beat's state and release all associated leases after completion.
- `src/lib/knots-lease-runtime.ts`

### ship <!-- auto -->
Transition a beat through the shipment step to `shipped`.
- `src/lib/workflows.ts:272`

### stage <!-- auto -->
Prepare beats for execution by grouping them into waves.
- `README.md:178`

### take <!-- auto -->
Launch a single-beat agent session. Also an Action name.
- `src/lib/schemas.ts:134`

### validate <!-- auto -->
Post-exit check that the backend state advanced as expected; repair if not.
- `docs/interactive-agent-session-protocol.md:204`

---

## Phrases

### "agent pool" <!-- auto -->
Weighted list of agents eligible for a workflow step under advanced dispatch.
- `README.md:130`

### "auto-routing backend" <!-- auto -->
Meta-backend that selects the concrete backend per repo at request time.
- `ARCHITECTURE.md:14`

### "capability-driven" <!-- auto -->
Describes code that branches on declared feature flags rather than hard-coding per-agent or per-backend behavior.
- `docs/interactive-agent-session-protocol.md:71`

### "cascade close" <!-- auto -->
Close-then-close-descendants operation.
- `docs/API.md:239`

### "coarse human gated" <!-- auto -->
Workflow mode where plan and/or implementation reviews require human approval.
- `src/lib/schemas.ts:19`

### "dead lease" <!-- auto -->
A lease whose session has exited but whose state hasn't been settled or rolled back. Lease audit surfaces these.
- `src/lib/lease-audit.ts`

### "dispatch mode" <!-- auto -->
The choice between `basic` (per-action mapping) and `advanced` (weighted pools).
- `src/lib/schemas.ts:240`

### "execution plan" <!-- auto -->
A staged wave schedule persisted on a Knot; distinct from the orchestration plan that may produce it.
- `src/lib/knots.ts:56`

### "granular autonomous" <!-- auto -->
Workflow mode where every step is agent-owned with no human gates.
- `src/lib/schemas.ts:18`

### "handoff capsule" <!-- auto -->
Context bundle attached to a beat at an agent↔agent or agent↔human handoff.
- `src/lib/knots.ts:164`

### "human action" <!-- auto -->
A beat state that blocks until a person acts. Counted into wave summaries.
- `docs/API.md:462`

### "interactive session" <!-- auto -->
Bidirectional stdin-prompt-based agent session (as opposed to one-shot argv).
- `docs/interactive-agent-session-protocol.md:99`

### "lease lifecycle" <!-- auto -->
The full bind → hold → release / rollback arc of an `ExecutionLease`.
- `docs/DEVELOPING.md:262`

### "memory manager detection" <!-- auto -->
Marker-directory (`.knots/`, `.beads/`) heuristics that decide which backend to use for a repo.
- `src/lib/memory-manager-detection.ts`

### "normalized event" <!-- auto -->
A dialect-agnostic agent event emitted after dialect-specific parsing; the vocabulary the runtime actually reasons about.
- `docs/interactive-agent-session-protocol.md:129`

### "one-shot session" <!-- auto -->
Non-interactive agent session — prompt goes in argv, no follow-up turns.
- `docs/interactive-agent-session-protocol.md:121`

### "post-exit validation" <!-- auto -->
Backend state check that runs after an agent process exits to decide whether to settle or rollback.
- `docs/interactive-agent-session-protocol.md:204`

### "runnable queue" <!-- auto -->
Pre-sorted beats whose dependencies are satisfied and which are ready to run.
- `docs/API.md:448`

### "scope refinement" <!-- auto -->
Agent-driven process that clarifies or tightens a beat's scope / acceptance criteria.
- `src/lib/scope-refinement-queue.ts:51`

### "stdin drain" <!-- auto -->
Closing the stdin stream on an agent child after a turn completes so it knows no more input is coming.
- `docs/interactive-agent-session-protocol.md:186`

### "turn complete" <!-- auto -->
Normalized event signaling the agent finished responding to the current prompt.
- `docs/interactive-agent-session-protocol.md:165`

### "wave level" <!-- auto -->
Topological depth of a wave in the dependency graph; lower numbers are earlier.
- `docs/API.md:415`

### "weighted pool" <!-- auto -->
An agent pool where each member has a relative weight that biases probabilistic dispatch.
- `README.md:132`

### "workflow profile" <!-- auto -->
Named preset of `MemoryWorkflowDescriptor` (autopilot, semiauto, etc.).
- `src/lib/workflows.ts:162`

---

## Acronyms & Shorthand

| Short | Expansion | Notes |
|-------|-----------|-------|
| ADR | Architectural Decision Record | `docs/adr-knots-compatibility.md` |
| API | Application Programming Interface | `docs/API.md` |
| CLI | Command-Line Interface | kno, bd, claude, copilot, codex, etc. |
| DTO | Data Transfer Object | e.g. `RawBead` for on-disk JSONL |
| JSONL | JSON Lines (newline-delimited JSON) | `src/lib/backends/beads-jsonl-io.ts` |
| kno | Knots CLI binary | Primary memory-manager CLI |
| bd | Beads CLI binary | Alternate memory-manager CLI |
| OpenAPI | OpenAPI 3.1.0 specification | `src/lib/openapi/` |
| PR | Pull Request | e.g. `autopilot_with_pr` profile |
| SSE | Server-Sent Events | Streaming API endpoints |
| TOML | Tom's Obvious Minimal Language | Settings file format |
| TTL | Time To Live | Cache duration |
| UI | User Interface | — |
| UX | User Experience | — |
| WF | Workflow | Label prefix `wf:state:*`, `wf:profile:*` |

---

## Review Queue

Terms needing human attention. Resolve and remove.

- ⚠ **Backend — overloaded**. `BackendPort` (memory-manager backend) and the *execution backend* (`StructuredExecutionBackend`, `src/lib/execution-backend.ts`) are both called "backend" in prose and code. Consider renaming the execution-side to "Execution Engine" or always qualifying.
- ⚠ **BackendError — overloaded**. Exists as an interface (`src/lib/backend-port.ts:24`) and as an `Error` subclass (`src/lib/backend-errors.ts:52`). Code imports from both. Decide which is canonical.
- ⚠ **Plan — ambiguous**. Four distinct types: `WavePlan` (planner output), `OrchestrationPlan` (AI plan for a scene), `PlanDocument` (persisted orchestration plan), `ExecutionPlan` (Knots-native). Prose calls all of them "the plan." Consider a naming convention.
- ⚠ **Wave — ambiguous**. Four `Wave` shapes: `Wave` (wave-planner), `OrchestrationWave`, `PlanWave`, `ExecutionPlanWaveRecord`. Consider a shared supertype or disambiguating suffixes in prose.
- ⚠ **Session — overloaded**. `TerminalSession`, `OrchestrationSession`, `AgentSessionRuntime` all get called "session" in comments and UI copy. Always qualify in code and docs.
- ⚠ **Step — ambiguous**. `WorkflowStep` (Planning…ShipmentReview), `OrchestrationWaveStep`, `PlanStep`, and "settings pool step" all coexist. Different shapes, related concepts.
- ⚠ **Retake — overloaded**. The Retakes view (`src/components/retakes-view.tsx`) and the retake operation (`src/lib/retake.ts`) share a name. Usually fine in context; flag if prose gets confusing.
- ⚠ **Take / Scene — overloaded**. Each is simultaneously a verb (the action), a noun (the session/artifact), and an `Action` enum value. Context usually disambiguates but flagging for new-contributor orientation.
- ⚠ **RegisteredRepo — divergence**. Identical interface declared in `src/lib/types.ts:114` and `src/lib/registry.ts:8`. Pick one canonical source and re-export from the other.
- ⚠ **closed vs shipped — overloaded terminal state**. Both are terminal; `closed` is legacy/Beads, `shipped` is Knots canonical. `workflows-runtime.ts` normalizes between them. Consider a clear guideline for new code.
