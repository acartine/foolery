---
foolery: minor
---

Ship a minor release focused on backend portability and workflow reliability.

- Add a `BackendPort` abstraction plus CLI/JSONL adapters, capability flags, and backend contract coverage to decouple Foolery from direct `bd` calls.
- Improve Beads persistence/query behavior, including parent serialization, close reason/dependency round-trips, query filters, and cascade-close handling.
- Improve UX in key workflows: persistent minimized terminals for running Take!/Scene! sessions, richer Agent History navigation/loading states, tracker-type badges in settings, and better final-cut invalidation.
- Harden reliability with timeout/polling fixes, lock-failure degradation, and legacy tracker metadata backfill.
- Expand docs with backend extension guidance and tracker integration documentation.
