# hooks

Custom React hooks for Foolery UI state and side effects.

## Key Files

- **`use-terminal-panel-state.ts`** — Terminal panel open/close, resize, tab management, and xterm wiring
- **`use-terminal-xterm.ts`** — Xterm.js instance lifecycle and WebSocket attachment
- **`use-terminal-panel-effects.ts`** — Rehydration, fit-on-resize, scroll-to-active, and keyboard navigation
- **`use-terminal-auto-close.ts`** — Auto-close terminal tabs when sessions end
- **`use-terminal-tab-strip-state.ts`** — Tab strip scroll and overflow helpers
- **`use-agent-history-state.ts`** — Agent history data fetching, beat navigation, and clipboard
- **`use-agent-info.ts`** — Resolve agent vendor, model, and version from session metadata
- **`use-beat-detail-queries.ts`** — React Query hooks for beat detail, deps, and children
- **`use-beat-navigation.ts`** — Keyboard-driven beat list focus and window navigation
- **`use-elapsed-time.ts`** — Live elapsed-time counter for running sessions
- **`use-human-action-count.ts`** — Count of beats requiring human action
- **`use-scope-refinement-notifications.ts`** — Toast notifications for scope refinement events
- **`use-update-url.ts`** — Sync filter state to URL search params
- **`use-wait-spinner.ts`** — Animated spinner state for long-running operations
- **`use-window-focus-invalidation.ts`** — Invalidate React Query caches on window re-focus
- **`use-terminal-theme-preference.ts`** — Persist and apply terminal theme preference
- **`use-repo-switch-query-state.ts`** — Reset and repopulate query state on active-repo change
- **`use-beats-screen-warmup.ts`** — Preload queries and caches on first beats-screen mount
