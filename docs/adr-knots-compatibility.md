# ADR: Knots Compatibility-First Backend Integration

- Status: Accepted
- Date: 2026-02-23
- Scope: `foolery-g3y1`

## Context

Foolery historically assumed Beads/`bd`. We need robust end-to-end Knots support without breaking existing Beads flows and without doing the full Knots-native product model refactor in this epic.

## Decision

1. Backend routing is per-repo and automatic.
2. Memory manager marker precedence is `.knots` over `.beads` when both exist.
3. Keep current Foolery status model in this epic; map Knots states into it.
4. `BackendPort.close()` maps to Knots `shipped`.
5. Make prompts memory-manager-aware.
6. Unsupported operations must return explicit capability-aligned API responses (not generic 500s).

## Integration Constants

Knots passes workflow-native states through directly; Foolery no longer translates them into a generic status vocabulary. The Knots backend preserves the raw workflow state in `bead.metadata.knotsState` and relies on workflow-aware helpers (`MemoryWorkflowDescriptor`, `deriveWorkflowState`) everywhere else.

| Concern | Convention |
|---|---|
| State handling | Workflow-native throughout; no generic status translation layer |
| Close() target | `shipped` (see `KNOTS_CLOSE_TARGET_STATE`) |
| Dependency add/remove | `addDependency(blocker, blocked)` -> `edge add blocked blocked_by blocker`; remove is inverse |
| Hierarchy | parent-child uses `parent_of` edges |
| Labels | Foolery labels map 1:1 to Knots tags |
| Raw state preservation | backend writes raw Knots state to `bead.metadata.knotsState` |
| Agent identity | lease is the declared source; `--agent-*` / `--note-*` / `--handoff-*` flags on non-`lease create` subcommands are deprecated, ignored at runtime, and emit a stderr warning (see [knots-agent-identity-contract.md](knots-agent-identity-contract.md)) |

## Canonical Source of Truth

Knots-facing constants live in [`src/lib/knots-constants.ts`](../src/lib/knots-constants.ts):

- `KNOTS_BLOCKED_BY_EDGE_KIND` / `KNOTS_PARENT_OF_EDGE_KIND` — edge kind constants
- `KNOTS_CLOSE_TARGET_STATE` — close() target state
- `KNOTS_METADATA_KEYS` — metadata key registry
- `KNOTS_SUPPORTS_DELETE` / `KNOTS_SUPPORTS_SYNC` — capability flags

Contract tests: [`src/lib/__tests__/knots-constants.test.ts`](../src/lib/__tests__/knots-constants.test.ts)

The old bidirectional compat-status maps (`KNOTS_TO_FOOLERY_STATUS`, `FOOLERY_TO_KNOTS_STATUS`, `mapKnotsStateToFooleryStatus`, `mapFooleryStatusToKnotsState`) were removed. Beads JSONL persistence still needs to round-trip its own `open`/`in_progress`/`closed` field; that translation is isolated to [`src/lib/backends/beads-compat-status.ts`](../src/lib/backends/beads-compat-status.ts) and is treated as migration debt local to the Beads backend — no other Foolery run path imports it.

## Consequences

1. Mixed memory manager repos are supported in one Foolery session.
2. Beads JSONL round-trips through a backend-local status translation; all other code paths are workflow-native.
3. A follow-up epic is required for full Knots-native UX/API model realignment.
