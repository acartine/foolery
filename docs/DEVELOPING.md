# Developing Foolery

A guide for contributors working on [Foolery](https://github.com/acartine/foolery), a keyboard-first orchestration app for agent-driven software work built on top of [Knots](https://github.com/acartine/knots) and [Beads](https://github.com/steveyegge/beads) backends.

## Prerequisites

- **[Bun](https://bun.sh)** (runtime and package manager)
- **[Node.js](https://nodejs.org)** 20+ (Next.js runtime, used by the launcher)
- At least one supported memory manager CLI on your PATH:
  - **[Knots](https://github.com/acartine/knots)** (`kno`) — primary backend
  - **[Beads CLI](https://github.com/steveyegge/beads)** (`bd`) — alternative backend
- **[Git](https://git-scm.com)**

## Getting Started

```bash
git clone https://github.com/acartine/foolery.git
cd foolery
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). The dev server hot-reloads on file changes.

The production app runs on port 3210 by default (`foolery start`). Dev and production can coexist since they use different ports.

## Git Hooks

`bun install` runs `scripts/setup-git-hooks.sh`, which points `core.hooksPath`
at the committed `.githooks/` directory for the current checkout.

The default hook is `pre-commit`, which runs ESLint on staged `src/**/*.ts(x)`
files. That enforces the file, function, and line-length constraints through the
existing ESLint rules before a commit lands.

## Project Layout

```
src/
  app/                  Next.js 16 App Router
    api/                REST API routes
    beats/              Main beats workspace
  components/           React components
    ui/                 shadcn/ui primitives (new-york style)
  hooks/                Custom React hooks
  lib/                  Utilities, types, backend adapters, orchestration logic
    __tests__/          Unit tests (Vitest)
  stores/               Zustand state management
  stories/              Storybook stories
scripts/                Shell scripts (build, install, setup, testing)
docs/                   Project documentation
```

## Scripts

| Command | What it does |
|---------|--------------|
| `bun run dev` | Dev server on :3000 |
| `bun run build` | Production build |
| `bun run start` | Serve production build |
| `bun run test` | Vitest unit tests |
| `bun run test:storybook` | Storybook integration tests (Playwright) |
| `bun run test:all` | All test suites |
| `bun run test:coverage` | Unit tests with coverage |
| `bun run lint` | ESLint |
| `bun run lint:staged-size` | ESLint on staged `src/**/*.ts(x)` files |
| `bun run storybook` | Storybook dev on :6006 |
| `bun run build:runtime` | Package runtime artifact for distribution |
| `bun run changeset` | Create a release note + semver bump intent file |
| `bun run version-packages` | Apply pending changesets to version/changelog files |
| `bun run release` | Manual release helper (fallback) |
| `bash scripts/release/channel-install.sh release\|local [--activate]` | Install release/local channel launcher and runtime |
| `bash scripts/release/channel-use.sh release\|local\|show` | Switch or inspect active `foolery` channel symlink |

## Live Execution-Plan Validation

`scripts/test-plans-live.sh` exercises `POST /api/plans` and
`GET /api/plans/{planId}` against a real Knots repo (defaults to
`/Users/cartine/stitch`) so taxonomy, eligibility, and persistence regressions
in the execution-plan path are caught before they ship.

### Prerequisites

- A local Knots repo with at least one non-`execution_plan` knot. The default
  is `/Users/cartine/stitch`; override with `FOOLERY_PLAN_REPO`.
- The `kno` CLI on `PATH`.
- A configured orchestration agent (`codex`, `claude`, etc.) reachable on the
  same shell. The harness defers to whichever agent the dev server resolves,
  so the agent must be installed and authenticated.

### Run the Recipe

```bash
bash scripts/test-plans-live.sh
```

The harness:

1. Clones `/Users/cartine/stitch` into a disposable git worktree under
   `.test-plans-live/repo`, then copies `.knots/` so the source repo never
   accumulates plan knots from this run.
2. Starts the dev server on `FOOLERY_DEV_PORT` (default `3327`) with logs at
   `.test-plans-live/logs/dev.log`.
3. Auto-picks the first non-plan knot id (or uses `FOOLERY_PLAN_BEAT_IDS`)
   and `POST`s `/api/plans` with explicit `repoPath` and `beatIds`.
4. `GET`s `/api/plans/{planId}?repoPath=...` and asserts the artifact, plan
   document, wave/step structure, and `progress.nextStep` all conform to the
   spec in `src/lib/orchestration-plan-types.ts`.
5. Independently runs `kno -C <repo> show <planId> --json` to confirm the
   plan was persisted as type `execution_plan` with the payload attached.

### Useful Overrides

| Env var | Purpose |
|---|---|
| `FOOLERY_PLAN_REPO` | Source Knots repo (default `/Users/cartine/stitch`) |
| `FOOLERY_PLAN_WORKTREE` | Reuse an existing repo path; disables auto-cleanup |
| `FOOLERY_PLAN_BEAT_IDS` | Comma-separated beat ids to plan over |
| `FOOLERY_PLAN_BEAT_LIMIT` | Auto-pick this many beats (default `1`) |
| `FOOLERY_PLAN_MODEL` | Forwarded to `POST /api/plans` as `model` |
| `FOOLERY_PLAN_OBJECTIVE` | Forwarded as the plan `objective` |
| `FOOLERY_DEV_PORT` | Dev server port (default `3327`) |
| `FOOLERY_KEEP_TEST_DIR=1` | Keep `.test-plans-live/` on success for inspection |

### Reading Failures

Failures are emitted as a single JSON document on stderr with a
`category` field — for example `planner_runtime_failed`,
`beat_selection_missing`, `addressability_failed`,
`structural_drift`, `persistence_missing`, `persistence_taxonomy_drift`,
or `persistence_payload_missing` — plus the response body, the dev-log path,
and a `hint` describing the most likely root cause. Categorized failures are
the primary signal that the execution-plan path drifted from the spec.

## Release Channels

### Install a Specific Release Tag

```bash
FOOLERY_RELEASE_TAG=v0.1.0 curl -fsSL https://raw.githubusercontent.com/acartine/foolery/main/scripts/install.sh | bash
```

Re-run the same install command to upgrade or reinstall that tagged runtime.

### Toggle Between Release and Local Channels

Use the channel scripts to keep both launchers installed and switch with a symlink:

```bash
# Install latest GitHub release into ~/.local/share/foolery/channels/release/bin/foolery
bash scripts/release/channel-install.sh release

# Build from current checkout and install into ~/.local/share/foolery/channels/local/bin/foolery
bash scripts/release/channel-install.sh local

# Switch active ~/.local/bin/foolery symlink
bash scripts/release/channel-use.sh release
bash scripts/release/channel-use.sh local

# Show active link and installed channel details
bash scripts/release/channel-use.sh show
```

You can override defaults with:
- `FOOLERY_CHANNEL_ROOT` (default: `~/.local/share/foolery/channels`)
- `FOOLERY_ACTIVE_LINK` (default: `~/.local/bin/foolery`)
- `FOOLERY_RELEASE_INSTALLER_URL` (default: `https://raw.githubusercontent.com/acartine/foolery/main/scripts/install.sh`)
- `FOOLERY_LOCAL_ARTIFACT_PATH` (optional prebuilt local runtime tarball)
- `FOOLERY_LOCAL_DIST_DIR` (optional output dir for local artifact build)

## Architecture

```
Browser  ->  React 19 + Zustand + TanStack Query
         ->  Next.js 16 API Routes
         ->  BackendPort / orchestration services
         ->  Bun.spawn() / execFile()
         ->  Knots or Beads CLI
         ->  Repo-local memory data + Git
```

The frontend never touches the filesystem directly. Reads and mutations flow through API routes and service layers that talk to a backend adapter (`BackendPort`), which then invokes the active memory manager for the target repo. In practice that usually means Knots first, with Beads supported through the same contract.

## Tech Stack

- **Next.js 16** (App Router, API Routes)
- **React 19** (Server Components, Suspense)
- **TypeScript** (strict mode, `@/*` path alias)
- **Tailwind CSS v4** (via PostCSS)
- **shadcn/ui** (new-york style, neutral base)
- **Zustand** (UI state)
- **TanStack Query v5** (server state)
- **react-hook-form + Zod** (forms and validation)
- **Vitest** (unit tests)
- **Storybook v10** (component dev and visual tests)

## Code Conventions

### File Naming

- Components: kebab-case (`beat-form.tsx`, `status-badge.tsx`)
- Utilities and hooks: kebab-case (`beat-sort.ts`, `use-update-url.ts`)
- Types and schemas: kebab-case (`types.ts`, `schemas.ts`)
- Tests: `__tests__/<module>.test.ts`
- Stories: `<component>.stories.tsx`

### Imports

Order imports as:
1. Node built-ins (`"node:fs"`, `"node:path"`)
2. Framework (`"next/server"`, `"react"`)
3. Third-party packages
4. Local (`@/lib/*`, `@/components/*`, `@/stores/*`, `@/hooks/*`)

### TypeScript

- Strict mode enabled. No `any` unless absolutely necessary.
- Use `interface` for object shapes, `type` for unions and intersections.
- Derive types from Zod schemas with `z.infer<>` rather than duplicating.
- Every Zod schema field should have an explicit `.default()` where appropriate.

### Components

- Use `"use client"` only where needed (hooks, event handlers, browser APIs).
- Top-level export wraps with `<Suspense>`, inner component holds the hooks.
- Props use destructured interfaces, not inline types.
- Use `cn()` from `@/lib/utils` for conditional Tailwind classes.

### API Routes

- Accept `NextRequest`, return `NextResponse.json()`.
- Validate request bodies with Zod schemas.
- Return `{ data: T }` on success, `{ error: string }` on failure.
- Use proper HTTP status codes (201 created, 400 validation, 500 server).
- For routes that should never be statically cached, export `const dynamic = "force-dynamic"`.

### State

- **Zustand** for UI-only state (filters, toggles, sidebar).
- **TanStack Query** for server data. Invalidate related queries after mutations.
- Never store server state in Zustand.

### Shell Scripts

The `scripts/install.sh` generates the `foolery` CLI launcher via a heredoc. This means:

- Shell variables inside the launcher must be escaped (`\$VAR`).
- When piping data to a `node` heredoc, use fd redirection (`node /dev/fd/3 3<<'TAG'`) so stdin stays connected to the pipe.
- Always validate syntax after editing: `bash -n scripts/install.sh`.

## Testing

### Unit Tests

```bash
bun run test              # all unit tests
bun run test -- doctor    # filter by name
bun run test:coverage     # with coverage report
```

Tests live in `src/lib/__tests__/`. They use Vitest with `vi.mock()` for dependencies. Pattern:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDep = vi.fn();
vi.mock("@/lib/dep", () => ({ dep: () => mockDep() }));

import { myFunction } from "@/lib/my-module";

beforeEach(() => vi.clearAllMocks());

describe("myFunction", () => {
  it("does the thing", async () => {
    mockDep.mockResolvedValue({ ok: true });
    const result = await myFunction();
    expect(result).toBe(expected);
  });
});
```

### Storybook

```bash
bun run storybook         # dev server on :6006
bun run test:storybook    # headless Playwright tests
```

Stories use CSF3 format with `satisfies Meta<typeof Component>`.

### Smoke-Testing the Doctor Flow

The doctor command has both a streaming diagnostic mode and an interactive `--fix` mode. To test changes end-to-end without touching your production install:

```bash
# Diagnostic streaming (progressive output with icons)
bash scripts/test-doctor-stream.sh

# Fix mode (interactive prompts per fixable check)
bash scripts/test-doctor-stream.sh --fix
```

The script starts a dev server on port 3211 (configurable via `FOOLERY_DEV_PORT`), runs the test, and cleans up automatically. Your production app on port 3210 is unaffected.

**Important**: If you've changed API routes, delete the `.next` cache first:

```bash
rm -rf .next && bash scripts/test-doctor-stream.sh
```

## Logs

Server-side logs are always written to disk in both dev and production so errors can be reviewed after the fact.

| Environment | Server logs | Interaction logs | Next.js stdout/stderr |
|-------------|------------|-----------------|----------------------|
| `bun dev` | `.foolery-logs/_server/{date}/server.jsonl` | `.foolery-logs/{repo}/{date}/` | Terminal only |
| Production (`foolery start`) | `~/.config/foolery/logs/_server/{date}/server.jsonl` | `~/.config/foolery/logs/{repo}/{date}/` | `~/.local/state/foolery/logs/stdout.log` |

Server logs use JSONL format with `ts`, `level`, `category`, `message`, and optional `data` fields. They capture API errors and CLI failures automatically.

Knots lease lifecycle events are written to a dedicated repo-wide JSONL audit stream:

- Dev: `.foolery-logs/_leases/{date}/leases.jsonl`
- Production: `~/.config/foolery/logs/_leases/{date}/leases.jsonl`

Each entry includes stable correlation fields such as `sessionId`, `executionLeaseId`, `knotsLeaseId`, `beatId`, `interactionType`, `outcome`, and a structured `data` payload so lease behavior can be debugged after the fact.

## Commit Style

Follow conventional commits with a scope:

```
feat(doctor): add progressive NDJSON streaming
fix(beads): handle empty label arrays in filter
chore(deps): bump next to 16.1.6
```

- **feat**: New user-facing functionality
- **fix**: Bug fix
- **chore**: Maintenance, deps, CI
- **refactor**: Code change that doesn't fix a bug or add a feature
- **docs**: Documentation only
- **test**: Adding or updating tests

Keep titles under 72 characters. Use imperative mood ("add", "fix", not "added", "fixes"). Use the body for context when the title alone isn't enough.

## kno Workflows Are Authoritative

The workflows defined in kno (`.loom` files in the [knots](https://github.com/acartine/knots) repo) are the **single source of truth** for legal state transitions, terminal states, wildcard transitions, and profile behaviour. Foolery TypeScript must treat them as read-only.

Do **not**, under any circumstances:

- Post-process, augment, mutate, extend, or "patch up" the transitions, states, or terminal lists returned by `kno profile show` / `kno profile list`.
- Inject synthetic `* -> <terminal>` or any other transitions into a `MemoryWorkflowDescriptor` to make the UI "offer more options".
- Maintain a parallel hand-rolled copy of the workflow graph in TypeScript (e.g. a `canonicalTransitions()` that overrides or supplements kno).
- Assume a transition is legal because Foolery's in-memory descriptor says so. If kno rejects it, kno is right.

If the UI needs to offer a jump that the workflow does not allow as a normal transition, that is a **correction / cleaning action**, not a workflow extension. Design it explicitly as such and invoke kno idiomatically:

- Name the action for what it is (e.g. "Mark as shipped (override gates)", "Abandon", "Close") — not a generic "change state".
- Route it through a dedicated backend path that passes kno's `force` flag (see `KnotsBackend.close()` in `src/lib/backends/knots-backend.ts`).
- Never use a generic `update({ state })` call to move a knot to a state the workflow would otherwise forbid.

**Historical incident this rule protects against:** commit `29311507` (2026-04-21) added `withWildcardTerminals` in `src/lib/backends/knots-backend-workflows.ts`, which fabricated `* -> shipped` transitions that did not exist in `work_sdlc.loom`. The dispatch-adjacency check then saw the fake wildcard, omitted `force`, and every bulk "Move to Shipped" on `autopilot_no_planning` was rejected by kno. Knot `102e` tracks the removal and the establishment of this rule.

## Contribution Guidelines

Foolery builds on top of memory managers like [Knots](https://github.com/acartine/knots) and [Beads](https://github.com/steveyegge/beads). Key contribution values:

- **Focused PRs** -- one feature or fix per pull request.
- **Tests for new functionality** -- if you add it, test it.
- **Clear commit messages** -- explain the why, not just the what.
- **Small, focused functions** -- keep things readable.
- **Descriptive names** -- no abbreviation puzzles.

Additional guidelines for Foolery:

- **Don't modify `.beads/issues.jsonl`** in commits. This is the project's issue database and will cause merge conflicts.
- **Run quality gates before pushing**: `bun run test && bun run lint && npx tsc --noEmit`.
- **Prefer editing existing files** over creating new ones.
- **No PRs required by default** -- this repo pushes directly to `main` unless a PR workflow is explicitly requested. See `CLAUDE.md` for the full agent workflow.

## Work Tracking

This project uses Knots (`kno`) for work tracking, not GitHub Issues. The workflow:

```bash
kno list --status=open                      # find available work
kno show <id>                               # read the scope
kno claim <id>                              # claim it

# ... implement, test, commit ...

SHORT_SHA=$(git rev-parse --short HEAD)
kno update <id> --add-tag "$SHORT_SHA" --add-handoff-capsule "summary"
git push
```

See `AGENTS.md` for the full handoff protocol.

## Release Process

Foolery uses **Changesets** for release management.

### 1) Add a changeset in feature/fix PRs

```bash
bun run changeset
```

For this repo's single package (`foolery`), select:

- `patch` for bug fixes and small backward-compatible changes.
- `minor` for new backward-compatible features.
- `major` for breaking changes.

Changesets creates a markdown file in `.changeset/` with frontmatter like:

```md
---
foolery: patch
---

Short user-facing summary of the change.
```

Commit that file with your code changes.

### 2) Merge to `main`

The `Changesets` GitHub workflow opens or updates a **release PR** (`chore: release`) that applies pending changesets (version bump + changelog updates).

### 3) Merge the release PR

When the release PR is merged, the same workflow tags/releases the new version on GitHub.

Publishing a GitHub release triggers `release-runtime-artifact`, which builds and uploads runtime tarballs for supported OS/arch combinations. Users then receive the update via `foolery update`.

## Useful Links

- [Project Manifest](MANIFEST.md) -- architecture, API docs, component inventory
- [Settings Guide](SETTINGS.md) -- how settings work and how to add new ones
- [Beads Dolt Hook Setup](BEADS_DOLT_HOOKS.md) -- local hook setup for Dolt-native Beads sync
- [Knots](https://github.com/acartine/knots) -- primary memory manager backend
- [Beads CLI](https://github.com/steveyegge/beads) -- alternative memory manager backend
