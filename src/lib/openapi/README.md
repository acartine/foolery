# openapi

Modular OpenAPI 3.1.0 path and schema definitions assembled by `openapi-spec.ts`.

## Key Files

- **`schemas.ts`** — Core component schemas: `Beat`, `BeatDependency`, `WaveBeat`, `CreateBeatInput`
- **`schemas-extended.ts`** — Extended schemas: `BackendCapabilities`, `MemoryWorkflowDescriptor`
- **`paths-beats.ts`** — Beat CRUD and listing endpoints
- **`paths-deps.ts`** — Dependency management endpoints
- **`paths-waves.ts`** — Wave planning endpoints
- **`paths-streaming.ts`** — Terminal and orchestration SSE endpoints
- **`paths-settings.ts`** — Settings and agent configuration endpoints
- **`paths-system.ts`** — Registry and system health endpoints
- **`paths-plans.ts`** — Execution-plan persistence endpoints
- **`schemas-plans.ts`** — Execution-plan request/response schemas

## Usage

These modules are imported by `src/lib/openapi-spec.ts` and served at `/api/openapi.json`.
