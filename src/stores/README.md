# stores

Zustand state stores for global client-side state.

## Key Files

- **`app-store.ts`** — `useAppStore` — filters, view mode, active repo, registered repos, command palette, page size
- **`terminal-store.ts`** — `useTerminalStore` — terminal panel state, active sessions, scene queue, pending close
- **`notification-store.ts`** — `useNotificationStore` — in-app notifications with read/unread tracking

## Key Types

- `Filters` — Filter state shape (`state`, `type`, `priority`, `assignee`)
- `ActiveTerminal` — Running terminal session metadata (agent, beat, status)
- `QueuedBeat` — Beat queued for scene execution
- `Notification` — Notification entry with `beatId`, `message`, `read` flag

## Key Functions

- `selectUnreadCount()` — Selector for unread notification count
- `getActiveTerminal()` — Selector for the currently focused terminal session
- `computeTogglePanel()` — Derives next panel visibility state on toggle
