# api

Next.js API route handlers serving the Foolery REST API.

## Subdirectories

- **`beats/`** — Beat CRUD (`route.ts`), single-beat operations (`[id]/`), batch deps, merge, query, ready
- **`agent-history/`** — Agent execution history (`route.ts`) and message type listing
- **`terminal/`** — Terminal session management (`route.ts`) and per-session operations (`[sessionId]/`)
- **`orchestration/`** — Multi-agent orchestration sessions and lifecycle (`[sessionId]/`, apply, restage)
- **`waves/`** — Wave planning endpoints (`route.ts`)
- **`workflows/`** — Workflow descriptor listing (`route.ts`)
- **`settings/`** — Settings read/write (`route.ts`), agent management, and action dispatch
- **`registry/`** — Repository registration and browsing (`route.ts`, `browse/`)
- **`breakdown/`** — AI breakdown session endpoints
- **`capabilities/`** — Backend capability introspection
- **`doctor/`** — Diagnostic health checks
- **`lease-audit/`** — Knots lease audit log
- **`scope-refinement/`** — Scope refinement status and triggers
- **`version/`** — App version endpoint
- **`openapi.json/`** — Serves the OpenAPI 3.1.0 spec
