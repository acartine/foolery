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
5. Keep verification lifecycle labels/stages and make prompts memory-manager-aware.
6. Unsupported operations must return explicit capability-aligned API responses (not generic 500s).

## Locked Mappings

| Concern | Mapping |
|---|---|
| Knots -> Foolery status | `idea/work_item -> open`; `implementing/implemented/reviewing/refining/approved -> in_progress`; `rejected -> blocked`; `deferred -> deferred`; `shipped/abandoned -> closed` |
| Foolery -> Knots status | `open -> work_item`; `in_progress -> implementing`; `blocked -> rejected`; `deferred -> deferred`; `closed -> shipped` |
| Dependency add/remove | `addDependency(blocker, blocked)` -> `edge add blocked blocked_by blocker`; remove is inverse |
| Hierarchy | parent-child uses `parent_of` edges |
| Labels | Foolery labels map 1:1 to Knots tags |
| Raw state preservation | backend writes raw Knots state to `bead.metadata.knotsState` |

## Canonical Source of Truth

The locked mappings above are codified in [`src/lib/knots-compat.ts`](../src/lib/knots-compat.ts) as typed constants and pure functions. All new Knots backend code should import mapping constants from this module rather than using inline string literals.

- `KNOTS_TO_FOOLERY_STATUS` / `FOOLERY_TO_KNOTS_STATUS` — bidirectional status maps
- `mapKnotsStateToFooleryStatus()` / `mapFooleryStatusToKnotsState()` — normalizing lookup functions
- `KNOTS_BLOCKED_BY_EDGE_KIND` / `KNOTS_PARENT_OF_EDGE_KIND` — edge kind constants
- `KNOTS_CLOSE_TARGET_STATE` — close() target state
- `KNOTS_METADATA_KEYS` — metadata key registry

Contract tests: [`src/lib/__tests__/knots-compat.test.ts`](../src/lib/__tests__/knots-compat.test.ts)

## Consequences

1. Mixed memory manager repos are supported in one Foolery session.
2. Existing Beads behavior remains unchanged.
3. A follow-up epic is required for full Knots-native UX/API model realignment.
