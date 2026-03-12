# Foolery Project Manifest

## Project Overview

**Foolery** is a keyboard-first orchestration app for agent-driven software work. It uses local memory-manager backends — Knots (`kno`) as the primary path, with Beads (`bd`) also supported — to track work items ("beats"), stage execution, dispatch agents, and review outcomes across repositories.

### Purpose

Foolery exists to make multi-step software work legible. Instead of juggling terminal tabs, chat transcripts, and half-remembered plans, you get a control surface for what is queued, active, waiting on a human, ready for review, and already captured in history.

### Key Features

- **Beat capture and triage**: Create, edit, filter, and organize beats across repos
- **Agent dispatch**: Launch single-beat work, multi-beat scenes, and breakdown passes from one UI
- **Review lanes**: Separate active execution, human follow-up, retakes, and history into distinct operating surfaces
- **Backend abstraction**: Route per repo to Knots or Beads through the same app contract
- **Keyboard-first workflow**: Fast navigation and action execution without living in terminal tabs
- **Responsive UI with live data**: React Query-backed updates, streaming session state, and mobile-aware layouts

---

## Architecture

### High-Level Overview

Foolery uses a **Next.js-based architecture** with clear separation between UI, orchestration logic, backend adapters, and repo-local memory data:

```
Client (React 19 + TypeScript)
    ↓
Next.js API Routes / SSE endpoints
    ↓
Foolery services (orchestration, sessions, settings, review flows)
    ↓
BackendPort adapters + agent adapters
    ↓
Knots / Beads CLI + agent CLIs
    ↓
Repo-local memory data + Git
```

### Layer Breakdown

#### **Frontend Layer**
- **Framework**: React 19 with TypeScript
- **Routing**: Next.js 16 App Router
- **State Management**:
  - Zustand for global UI state (modals, filters, sidebar state)
  - TanStack React Query for server data caching and synchronization
- **Form Handling**: react-hook-form for validation + Zod for schema validation
- **Component Library**: shadcn/ui (new-york style) with Tailwind CSS v4

#### **API + Service Layer**
- Server-side request handlers in `/src/app/api/`
- Application services for beats, orchestration, settings, terminal sessions, and review flows
- JSON APIs plus SSE streams for long-running work
- Error handling, status mapping, and request validation

#### **Backend Integration Layer**
- Memory manager CLIs (`kno`, `bd`) are invoked through the `BackendPort` abstraction
- Backend selection is automatic per repository based on marker detection (`.knots` or `.beads`)
- Agent CLIs are resolved separately through agent adapters and dispatch settings

#### **Data Storage**
- Repo-local memory data managed by Knots or Beads
- Git remains the durable history layer for repo state
- Foolery also writes session, log, and runtime artifacts outside the repo where appropriate

### Data Flow

1. **User action** (for example, create a beat or start a Take! session) → React component
2. **API call / stream subscription** → Next.js route
3. **Service orchestration** → Foolery service layer resolves repo, backend, and workflow behavior
4. **Backend or agent invocation** → `Bun.spawn()` / `execFile()` runs the selected CLI
5. **Repo or runtime mutation** → memory manager state, agent session state, or logs update
6. **Response / stream event** → JSON or SSE returned to client
7. **State refresh** → React Query invalidates and re-fetches as needed

---

## Tech Stack

### Core Framework
- **Next.js**: 16 (App Router, API Routes, SSR)
- **React**: 19 (Server Components, suspense boundaries)
- **TypeScript**: 5+ (strict mode)
- **Bun**: JavaScript runtime for command execution and lock file management

### Styling & Components
- **Tailwind CSS**: v4 (utility-first CSS framework)
- **shadcn/ui**: Component library (new-york style preset)
- **Lucide React**: Icon library with 400+ icons

### State Management & Data Fetching
- **TanStack React Query**: v5+ (server state caching, synchronization)
- **Zustand**: Lightweight state management for UI state
- **react-hook-form**: Form state and validation orchestration
- **Zod**: TypeScript-first schema validation

### Tables & UI Enhancements
- **TanStack Table**: v8 (headless table component)
- **cmdk**: Command palette component for Cmd+K navigation
- **sonner**: Toast notification system
- **react-hot-toast** (alternative): For toast notifications

### Development & Tooling
- **Storybook**: v10 (component documentation and isolated development)
- **Vitest**: Unit testing framework
- **ESLint**: Code quality and consistency
- **PostCSS**: CSS processing for Tailwind

---

## Data Model

### Bead Interface

All Beads conform to the following TypeScript interface:

```typescript
interface Bead {
  // Identifiers
  id: string;                    // Unique identifier (UUID)

  // Core Content
  title: string;                 // Issue title/headline
  description: string;           // Markdown-formatted description
  notes?: string;                // Additional notes/comments
  acceptance?: string;           // Acceptance criteria

  // Classification
  type: BeadType;               // Issue type (see enum below)
  status: BeadStatus;           // Current status (see enum below)
  priority: Priority;           // Priority level 0-4 (0=critical, 4=trivial)
  labels: string[];             // Tag labels for categorization

  // Assignment & Ownership
  assignee?: string;            // Assigned team member
  owner?: string;               // Issue creator/owner

  // Relationships
  parent?: string;              // Parent Bead ID for subtasks

  // Timing
  due?: Date;                   // Due date
  estimate?: number;            // Story points/time estimate
  created: Date;                // Creation timestamp
  updated: Date;                // Last modification timestamp
  closed?: Date;                // Closure timestamp (if closed)

  // Extensibility
  metadata?: Record<string, any>; // Custom key-value data
}
```

### Type Enumeration (BeadType)
- `bug`: Software defect
- `feature`: New functionality
- `task`: General work item
- `epic`: Large feature grouping multiple beads
- `chore`: Maintenance or non-feature work
- `merge-request`: Code review item
- `molecule`: Grouping of related work
- `gate`: Dependency/blocker item

### Status Enumeration (BeadStatus)
- `open`: Not started, available for work
- `in_progress`: Currently being worked on
- `blocked`: Blocked by dependencies
- `deferred`: Postponed or on hold
- `closed`: Completed or resolved

### Priority Enumeration
- `0`: Critical/blocker
- `1`: High/important
- `2`: Medium/normal
- `3`: Low/nice-to-have
- `4`: Trivial/documentation

---

## API Routes

Foolery exposes a RESTful JSON API over Next.js API Routes. The complete reference lives in two canonical locations:

- **Machine-readable**: [`GET /api/openapi.json`](/api/openapi.json) — OpenAPI 3.1.0 specification with schemas, examples, and error responses.
- **Human-readable**: [`docs/API.md`](./API.md) — Domain overview, workflow recipes, SSE streaming guide, and error-handling guidance.

### Quick Summary

| Domain | Key Endpoints |
|--------|--------------|
| Beats (CRUD) | `GET/POST /api/beats`, `GET/PATCH/DELETE /api/beats/[id]` |
| Beat Actions | `POST /api/beats/[id]/close`, `GET /api/beats/ready`, `POST /api/beats/query` |
| Dependencies | `GET/POST /api/beats/[id]/deps`, `GET /api/beats/batch-deps` |
| Waves | `GET /api/waves` |
| Terminal | `GET/POST/DELETE /api/terminal`, `GET /api/terminal/[sessionId]` (SSE) |
| Breakdown | `POST/DELETE /api/breakdown`, `GET /api/breakdown/[sessionId]` (SSE), `POST /api/breakdown/apply` |
| Orchestration | `GET/POST/DELETE /api/orchestration`, `GET /api/orchestration/[sessionId]` (SSE), `POST /api/orchestration/apply` |
| Settings | `GET/PUT/PATCH /api/settings`, `GET/POST/DELETE /api/settings/agents` |
| Registry | `GET/POST/DELETE /api/registry`, `GET /api/registry/browse` |
| System | `GET /api/doctor`, `GET /api/version`, `GET /api/capabilities`, `GET /api/workflows` |

All endpoints accept JSON, return JSON, and support multi-repo targeting via the `_repo` parameter. See the [API guide](./API.md) for full details.

---

## Component Inventory

### Badge Components

#### **StatusBadge**
Displays Bead status with color coding.
- **Props**: `status: BeadStatus`
- **Colors**:
  - `open`: Blue
  - `in_progress`: Yellow
  - `blocked`: Red
  - `deferred`: Gray
  - `closed`: Green
- **Features**: Customizable size, tooltips on hover

#### **PriorityBadge**
Displays priority level with icon and color.
- **Props**: `priority: Priority`
- **Colors**:
  - `0`: Red (critical)
  - `1`: Orange (high)
  - `2`: Blue (medium)
  - `3`: Gray (low)
  - `4`: Muted (trivial)

#### **TypeBadge**
Displays Bead type with icon.
- **Props**: `type: BeadType`
- **Features**: Icon for each type, customizable styling

#### **LabelBadge**
Displays custom labels/tags.
- **Props**: `label: string`, `onRemove?: () => void`
- **Features**: Removable for form contexts, color variety

---

### BeadTable

Advanced table component for listing and managing Beads.

**Features:**
- TanStack Table integration (v8)
- Sortable columns: ID, Title, Status, Priority, Type, Assignee, Due Date, Updated
- Selectable rows with bulk actions
- Searchable title column
- Pagination controls
- Responsive design with horizontal scroll on mobile
- Row click to open Bead detail view
- Context menu for quick actions

**Props:**
```typescript
interface BeadTableProps {
  beads: Bead[];
  isLoading: boolean;
  onBeadClick: (bead: Bead) => void;
  onBulkClose?: (ids: string[]) => void;
  onBulkAssign?: (ids: string[], assignee: string) => void;
}
```

---

### BeadForm

Form component for creating and editing Beads.

**Features:**
- react-hook-form with Zod validation
- Fields:
  - `title` (required): Text input with character counter
  - `description`: Markdown editor with preview
  - `type` (required): Dropdown selector
  - `priority`: Radio button group (0-4)
  - `status`: Dropdown selector
  - `assignee`: Combobox with autocomplete
  - `labels`: Tag input with suggestions
  - `due`: Date picker
  - `estimate`: Number input
  - `acceptance`: Markdown editor
- Optimistic submission (shows success before server confirmation)
- Auto-save drafts to localStorage
- Validation error display
- Submit and Cancel buttons

---

### CommandPalette

Command palette component for keyboard-driven navigation and actions.

**Activation:** Cmd+K (macOS) or Ctrl+K (Windows/Linux)

**Features:**
- Fuzzy search across commands and Beads
- Command categories:
  - Navigation (Go to Beads, Dashboard, etc.)
  - Actions (Create Bead, Close Bead, Assign, etc.)
  - Beads (Quick jump to recent/starred Beads)
- Keyboard navigation (Arrow keys, Enter to select)
- Escape to close
- Highlights matching text
- Recent actions history

**Implementation:** Uses `cmdk` library with custom filtering

---

### CreateBeadDialog

Modal dialog for quick Bead creation.

**Features:**
- Overlay backdrop with backdrop-blur
- Compact form (title, type, priority only)
- Quick submit keyboard shortcut (Cmd+Enter)
- Auto-focus on title field
- Success toast notification
- Cancel button and Escape key to close

**Integration:** Used from command palette and create button in header

---

### DependencyTree

Hierarchical visualization of Bead dependencies.

**Features:**
- Directed graph rendering
- Visual distinction:
  - Solid lines: blocks/blocked-by relationships
  - Dashed lines: related relationships
- Interactive nodes (click to jump to Bead)
- Zoom and pan controls
- Dependency summary (X blocks, Y blocked by, Z related)
- Lightweight implementation (SVG-based or similar)

**Implementation:** Custom React component with canvas or SVG

---

### FilterBar

Persistent filter controls for Bead listing.

**Features:**
- Status filter: Multi-select dropdown
- Type filter: Multi-select dropdown
- Priority filter: Range slider (0-4)
- Assignee filter: Searchable select
- Label filter: Tag multi-select
- Full-text search input
- Clear all filters button
- Filter count badge
- Persistent state via URL query params

**Implementation:** Zustand + URL search params for state

---

## UX Patterns

### Command Palette Navigation

**Pattern**: Cmd+K (macOS) / Ctrl+K (Windows/Linux)

- Primary means of navigation and action execution
- Context-aware suggestions based on current page
- Recent actions appear at top of results
- Search results filtered in real-time
- Keyboard-only interaction (no mouse required)

### Toast Notifications

**Pattern**: Sonner or similar library

- Success confirmations (Bead created, updated, closed)
- Error messages (API failures, validation errors)
- Auto-dismiss after 3-5 seconds
- Multiple toasts stack vertically
- Action buttons for undo/retry
- Position: Bottom-right by default

### Optimistic Updates

**Pattern**: React Query optimism

- Update UI immediately on action
- Async mutation in background
- Rollback on error with error toast
- Show loading state during mutation
- Example: Mark Bead as done → immediate UI update → API call → confirm or rollback

### URL-Based Routing

**Pattern**: Deep linking via query params

- Filter state in URL: `/beads?status=open&priority=0,1`
- Selected Bead ID in URL: `/beads/[id]` or `/beads?id=xyz`
- Sidebar state: `/beads?sidebar=closed`
- Allows sharing filtered views and bookmarking
- History navigation (back/forward) works as expected

### Responsive Design

**Breakpoints**: Tailwind CSS defaults (sm, md, lg, xl, 2xl)

- Mobile (< 768px):
  - Single column layout
  - Modal for BeadForm instead of sidebar
  - Vertical filter stacking
  - Touch-friendly button sizing (min 44px)

- Tablet (768px - 1024px):
  - Two-column layout possible
  - Sidebar collapses to icon-only

- Desktop (> 1024px):
  - Three-column layout (sidebar, table, details)
  - Full command palette
  - Expandable filter bar

### Empty State Handling

**Pattern**: Friendly empty states with CTAs

- No Beads: "No Beads found. [Create one →]"
- No search results: "No results match your filters. [Clear filters]"
- No dependencies: "This Bead has no dependencies"
- Loading state: Skeleton placeholders or spinner

### Error Boundary & Fallback

**Pattern**: React error boundaries

- Catch component errors and display fallback UI
- Log errors to console for debugging
- Provide "Retry" button to recover
- Don't let one Bead's error crash entire page

---

## Development Workflow

### Running Locally

```bash
# Install dependencies
bun install

# Start dev server
bun run dev

# Run Storybook
bun run storybook

# Run tests
bun run test

# Build for production
bun run build
```

### Project Structure

```
foolery/
├── src/
│   ├── app/                  # Next.js App Router
│   │   ├── api/              # API routes and SSE endpoints
│   │   ├── (routes)/         # Page routes
│   │   ├── layout.tsx        # Root layout
│   │   └── globals.css       # Global styles
│   ├── components/           # React components
│   │   ├── ui/               # shadcn/ui primitives
│   │   ├── badges/           # StatusBadge, PriorityBadge, etc.
│   │   ├── BeadTable.tsx
│   │   ├── BeadForm.tsx
│   │   ├── CommandPalette.tsx
│   │   ├── CreateBeadDialog.tsx
│   │   ├── DependencyTree.tsx
│   │   └── FilterBar.tsx
│   ├── lib/                  # Utilities and helpers
│   │   ├── query-client.ts   # React Query configuration
│   │   ├── bead-hooks.ts     # Custom hooks for Bead operations
│   │   ├── store.ts          # Zustand store
│   │   └── types.ts          # Type definitions
│   └── stories/              # Storybook stories
├── .storybook/               # Storybook configuration
├── docs/                     # Documentation
│   └── MANIFEST.md          # This file
├── public/                   # Static assets
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── components.json           # shadcn/ui config
└── README.md
```

### Testing Strategy

- **Unit Tests**: Component logic, utility functions (Vitest)
- **Integration Tests**: API route behavior with mocked `bd` commands
- **Storybook**: Visual regression and component documentation
- **E2E Tests**: (Optional) Full user workflows with actual `bd` CLI

---

## Future Enhancements

- Real-time collaboration features (WebSockets)
- Advanced analytics and reporting
- Custom workflow states
- Automation and triggers (auto-assign, status updates)
- Third-party integrations (Slack, GitHub, etc.)
- Offline mode with service workers
- Dark mode support
- Internationalization (i18n)

---

## Troubleshooting & FAQ

### Q: Why use `Bun.spawn()` instead of direct library integration?
**A:** The memory manager CLIs (`kno`, `bd`) are the source of truth for work item data. Using the CLI ensures all writes are validated by the memory manager's business logic and persist correctly to Git.

### Q: How are errors from `bd` commands handled?
**A:** API routes catch stderr output, parse error messages, and return appropriate HTTP status codes. UI shows toast notifications for user-facing errors.

### Q: Can I use Foolery without a memory manager CLI installed?
**A:** No. At least one supported memory manager CLI (`kno` or `bd`) must be installed and accessible in the system PATH. Foolery is an orchestration interface, not a standalone memory manager.

### Q: How do I extend the data model?
**A:** Add new fields to the `Bead` interface in `src/lib/types.ts`. Update forms, tables, and API routes to handle the new fields. The `metadata` field is available for custom data.

---

## Glossary

- **Beat**: A single issue, task, or work item managed by a memory manager CLI
- **Knots**: Primary memory manager backend (`kno` CLI)
- **Beads**: Alternative memory manager backend (`bd` CLI)
- **Foolery**: Agentic orchestration interface for managing beats across repositories
- **React Query**: Server state synchronization library
- **Zustand**: Lightweight state management
- **shadcn/ui**: Reusable component library based on Radix UI + Tailwind CSS

---

**Document Version:** 1.1
**Last Updated:** 2026-03-02
**Next Review:** After major feature additions or architecture changes
