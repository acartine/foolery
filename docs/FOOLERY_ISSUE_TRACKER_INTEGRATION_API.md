# Foolery Issue Tracker Integration API

This document defines the integration contract between Foolery and issue
tracker backends.

## Purpose

Foolery must not be coupled to a single tracker implementation. All tracker
operations are routed through a storage-agnostic interface so new backends can
be added without touching UI workflows.

## Core Contract

The core contract is `BackendPort` in:

- `src/lib/backend-port.ts`

Every backend implementation must satisfy these operations:

1. Listing and retrieval: `list`, `listReady`, `search`, `query`, `get`
2. Mutations: `create`, `update`, `delete`, `close`
3. Dependencies: `listDependencies`, `addDependency`, `removeDependency`

All methods return `Promise<BackendResult<T>>` and must not require callers to
register callbacks.

## Result + Error Model

Backends return:

```ts
interface BackendResult<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

Error codes and retry semantics are standardized in:

- `src/lib/backend-errors.ts`

## Capability Declaration

Each backend must declare `BackendCapabilities` so callers can safely degrade
when a feature is unavailable.

- Type definition: `src/lib/backend-capabilities.ts`
- Example capability set: `BEADS_CAPABILITIES` in `src/lib/backends/beads-backend.ts`

## Backend Selection and Wiring

Backend creation and process-level selection are centralized:

1. `createBackend(type)` in `src/lib/backend-factory.ts`
2. `getBackend()` singleton in `src/lib/backend-instance.ts`
3. Selection key: `FOOLERY_BACKEND` (`cli`, `stub`, `beads`, or future types)

API routes and orchestration flows call `getBackend()` directly; they should not
import tracker-specific code.

## Known Implementations

### Beads CLI Adapter

- File: `src/lib/backends/bd-cli-backend.ts`
- Behavior: wraps `bd` CLI operations and maps raw errors into `BackendResult`

### Beads JSONL Adapter

- File: `src/lib/backends/beads-backend.ts`
- Behavior: reads/writes `.beads/issues.jsonl` and `.beads/deps.jsonl` directly

## Repository Compatibility Metadata

Registered repositories store the tracker type used by that repo:

- Registry model: `src/lib/registry.ts`
- Shared type: `src/lib/types.ts` (`RegisteredRepo.trackerType`)
- Known tracker catalog: `src/lib/issue-trackers.ts`
- Filesystem detection: `src/lib/issue-tracker-detection.ts`

Current known tracker list:

1. `beads` (marker: `.beads`)

## Setup and Discovery Integration

Discovery surfaces are tracker-aware and compatibility-checked:

1. `foolery setup` repo discovery (`scripts/setup.sh`)
2. Settings/repository browser (`src/components/directory-browser.tsx`)
3. Registry add flow (`src/lib/registry.ts` `addRepo`)

Each flow detects known tracker markers and only allows compatible repositories.

## Contract Validation

Use the reusable backend contract suite when adding or updating a backend:

- Harness: `src/lib/__tests__/backend-contract.test.ts`
- Beads verification: `src/lib/__tests__/beads-backend-contract.test.ts`
- Stub verification: `src/lib/__tests__/stub-backend.test.ts`

## Adding a New Tracker Backend

1. Implement `BackendPort`
2. Declare capabilities
3. Register in `backend-factory.ts`
4. Add tracker metadata to `issue-trackers.ts`
5. Add detection rule in `issue-tracker-detection.ts`
6. Run contract tests and full quality gates
