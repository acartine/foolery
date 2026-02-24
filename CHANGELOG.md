# foolery

## 0.3.0

### Minor Changes

- f3eaab9: Ship a minor release focused on backend portability and workflow reliability.

  - Add a `BackendPort` abstraction plus CLI/JSONL adapters, capability flags, and backend contract coverage to decouple Foolery from direct `bd` calls.
  - Improve Beads persistence/query behavior, including parent serialization, close reason/dependency round-trips, query filters, and cascade-close handling.
  - Improve UX in key workflows: persistent minimized terminals for running Take!/Scene! sessions, richer Agent History navigation/loading states, memory manager type badges in settings, and better final-cut invalidation.
  - Harden reliability with timeout/polling fixes, lock-failure degradation, and legacy memory manager metadata backfill.
  - Expand docs with backend extension guidance and memory manager integration documentation.

## 0.2.0

### Minor Changes

- 0805b3f: Ship a minor release with auto-verification workflow support, richer agent history views, Direct/Beads UX improvements, and settings backfill safeguards for existing installs. Also adopt a Changesets-managed release process.
