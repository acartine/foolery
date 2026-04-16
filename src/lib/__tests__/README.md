# __tests__

Unit and integration tests for `src/lib/` business logic.

## Structure

Tests are named `<module>.test.ts` and mirror the parent `lib/` module they cover. Helper and mock files are co-located:

- **`mock-backend-port.ts`** — Shared mock `BackendPort` for backend contract tests
- **`knots-backend-mocks.ts`** — General Knots backend mock fixtures
- **`knots-backend-coverage-mocks.ts`** — Knots backend coverage-test fixtures
- **`knots-guardrails-mocks.ts`** — Guardrail test data
- **`doctor-mocks.ts`** — Doctor diagnostic test fixtures

## Key Test Suites

- `backend-contract.test.ts` — Verifies all backends satisfy `BackendPort`
- `knots-backend-contract.test.ts` — Knots-specific backend contract parity
- `beads-backend-lifecycle.test.ts` — Beads CRUD lifecycle
- `terminal-manager-*.test.ts` — Terminal session lifecycle and error recovery
- `workflows-*.test.ts` — Workflow state transitions and label inference
- `scope-refinement-*.test.ts` — Scope refinement queue and worker
- `wave-slugs*.test.ts` — Wave slug allocation and fallback

## Running

```bash
bun run test          # run all tests
bun run test:all      # run full suite including slow tests
```
