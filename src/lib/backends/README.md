# backends

Backend adapter implementations that satisfy the `BackendPort` interface.

## Key Files

- **`knots-backend.ts`** — `KnotsBackend` adapter backed by the `kno` CLI
- **`knots-backend-helpers.ts`** — Result wrappers, data normalisation, alias collection
- **`knots-backend-mappers.ts`** — `toBeat()` conversion, filter matching, expression matching
- **`knots-backend-update.ts`** — Update-method helpers and parent-edge management
- **`knots-backend-prompts.ts`** — Knots-specific prompt building for Take!/Scene!
- **`knots-skill-prompts.ts`** — `BUILTIN_SKILL_PROMPTS` for knots-backed agents
- **`beads-backend.ts`** — `BeadsBackend` adapter backed by `.beads/issues.jsonl`
- **`beads-backend-helpers.ts`** — Filter, update, ID generation, and invariant helpers
- **`beads-jsonl-dto.ts`** — `RawBead` DTO and normalisation to/from JSONL format
- **`beads-jsonl-io.ts`** — File I/O for JSONL and dependency records
- **`bd-cli-backend.ts`** — `BdCliBackend` adapter delegating to the `bd` CLI wrapper
- **`stub-backend.ts`** — `StubBackend` returning empty reads and UNAVAILABLE for writes

## Key Types

- `KnotsBackend` — Primary backend for repos using the `kno` memory manager
- `BeadsBackend` — Backend for repos using `.beads/issues.jsonl` storage
- `BdCliBackend` — Legacy adapter bridging the `bd` CLI to `BackendPort`
- `StubBackend` — Safe no-op default when no real backend is configured
