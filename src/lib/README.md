# lib

Core business logic, CLI wrappers, and domain types for Foolery.

## Key Files

- **`types.ts`** — Domain types: `Beat`, `BeatPriority`, `MemoryWorkflowDescriptor`, `RegisteredRepo`
- **`schemas.ts`** — Zod schemas for beat creation, update, query, and dependency inputs
- **`api.ts`** — Client-side fetch helpers (`fetchBeats`, `updateBeat`, `createBeat`, etc.)
- **`backend-port.ts`** — `BackendPort` interface that all backend adapters implement
- **`backend-factory.ts`** — `AutoRoutingBackend` that routes per-repo to the correct backend
- **`backend-instance.ts`** — Singleton `BackendPort` for use by API routes
- **`bd.ts`** — Public facade for the Beads (`bd`) CLI wrapper
- **`knots.ts`** — Low-level `kno` CLI exec wrapper with retry and write queues
- **`workflows.ts`** — Workflow step/phase definitions and state-transition helpers
- **`settings.ts`** — Settings read/write (agent config, dispatch defaults, repos)
- **`terminal-manager.ts`** — Agent terminal session lifecycle (Take!/Scene! loops)
- **`orchestration-manager.ts`** — Multi-agent orchestration session management
- **`wave-planner.ts`** — Wave planning logic for scheduling beat execution
- **`openapi-spec.ts`** — Assembled OpenAPI 3.1.0 spec from `openapi/` submodules

## Key Types

- `Beat` — Core work-item model with workflow state, priority, labels, and metadata
- `BackendPort` — Interface contract for all backend adapters
- `BackendResult<T>` — Result envelope with structured `BackendError`
- `MemoryWorkflowDescriptor` — Workflow definition (states, transitions, ownership)

## Subdirectories

- `backends/` — Backend adapter implementations
- `openapi/` — Modular OpenAPI path and schema definitions
- `__tests__/` — Unit tests
