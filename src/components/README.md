# components

React components for the Foolery UI.

## Key Files

- **`app-header.tsx`** — Top navigation bar with repo switcher, settings, and command palette trigger
- **`beat-table.tsx`** — Main beat list table with sorting, filtering, pagination, and bulk actions
- **`beat-detail.tsx`** — Beat detail lightbox with state dropdown, metadata, and edit form
- **`beat-form.tsx`** — Create/edit beat form with workflow and priority fields
- **`create-beat-dialog.tsx`** — Modal dialog wrapper for the beat-creation flow
- **`command-palette.tsx`** — Keyboard-driven command palette (Cmd+K)
- **`terminal-panel.tsx`** — Resizable bottom panel hosting agent terminal sessions
- **`agent-history-view.tsx`** — Agent execution history browser with conversation logs
- **`conversation-log-panels.tsx`** — Conversation-log render panels for the history view
- **`history-debug-panel.tsx`** — Debug inspector for raw agent history events
- **`wave-planner.tsx`** — Wave planning UI for scheduling beat execution order
- **`setlist-view.tsx`** — Setlist / execution-plan Gantt view for staged beats
- **`final-cut-view.tsx`** — Post-session review surface for final-cut beats
- **`retakes-view.tsx`** — Retake review interface for failed or incomplete beats
- **`lease-audit-view.tsx`** — Lease audit log browser
- **`settings-sheet.tsx`** — Settings side-sheet with agents, repos, dispatch, and defaults tabs
- **`directory-browser.tsx`** — Filesystem directory picker (used by repo registration)
- **`repo-switcher.tsx`** — Active-repo selector in the app header
- **`notification-bell.tsx`** — Header bell with unread notification count
- **`filter-bar.tsx`** — Filter controls for state, type, priority, and assignee
- **`interaction-picker.tsx`** — Agent interaction type picker used during dispatch
- **`providers.tsx`** — React Query and theme providers wrapper

## Subdirectories

- `ui/` — shadcn/ui primitives
- `__tests__/` — Component-level tests
