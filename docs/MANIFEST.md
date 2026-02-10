# Foolery Project Manifest

## Project Overview

**Foolery** is a modern web UI for the Beads issue tracker—a git-based issue management system. The application provides an intuitive interface for viewing, creating, and managing Beads (issues) through a Next.js-based web application that leverages the `bd` CLI v0.49.6 as its backend service layer.

### Purpose

Foolery bridges the gap between command-line issue tracking and web-based project management, allowing teams to manage issues directly within a Git repository while providing a polished, responsive web interface for collaboration and task management.

### Key Features

- **Issue Viewing & Filtering**: Browse and search Beads with advanced filtering capabilities
- **Issue Creation & Editing**: Create and modify Beads through an intuitive form interface
- **Dependency Management**: Visualize and manage Bead dependencies with an interactive dependency tree
- **Command Palette**: Fast keyboard-driven navigation and actions via Cmd+K
- **Real-time Data**: React Query-powered data fetching with optimistic updates
- **Responsive Design**: Mobile-friendly interface with Tailwind CSS

---

## Architecture

### High-Level Overview

Foolery uses a **Next.js-based architecture** with clear separation of concerns:

```
Client (React 19 + TypeScript)
    ↓
Next.js API Routes (Backend Gateway)
    ↓
Bun.spawn() Process
    ↓
bd CLI v0.49.6 (Issue Tracker)
    ↓
Git Repository (Data Storage)
```

### Layer Breakdown

#### **Frontend Layer**
- **Framework**: React 19 with TypeScript
- **Routing**: Next.js 16 App Router
- **State Management**:
  - Zustand for global UI state (modals, filters, sidebar state)
  - TanStack React Query for server state caching and synchronization
- **Form Handling**: react-hook-form for validation + Zod for schema validation
- **Component Library**: shadcn/ui (new-york style) with Tailwind CSS v4

#### **API Layer (Next.js Routes)**
- Server-side request handlers in `/src/app/api/`
- Bridge between frontend and `bd` CLI
- Spawns child processes using `Bun.spawn()` to execute `bd` commands
- Handles JSON serialization/deserialization
- Implements error handling and status code mapping

#### **CLI Integration Layer**
- `bd` CLI v0.49.6 is invoked as a subprocess
- Communicates via stdin/stdout using JSON protocol
- Commands executed: `bd list`, `bd create`, `bd update`, `bd close`, `bd deps`, `bd query`

#### **Data Storage**
- Git repository containing Bead definitions
- `bd` CLI manages serialization and persistence
- All data is version-controlled

### Data Flow

1. **User Action** (e.g., create Bead) → React component
2. **API Call** → Next.js API route
3. **CLI Invocation** → `Bun.spawn()` executes `bd` command
4. **Data Mutation** → Git repository updated
5. **Response** → JSON returned to client
6. **State Update** → React Query invalidates cache & re-fetches

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

### Overview

The Foolery API provides RESTful endpoints that wrap `bd` CLI commands. All endpoints:
- Accept JSON payloads
- Return JSON responses
- Use standard HTTP status codes
- Run CLI commands via `Bun.spawn()`
- Handle errors gracefully

### Endpoints

#### **GET /api/beads**
List all Beads with optional filtering and sorting.

**Query Parameters:**
- `status?` (string): Filter by status
- `type?` (string): Filter by type
- `priority?` (number): Filter by priority
- `assignee?` (string): Filter by assignee
- `labels?` (string): Comma-separated label filters
- `sort?` (string): Sort field (default: 'updated')
- `order?` (asc|desc): Sort direction

**Response:** `{ beads: Bead[] }`

**Implementation:** Invokes `bd list` with JSON output, applies filters/sorts client-side

---

#### **POST /api/beads**
Create a new Bead.

**Body:**
```json
{
  "title": "string",
  "description": "string",
  "type": "feature|bug|task|...",
  "priority": 0-4,
  "labels"?: ["string"],
  "assignee"?: "string"
}
```

**Response:** `{ bead: Bead }`

**Implementation:** Invokes `bd create` with provided arguments

---

#### **GET /api/beads/ready**
Get all Beads ready for work (open, not blocked, assigned or available).

**Response:** `{ beads: Bead[] }`

**Implementation:** Filters Beads by status and dependency checks

---

#### **POST /api/beads/query**
Advanced query interface for complex filtering.

**Body:**
```json
{
  "filter": {
    "status": ["open", "in_progress"],
    "type": ["feature", "bug"],
    "priority": { "min": 0, "max": 2 },
    "assignee": "username",
    "labels": ["frontend", "ui"],
    "search": "search text"
  },
  "sort": { "field": "priority", "direction": "asc" }
}
```

**Response:** `{ beads: Bead[], total: number }`

**Implementation:** Complex filtering and full-text search on Bead collection

---

#### **GET /api/beads/[id]**
Retrieve a single Bead by ID.

**URL Parameters:**
- `id` (string): Bead ID

**Response:** `{ bead: Bead }`

**Implementation:** Invokes `bd show <id>` with JSON output

---

#### **PATCH /api/beads/[id]**
Update a Bead's properties.

**URL Parameters:**
- `id` (string): Bead ID

**Body:** Partial Bead object with fields to update
```json
{
  "title"?: "string",
  "description"?: "string",
  "status"?: "string",
  "priority"?: number,
  "assignee"?: "string",
  "labels"?: ["string"]
}
```

**Response:** `{ bead: Bead }`

**Implementation:** Invokes `bd update <id>` with provided fields

---

#### **DELETE /api/beads/[id]**
Delete/archive a Bead.

**URL Parameters:**
- `id` (string): Bead ID

**Response:** `{ success: boolean }`

**Implementation:** Invokes `bd delete <id>` or similar archive command

---

#### **POST /api/beads/[id]/close**
Close a Bead (mark as complete).

**URL Parameters:**
- `id` (string): Bead ID

**Body:**
```json
{
  "reason"?: "string"
}
```

**Response:** `{ bead: Bead }`

**Implementation:** Invokes `bd close <id>` with optional reason

---

#### **GET /api/beads/[id]/deps**
Get dependencies for a Bead (blockers, blocked-by, related).

**URL Parameters:**
- `id` (string): Bead ID

**Query Parameters:**
- `direction?` (in|out|both): Filter by dependency direction (default: both)

**Response:**
```json
{
  "bead": Bead,
  "dependencies": {
    "blocks": Bead[],
    "blockedBy": Bead[],
    "related": Bead[]
  }
}
```

**Implementation:** Invokes `bd deps <id>` with JSON output

---

#### **POST /api/beads/[id]/deps**
Create or update a dependency relationship.

**URL Parameters:**
- `id` (string): Bead ID

**Body:**
```json
{
  "targetId": "string",
  "type": "blocks|blockedBy|related"
}
```

**Response:** `{ dependency: { from: string, to: string, type: string } }`

**Implementation:** Invokes `bd link` or similar command

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
│   │   ├── api/              # API routes (bd CLI wrappers)
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
**A:** The `bd` CLI is the source of truth for Bead data. Using the CLI ensures all writes are validated by bd's business logic and persist correctly to Git.

### Q: How are errors from `bd` commands handled?
**A:** API routes catch stderr output, parse error messages, and return appropriate HTTP status codes. UI shows toast notifications for user-facing errors.

### Q: Can I use Foolery without the `bd` CLI installed?
**A:** No. The `bd` CLI v0.49.6 must be installed and accessible in the system PATH. Foolery is a UI wrapper, not a standalone issue tracker.

### Q: How do I extend the data model?
**A:** Add new fields to the `Bead` interface in `src/lib/types.ts`. Update forms, tables, and API routes to handle the new fields. The `metadata` field is available for custom data.

---

## Glossary

- **Bead**: A single issue, task, or work item managed by the `bd` CLI
- **bd CLI**: Command-line issue tracker that stores data in Git
- **Foolery**: Web UI for browsing and managing Beads
- **React Query**: Server state synchronization library
- **Zustand**: Lightweight state management
- **shadcn/ui**: Reusable component library based on Radix UI + Tailwind CSS

---

**Document Version:** 1.0
**Last Updated:** 2026-02-10
**Next Review:** After major feature additions or architecture changes
