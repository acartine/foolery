# Failure Modes and Edge Cases Audit

This document catalogs all known failure modes, retry logic, error suppression,
and edge cases in the Foolery codebase. Each entry describes the trigger, current
handling, severity, and what the new abstraction layer must account for.

**Audit date:** 2026-02-22
**Scope:** `src/lib/`, `src/app/api/`, `src/components/`, `src/hooks/`, `src/stores/`
**Recent fix commits reviewed:** 063d97a, d313256, 400d057, c6902fe, cc0d6ca

---

## 1. Concurrency and Locking

### 1.1 Repo-Level Process Lock Timeout

- **Location:** `src/lib/bd.ts` lines 140-178 (`acquireRepoProcessLock`)
- **Trigger:** Two bd commands target the same repo simultaneously (e.g., parallel
  list + update). The second caller polls `LOCK_POLL_MS` (50 ms) until
  `LOCK_WAIT_TIMEOUT_MS` (5 s) expires, then throws a `Timed out waiting for bd
  repo lock` error.
- **Current handling:** The `exec()` wrapper (line 348-380) catches the thrown
  lock-timeout error and sets `timedOut: true` on the result. If the command is
  read-only or idempotent-write, it retries once (`MAX_TIMEOUT_RETRIES = 1`).
  Non-retryable commands (create, delete) fail immediately.
- **Severity:** UX degradation -- stale data served or toast error shown. No data
  loss because the underlying bd CLI was never invoked.
- **Abstraction implication:** The abstraction must serialize repo-scoped commands,
  expose a configurable timeout, and distinguish retryable from non-retryable
  operations.

### 1.2 Stale Lock File (Orphaned Lock)

- **Location:** `src/lib/bd.ts` lines 120-138 (`evictStaleRepoLock`)
- **Trigger:** A process crashes or is killed without releasing its lock directory
  under `$TMPDIR/foolery-bd-locks/<sha1>`.
- **Current handling:** On each lock acquisition attempt, the module checks
  `owner.json` for the owning PID and calls `process.kill(pid, 0)`. If the PID is
  dead, the lock dir is force-removed. A fallback evicts any lock older than
  `LOCK_STALE_MS` (10 min).
- **Severity:** Temporary command blockage (up to 10 min worst case) until the stale
  lock is evicted.
- **Abstraction implication:** Lock hygiene must be automatic. The abstraction should
  provide a lock-release guarantee (try/finally) and a startup sweep for orphaned
  locks.

### 1.3 In-Process Execution Queue Head-of-Line Blocking

- **Location:** `src/lib/bd.ts` lines 180-222 (`withRepoSerialization`)
- **Trigger:** A slow bd command (e.g., a large `sync --import-only`) holds the
  per-repo queue, blocking all subsequent commands for that repo.
- **Current handling:** Commands are chained via promise-based FIFO queue keyed by
  resolved repo path. There is no priority mechanism; a slow write blocks fast
  reads.
- **Severity:** Latency spike for all subsequent commands. In the worst case a
  timed-out command still holds the queue until its finally block runs.
- **Abstraction implication:** The abstraction should consider read/write priority
  lanes or at least expose queue depth metrics so the UI can show degradation.

### 1.4 Verification Lock Contention

- **Location:** `src/lib/verification-workflow.ts` lines 288-318
  (`acquireVerificationLock`)
- **Trigger:** Two verification workflows trigger for the same bead simultaneously
  (e.g., rapid agent completions).
- **Current handling:** In-memory `Map` with a 10-minute stale timeout. The second
  caller gets `false` and silently skips. There is no queue; the second request is
  simply dropped.
- **Severity:** Silent failure -- a verification attempt is lost. If the first
  attempt fails, the bead may be left in an inconsistent state with no automatic
  re-trigger.
- **Abstraction implication:** The abstraction must provide either a queue or a
  re-check mechanism so that dropped verification requests are eventually retried.

### 1.5 Verification Edit Lock (transition:verification Label)

- **Location:** `src/app/api/beads/[id]/route.ts` lines 107-116 (PATCH) and
  lines 154-164 (DELETE)
- **Trigger:** A user attempts to edit or delete a bead while auto-verification is
  running (`transition:verification` label present).
- **Current handling:** HTTP 409 Conflict with a descriptive error message. The
  frontend shows a toast but does not retry or queue the edit.
- **Severity:** UX frustration -- the user cannot make changes during verification.
  If verification gets stuck (verifier crashes without releasing the label), the
  bead is permanently locked until manual label removal.
- **Abstraction implication:** The abstraction must expose lock state to the UI and
  provide an escape hatch (manual override or timeout-based auto-release) for stuck
  verification labels.

---

## 2. Network and Sync

### 2.1 bd CLI Command Timeout

- **Location:** `src/lib/bd.ts` lines 284-317 (`execOnce`)
- **Trigger:** The bd CLI process does not exit within `COMMAND_TIMEOUT_MS` (5 s
  default, configurable). The child is killed via `SIGKILL`.
- **Current handling:** The result is marked `timedOut: true` and the stderr is
  prepended with a timeout message. The `exec()` wrapper retries once for
  retryable commands.
- **Severity:** High for writes (create/delete may partially apply before kill).
  Low for reads (retry with no-db fallback covers most cases).
- **Abstraction implication:** The abstraction must track whether a timed-out write
  may have partially applied and provide idempotent retry semantics.

### 2.2 Database Out-of-Sync Auto-Heal

- **Location:** `src/lib/bd.ts` lines 319-346 (`execSerializedAttempt`)
- **Trigger:** The embedded Dolt DB gets out of sync with the JSONL source of truth
  (e.g., after a repo switch or git pull that changes `.beads/`).
- **Current handling:** If stderr contains `Database out of sync with JSONL`, the
  module runs `bd sync --import-only` and retries the original command once. If
  sync itself fails, the original error is returned.
- **Severity:** Medium -- temporary inability to read/write beads until sync
  completes. The auto-heal is transparent to callers.
- **Abstraction implication:** The abstraction should expose sync status and
  potentially trigger preemptive sync on repo-switch events rather than waiting
  for a command to fail.

### 2.3 Dolt Nil-Pointer Panic Recovery

- **Location:** `src/lib/bd.ts` lines 271-274 (`isEmbeddedDoltPanic`) and
  lines 328-334
- **Trigger:** The embedded Dolt database hits a nil pointer dereference
  (`panic: runtime error: invalid memory address`) during a read operation.
- **Current handling:** If the first attempt fails with this panic signature and
  the command is read-only, the module retries once with `BD_NO_DB=true` to
  bypass Dolt entirely and read from JSONL.
- **Severity:** Medium -- the panic is non-deterministic. JSONL fallback is
  slightly slower but functionally equivalent for reads.
- **Abstraction implication:** The abstraction should default to JSONL-first reads
  and treat the Dolt DB as an optional accelerator, not a required dependency.

### 2.4 SSE Stream Disconnection

- **Location:** `src/app/api/terminal/[sessionId]/route.ts` (full file) and
  `src/lib/terminal-api.ts` lines 54-81 (`connectToSession`)
- **Trigger:** Client disconnects (tab close, navigation, network drop) or the
  server-side ReadableStream errors during `controller.enqueue`.
- **Current handling:** Server side: `request.signal.addEventListener("abort")`
  triggers cleanup. Client side: `EventSource.onerror` fires and closes the
  connection. If an `exit` event was already received, the error is silently
  ignored.
- **Severity:** Low if the session is completed (exit event in buffer). Medium if
  the session is still running -- the client loses live output. Reconnection
  replays the buffer but may miss events between disconnect and reconnect.
- **Abstraction implication:** The abstraction must ensure SSE reconnection replays
  missed events. The buffer (`MAX_BUFFER = 5000`) is a fixed window; events
  before the window are permanently lost.

### 2.5 --no-daemon Flag Compatibility Fallback

- **Location:** `src/lib/bd.ts` lines 382-392 (`execWithNoDaemonFallback`)
- **Trigger:** Older bd CLI versions do not recognize the `--no-daemon` flag,
  producing an `unknown flag` error.
- **Current handling:** If the first attempt includes `--no-daemon` and fails with
  the unknown-flag signature, the module strips the flag and retries.
- **Severity:** Low -- transparent fallback. The retry adds latency (5 s timeout
  window per attempt).
- **Abstraction implication:** The abstraction must handle CLI version skew
  gracefully, either by probing capabilities at startup or always using fallback
  chains.

---

## 3. Data Consistency

### 3.1 bd Daemon Label Remove Persistence Bug

- **Location:** `src/lib/bd.ts` lines 640-684 (updateBead label operations)
- **Trigger:** The bd daemon's `label remove` command acknowledges success but does
  not persist the removal. Labels reappear on the next `list` or `show` call.
- **Current handling:** All label remove operations use `--no-daemon` to bypass
  the daemon and write directly to the DB. After label removes, a `bd sync
  --no-daemon` flushes changes to JSONL so the daemon's auto-import picks up the
  direct DB writes.
- **Severity:** High -- silent data corruption. Without the workaround, stage
  labels are never actually removed, breaking the verification workflow.
- **Abstraction implication:** This is a critical bd CLI bug. The abstraction must
  always use direct-write mode for label mutations and sync afterward.

### 3.2 Stage Label Mutual Exclusivity Enforcement

- **Location:** `src/lib/bd.ts` lines 610-632
- **Trigger:** Frontend or API caller adds a `stage:*` label without removing the
  previous one (e.g., adding `stage:retry` without removing `stage:verification`).
- **Current handling:** The `updateBead` function detects any `stage:*` label in
  the add list, fetches the current bead state, and auto-removes all other
  `stage:*` labels. This is a defensive measure against regressions in frontend
  payload construction.
- **Severity:** Medium -- stale stage labels cause incorrect workflow state. The
  auto-correction adds an extra `showBead` call on every stage-label mutation.
- **Abstraction implication:** The abstraction should enforce label invariants
  (mutual exclusivity of stage labels, monotonic attempt counters) at the domain
  layer rather than in the CLI wrapper.

### 3.3 Merge Operation Non-Atomicity

- **Location:** `src/app/api/beads/merge/route.ts` lines 10-100
- **Trigger:** A merge operation updates the survivor bead and then closes the
  consumed bead as two separate bd commands. If the close fails after the update
  succeeds, the survivor has merged content but the consumed bead remains open.
- **Current handling:** Each step returns 500 on failure, but there is no rollback
  of the first step if the second fails.
- **Severity:** Medium -- inconsistent state where merged content appears on both
  beads. Manual intervention required to close the consumed bead.
- **Abstraction implication:** The abstraction must provide transaction-like
  semantics for multi-step mutations, or at minimum, compensating actions on
  partial failure.

### 3.4 Regroom Cascade on Stale In-Memory Data

- **Location:** `src/lib/regroom.ts` lines 42-92
- **Trigger:** After closing a child bead, `regroomAncestors` loads all beads via
  `listBeads({})` and walks up the hierarchy. If the list is stale (e.g., cache
  hit from `bd-error-suppression`), the regroom may incorrectly close a parent
  whose children are not actually all closed.
- **Current handling:** The regroom runs fire-and-forget (errors logged, never
  thrown). The in-memory map is updated after each close to support cascading, but
  the initial load may be stale.
- **Severity:** Medium-High -- premature parent closure is a data integrity issue.
  The parent can be re-opened manually, but the user may not notice.
- **Abstraction implication:** The abstraction must ensure regroom reads bypass
  any error-suppression cache to get fresh data.

### 3.5 Batch Dependency Fetch Silent Failures

- **Location:** `src/app/api/beads/batch-deps/route.ts` lines 18-25
- **Trigger:** When fetching dependencies for multiple beads, individual `listDeps`
  calls may fail. The route silently returns an empty array for failed beads.
- **Current handling:** `result.ok ? result.data ?? [] : []` -- failed deps are
  indistinguishable from beads with no dependencies.
- **Severity:** Low-Medium -- the UI shows missing dependency arrows. The user has
  no indication that a dep fetch failed vs. no deps exist.
- **Abstraction implication:** The abstraction should distinguish "no deps" from
  "failed to load deps" in its response type.

---

## 4. UI State

### 4.1 Degraded Store Banner with Stale Data

- **Location:** `src/app/beads/page.tsx` lines 25-174 (BeadsPageInner query logic)
- **Trigger:** The backend returns HTTP 503 (degraded store) when the
  bd-error-suppression layer exhausts its 2-minute suppression window.
- **Current handling:** React Query keeps previous data (`keepPreviousData`
  behavior via `DegradedStoreError` throw). The UI shows an amber warning banner
  and continues displaying stale beads. Retry is suppressed for degraded errors.
- **Severity:** Medium -- the user sees stale data with no clear indication of
  how stale it is. There is no timestamp on the banner.
- **Abstraction implication:** The abstraction should expose cache age metadata so
  the UI can display "data from X minutes ago" during degraded operation.

### 4.2 Bead Detail Polling Loop on 404

- **Location:** `src/components/bead-detail-lightbox.tsx` lines 51-58
- **Trigger:** A bead is deleted or moved while the detail lightbox is open. The
  `fetchBead` call returns 404, and React Query retries.
- **Current handling:** Fixed in commit c6902fe: `retry: 1` and
  `refetchOnWindowFocus: false` limit the polling. Before the fix, the query
  would retry indefinitely with default settings.
- **Severity:** Low after fix -- one retry on 404, then stops. Before fix: high
  (continuous polling loop generating unnecessary API traffic).
- **Abstraction implication:** The abstraction's query layer should have
  404-aware retry logic that stops immediately on "not found" errors.

### 4.3 Optimistic Update Rollback on Conflict

- **Location:** `src/components/bead-detail-lightbox.tsx` lines 68-130
- **Trigger:** An optimistic UI update (via `onMutate`) succeeds locally, but the
  server rejects the PATCH (e.g., 409 verification lock or 500 bd error).
- **Current handling:** The `onError` callback restores the previous cache
  snapshot for both the individual bead and the beads list queries. A toast error
  is displayed.
- **Severity:** Low -- the rollback is well-implemented. Edge case: if the user
  makes rapid edits, the rollback snapshot may be stale (it captures the state
  at mutation start, not at the latest mutation).
- **Abstraction implication:** The abstraction should handle optimistic mutation
  queueing to ensure rollback snapshots are ordered correctly.

### 4.4 Multi-Repo Partial Degradation

- **Location:** `src/app/beads/page.tsx` lines 131-154
- **Trigger:** When fetching beads from all registered repos, some repos may
  return degraded (503) while others succeed.
- **Current handling:** The query collects results from all repos via
  `Promise.all`. Degraded repos contribute empty arrays. If ALL repos are
  degraded and the merged result is empty, a `DegradedStoreError` is thrown.
  Otherwise, the `_degraded` flag is set on the result but stale data for the
  degraded repos is lost.
- **Severity:** Medium -- partial data loss in multi-repo mode. The user sees
  beads only from healthy repos with no per-repo degradation indicator.
- **Abstraction implication:** The abstraction must support per-repo health
  status and merge stale cached data from degraded repos with fresh data from
  healthy repos.

### 4.5 Terminal Store Session Leak

- **Location:** `src/stores/terminal-store.ts`, `src/lib/terminal-manager.ts`
  lines 28-31
- **Trigger:** Sessions are capped at `MAX_SESSIONS = 5` on the server. The
  client terminal store has no corresponding cap. If the server evicts old
  sessions during cleanup, the client store retains references to sessions that
  no longer exist.
- **Current handling:** The client store does not poll session existence. A user
  clicking on a stale session entry gets a 404 from the SSE endpoint.
- **Severity:** Low -- cosmetic. The stale session entry is non-functional but
  visible in the UI.
- **Abstraction implication:** The abstraction should provide session lifecycle
  events that the client store can subscribe to for cleanup.

### 4.6 View-Specific Polling Waste

- **Location:** `src/app/beads/page.tsx` lines 354-402
- **Trigger:** Before commit c6902fe, all views (list, orchestration, finalcut,
  etc.) were rendered but hidden via CSS. This meant React Query polling continued
  for unmounted-but-rendered views.
- **Current handling:** Fixed in c6902fe: views use conditional rendering instead
  of CSS visibility. Only the active view is mounted and polls.
- **Severity:** Low after fix. Before fix: high API traffic amplification (every
  view polled every 10 s regardless of visibility).
- **Abstraction implication:** The abstraction's polling layer should be
  lifecycle-aware, pausing when components unmount.

---

## 5. CLI Integration

### 5.1 bd Binary Not Found

- **Location:** `src/lib/bd.ts` line 8 (`BD_BIN = process.env.BD_BIN ?? "bd"`)
- **Trigger:** The `bd` binary is not installed or not in `$PATH`.
- **Current handling:** Every `execOnce` call will fail with an ENOENT error from
  `execFile`. This propagates as a generic "Failed to run bd command" error. The
  doctor module (`src/lib/doctor.ts` line 90-100) checks agent health via
  `pingAgent` but does not specifically verify the bd binary.
- **Severity:** Critical -- the entire application is non-functional without bd.
  There is no startup probe or health check for the bd binary itself.
- **Abstraction implication:** The abstraction must perform a bd binary capability
  check at startup and surface the result clearly in the UI.

### 5.2 Agent CLI Dialect Mismatch

- **Location:** `src/lib/agent-adapter.ts` lines 28-33 (`resolveDialect`)
- **Trigger:** The user registers an agent whose binary name does not contain
  "codex" but uses Codex-style CLI flags, or vice versa.
- **Current handling:** Dialect detection is purely name-based (`includes("codex")`).
  If the detection is wrong, the spawned agent receives incorrect flags and
  either fails to start or produces unparseable output.
- **Severity:** Medium -- silent failure. The terminal shows garbled output or
  the agent process exits with a non-zero code.
- **Abstraction implication:** The abstraction should validate dialect detection
  at agent registration time (e.g., probe `--help` output) rather than guessing
  at invocation time.

### 5.3 Auto-Ask-User Response Heuristic

- **Location:** `src/lib/terminal-manager.ts` lines 50-88
  (`buildAutoAskUserResponse`)
- **Trigger:** An agent emits an `ask_user` event during ship mode (non-interactive
  invocation). The system auto-responds with a "choose first option" heuristic.
- **Current handling:** The auto-response always picks the first option and instructs
  the agent to proceed. If the first option is destructive or incorrect, the agent
  follows it blindly.
- **Severity:** Medium-High -- the heuristic can lead to incorrect agent behavior.
  There is no logging of which questions were auto-answered and what the choices
  were.
- **Abstraction implication:** The abstraction should log auto-answered questions,
  allow configurable response strategies, and provide a post-hoc audit trail.

### 5.4 Completion Follow-Up Prompt Not Delivered

- **Location:** `src/lib/terminal-manager.ts` lines 99-137
  (`buildSingleBeadCompletionFollowUp`, `buildSceneCompletionFollowUp`)
- **Trigger:** After an agent session completes, a follow-up prompt is piped to
  stdin to trigger verification state updates. If `stdin` is already closed or
  the process exited before the follow-up is written, the prompt is lost.
- **Current handling:** Fixed in commit 063d97a: scene follow-ups were restored.
  The `stdin.write` call (line 521) is wrapped in try/catch but the catch only
  returns `false` -- the caller has no retry mechanism.
- **Severity:** Medium -- if the follow-up is lost, the bead does not transition
  to `stage:verification` and remains in `in_progress` indefinitely. The
  verification orchestrator's fallback (`onAgentComplete`) may or may not fire
  depending on the exit code path.
- **Abstraction implication:** The abstraction must guarantee delivery of
  lifecycle events (completion, follow-up) through a durable channel rather than
  relying on stdin write success.

### 5.5 Settings File Parse Error on Startup

- **Location:** `src/lib/settings.ts` lines 104-125 (`readRawSettings`) and
  `src/instrumentation.ts`
- **Trigger:** The `settings.toml` file exists but contains invalid TOML syntax.
- **Current handling:** The TOML parse error is caught and the module falls back to
  `DEFAULT_SETTINGS`. A warning is logged at startup. The doctor module
  (`inspectSettingsDefaults`) surfaces the error as a diagnostic.
- **Severity:** Medium -- the application runs with defaults, which may not match
  the user's intent. Settings edits via the UI will overwrite the corrupt file.
- **Abstraction implication:** The abstraction should preserve a backup of the
  corrupt file before overwriting and present the parse error in the settings UI.

### 5.6 Verification Orchestrator Interaction Log Failure

- **Location:** `src/lib/verification-orchestrator.ts` lines 228-236
- **Trigger:** `startInteractionLog` fails (e.g., disk full, permissions error).
- **Current handling:** The error is caught and a `noopInteractionLog()` is
  returned. The verification workflow continues without logging. No retry.
- **Severity:** Low for functionality (verification still runs). Medium for
  auditability (the verification session has no log trail, making debugging
  impossible).
- **Abstraction implication:** The abstraction should treat logging failures as
  degraded-but-operational and surface them in the doctor report.

---

## 6. Error Suppression and Caching

### 6.1 Error Suppression Window Expiration

- **Location:** `src/lib/bd-error-suppression.ts` lines 90-151
- **Trigger:** A bd list/ready/search command fails continuously for more than 2
  minutes (`SUPPRESSION_WINDOW_MS`).
- **Current handling:** During the first 2 minutes, the last successful result is
  returned silently. After 2 minutes, a `DEGRADED_ERROR_MESSAGE` is returned
  (mapped to HTTP 503). On the next success, failure tracking is cleared.
- **Severity:** Medium -- the 2-minute stale window is invisible to the user. The
  transition from "silently stale" to "visibly degraded" is abrupt.
- **Abstraction implication:** The abstraction should expose staleness metadata
  (last-success timestamp, consecutive-failure count) so the UI can show
  progressive degradation rather than an abrupt switch.

### 6.2 Error Suppression Cache Eviction Under Load

- **Location:** `src/lib/bd-error-suppression.ts` lines 70-84
- **Trigger:** More than 64 unique cache keys are created (e.g., many repos with
  different filter combinations).
- **Current handling:** LRU-style eviction removes the oldest entry. This may evict
  a still-useful cached result during a lock contention event.
- **Severity:** Low -- the eviction only affects suppression (stale data served).
  The underlying bd commands still retry normally.
- **Abstraction implication:** The abstraction should use a time-based TTL for
  suppression cache entries rather than a fixed-size LRU.

### 6.3 Bead Detail Cache on Lock Timeout

- **Location:** `src/app/api/beads/[id]/route.ts` lines 19-50, 58-90
- **Trigger:** A `showBead` call fails due to a lock timeout. The detail endpoint
  checks its in-memory cache (10-minute TTL) and returns the cached bead with a
  `cached: true` flag.
- **Current handling:** Added in commit d313256. The client receives stale data
  with metadata (`cached`, `cachedAt`). If no cache entry exists, HTTP 503 is
  returned.
- **Severity:** Low -- the client knows the data is cached. Edge case: the cache
  is per-process and not shared across Next.js worker processes, so different
  requests may see different cached states.
- **Abstraction implication:** The abstraction should use a shared cache (e.g.,
  file-backed) rather than in-memory maps to ensure consistency across workers.

---

## 7. Summary Table

| ID   | Category           | Severity    | Has Retry | Has Cache | Abstraction Priority |
|------|--------------------|-------------|-----------|-----------|----------------------|
| 1.1  | Concurrency        | Medium      | Yes (1x)  | No        | High                 |
| 1.2  | Concurrency        | Medium      | No        | No        | Medium               |
| 1.3  | Concurrency        | Medium      | No        | No        | Medium               |
| 1.4  | Concurrency        | Medium      | No        | No        | High                 |
| 1.5  | Concurrency        | Medium      | No        | No        | High                 |
| 2.1  | Network/Sync       | High        | Yes (1x)  | No        | High                 |
| 2.2  | Network/Sync       | Medium      | Yes (1x)  | No        | Medium               |
| 2.3  | Network/Sync       | Medium      | Yes (1x)  | No        | Medium               |
| 2.4  | Network/Sync       | Medium      | No        | Yes       | Medium               |
| 2.5  | Network/Sync       | Low         | Yes (1x)  | No        | Low                  |
| 3.1  | Data Consistency   | High        | No        | No        | Critical             |
| 3.2  | Data Consistency   | Medium      | No        | No        | High                 |
| 3.3  | Data Consistency   | Medium      | No        | No        | High                 |
| 3.4  | Data Consistency   | Medium-High | No        | No        | High                 |
| 3.5  | Data Consistency   | Low-Medium  | No        | No        | Low                  |
| 4.1  | UI State           | Medium      | No        | Yes       | Medium               |
| 4.2  | UI State           | Low         | Yes (1x)  | No        | Low                  |
| 4.3  | UI State           | Low         | No        | Yes       | Low                  |
| 4.4  | UI State           | Medium      | No        | Partial   | Medium               |
| 4.5  | UI State           | Low         | No        | No        | Low                  |
| 4.6  | UI State           | Low         | No        | No        | Low                  |
| 5.1  | CLI Integration    | Critical    | No        | No        | Critical             |
| 5.2  | CLI Integration    | Medium      | No        | No        | Medium               |
| 5.3  | CLI Integration    | Medium-High | No        | No        | Medium               |
| 5.4  | CLI Integration    | Medium      | No        | No        | High                 |
| 5.5  | CLI Integration    | Medium      | No        | No        | Low                  |
| 5.6  | CLI Integration    | Low-Medium  | No        | No        | Low                  |
| 6.1  | Error Suppression  | Medium      | No        | Yes       | Medium               |
| 6.2  | Error Suppression  | Low         | No        | Yes       | Low                  |
| 6.3  | Error Suppression  | Low         | No        | Yes       | Medium               |

---

## 8. Key Patterns for the Abstraction Layer

Based on this audit, the new abstraction layer must account for these
cross-cutting concerns:

1. **Serialized execution with priority** -- reads should not be blocked by slow
   writes. Consider read/write lanes or optimistic reads from JSONL cache.

2. **Idempotent retry with deduplication** -- all retryable operations need
   idempotency tokens. The current retry logic is implicit (command type
   classification); it should be explicit.

3. **Label invariant enforcement** -- stage label mutual exclusivity, attempt
   counter monotonicity, and transition label cleanup should be domain-layer
   responsibilities, not CLI wrapper hacks.

4. **Cache-aware error suppression** -- expose staleness metadata (age,
   consecutive failures) to the UI layer. Avoid abrupt degradation transitions.

5. **Transaction-like multi-step mutations** -- merge, verification transitions,
   and regroom cascades all involve multiple bd commands. Partial failure must
   trigger compensating actions.

6. **CLI version and capability probing** -- detect bd binary presence, daemon
   support (`--no-daemon`), and CLI dialect at startup rather than at first use.

7. **Lifecycle event durability** -- completion follow-ups and verification
   triggers must not depend on stdin write success. Use a persistent event queue.

8. **Per-worker cache consistency** -- in-memory caches (detail cache, error
   suppression cache) are not shared across Next.js workers. Consider
   file-backed or shared-memory alternatives for production deployments.
