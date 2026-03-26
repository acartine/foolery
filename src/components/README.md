# components

React components for the Foolery UI.

## Key Files

- **`app-header.tsx`** — Top navigation bar with repo switcher, settings, and command palette trigger
- **`beat-table.tsx`** — Main beat list table with sorting, filtering, pagination, and bulk actions
- **`beat-detail.tsx`** — Beat detail lightbox with state dropdown, metadata, and edit form
- **`beat-form.tsx`** — Create/edit beat form with workflow and priority fields
- **`command-palette.tsx`** — Keyboard-driven command palette (Cmd+K)
- **`terminal-panel.tsx`** — Resizable bottom panel hosting agent terminal sessions
- **`agent-history-view.tsx`** — Agent execution history browser with conversation logs
- **`wave-planner.tsx`** — Wave planning UI for scheduling beat execution order
- **`settings-sheet.tsx`** — Settings side-sheet with agents, repos, dispatch, and defaults tabs
- **`retakes-view.tsx`** — Retake review interface for failed or incomplete beats
- **`breakdown-view.tsx`** — AI breakdown session viewer
- **`filter-bar.tsx`** — Filter controls for state, type, priority, and assignee
- **`providers.tsx`** — React Query and theme providers wrapper
- **`interaction-picker.tsx`** — Agent interaction type picker used during dispatch

## Subdirectories

- `ui/` — shadcn/ui primitives
- `__tests__/` — Component-level tests
