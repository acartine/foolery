# Developing Foolery

A guide for contributors working on [Foolery](https://github.com/acartine/foolery), the web UI for [Beads](https://github.com/steveyegge/beads) issue tracking.

## Prerequisites

- **[Bun](https://bun.sh)** (runtime and package manager)
- **[Node.js](https://nodejs.org)** 20+ (Next.js runtime, used by the launcher)
- **[Beads CLI](https://github.com/steveyegge/beads)** (`bd`) on your PATH
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

## Project Layout

```
src/
  app/                  Next.js 16 App Router
    api/                REST API routes (wrap bd CLI)
    beads/              Main beats listing
  components/           React components
    ui/                 shadcn/ui primitives (new-york style)
  hooks/                Custom React hooks
  lib/                  Utilities, types, services
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
| `bun run storybook` | Storybook dev on :6006 |
| `bun run build:runtime` | Package runtime artifact for distribution |
| `bun run release -- vX.Y.Z` | Create GitHub release and build artifacts |

## Architecture

```
Browser  ->  React 19 + Zustand + TanStack Query
         ->  Next.js 16 API Routes
         ->  Bun.spawn() / execFile()
         ->  bd CLI
         ->  Git (.beads/issues.jsonl)
```

The frontend never touches the filesystem directly. All mutations flow through API routes that shell out to the `bd` CLI. This keeps `bd` as the single source of truth for bead data.

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

- Components: kebab-case (`bead-form.tsx`, `status-badge.tsx`)
- Utilities and hooks: kebab-case (`bead-sort.ts`, `use-update-url.ts`)
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

## Contribution Guidelines

Foolery builds on top of [Beads](https://github.com/steveyegge/beads) by Steve Yegge. The upstream project values:

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

## Work Tracking with Beads

This project uses Beads (`bd`) for issue tracking, not GitHub Issues. The workflow:

```bash
bd ready                                    # find available work
bd show <id>                                # read the scope
bd update <id> --status in_progress         # claim it

# ... implement, test, commit ...

SHORT_SHA=$(git rev-parse --short HEAD)
bd update <id> --add-label commit:$SHORT_SHA
bd update <id> --add-label stage:verification
bd sync
git push
```

See `AGENTS.md` for the full bead lifecycle and handoff protocol.

## Release Process

```bash
bun run release -- v0.1.16
```

This creates a GitHub Release, triggers the `release-runtime-artifact` workflow (builds tarballs for macOS and Linux on both x64 and arm64), and blocks until assets are uploaded. Users get the update via `foolery update`.

## Useful Links

- [Project Manifest](MANIFEST.md) -- architecture, API docs, component inventory
- [Settings Guide](SETTINGS.md) -- how settings work and how to add new ones
- [Beads CLI](https://github.com/steveyegge/beads) -- the issue tracker Foolery wraps
- [Beads Contributing Guide](https://github.com/steveyegge/beads/blob/main/CONTRIBUTING.md) -- upstream contribution standards
