# Foolery Architecture

Keyboard-first browser control room for orchestrating multi-agent software work across repositories.

## Data / Control Flow

```
Browser (React/Zustand/TanStack Query)
  ↓ fetch()
Next.js API Routes (/api/beats, /api/terminal, /api/orchestration, ...)
  ↓ getBackend()
BackendPort interface (abstract)
  ↓ AutoRoutingBackend resolves per-repo
Concrete backend (KnotsBackend | BeadsBackend | BdCliBackend)
  ↓ Bun.spawn()
Memory manager CLI (kno | bd)
  ↓ reads/writes
Git-tracked beat data (.knots/ or .beads/)
```

Session flow: user clicks Take!/Scene! → `createSession()` builds prompt →
`selectFromPool()` picks agent → `Bun.spawn(agent_command)` →
SSE stream to xterm in browser → agent completes → workflow state advances.

## Directory Map

| Path | Purpose |
|------|---------|
| [`src/app/`](src/app/README.md) | Next.js App Router — pages and API routes |
| [`src/app/api/`](src/app/api/README.md) | REST API (beats, terminal, orchestration, settings, doctor) |
| [`src/components/`](src/components/README.md) | React components (beat table, terminal, agent history, settings) |
| [`src/components/ui/`](src/components/ui/README.md) | shadcn/ui primitives |
| [`src/hooks/`](src/hooks/README.md) | Custom React hooks |
| [`src/stores/`](src/stores/README.md) | Zustand stores (app, terminal, notification) |
| [`src/lib/`](src/lib/README.md) | Core business logic — types, backends, workflows, sessions |
| [`src/lib/backends/`](src/lib/backends/README.md) | BackendPort implementations (Knots, Beads, CLI, Stub) |
| [`src/lib/__tests__/`](src/lib/__tests__/README.md) | Unit tests (Vitest) |
| [`src/lib/openapi/`](src/lib/openapi/README.md) | OpenAPI 3.1.0 spec generation |
| [`src/stories/`](src/stories/README.md) | Storybook stories |
| [`scripts/`](scripts/README.md) | Build, install, release, and setup scripts |
| [`docs/`](docs/README.md) | Project documentation and ADRs |

## Key Entry Points

- **Backend factory**: `src/lib/backend-factory.ts` — `createBackend()`, `AutoRoutingBackend`
- **Backend interface**: `src/lib/backend-port.ts` — `BackendPort` (all backends implement this)
- **Execution backend**: `src/lib/execution-backend.ts` — `StructuredExecutionBackend` (lease/iteration/snapshot lifecycle)
- **Session lifecycle**: `src/lib/terminal-manager.ts` — `createSession()`, `abortSession()`
- **Orchestration**: `src/lib/orchestration-manager.ts` — `createOrchestrationSession()`
- **Breakdown**: `src/lib/breakdown-manager.ts` — `createBreakdownSession()`
- **Agent dispatch**: `src/lib/agent-pool.ts` — `selectFromPool()`
- **Workflows**: `src/lib/workflows.ts` — step definitions, state mappings
- **Registry**: `src/lib/registry.ts` — `loadRegistry()`, `addRepo()`, `removeRepo()`
- **Diagnostics**: `src/lib/doctor.ts` — `runDoctor()`, `runDoctorFix()`
- **Client API**: `src/lib/api.ts` — browser-side fetch wrappers
- **Domain types**: `src/lib/types.ts` — `Beat`, `TerminalSession`, `Wave`, `MemoryWorkflowDescriptor`
- **Validation**: `src/lib/schemas.ts` — Zod schemas for all inputs

## Build System

| Command | Purpose |
|---------|---------|
| `bun install` | Install dependencies |
| `bun run dev` | Dev server (localhost:3000) |
| `bun run build` | Production build |
| `bun run lint` | ESLint (errors on size violations) |
| `bunx tsc --noEmit` | Type check |
| `bun run test` | Vitest unit tests |
| `bun run storybook` | Component dev (localhost:6006) |
