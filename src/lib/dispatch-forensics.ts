/**
 * Dispatch forensics orchestrator (foolery-dd9c).
 *
 * Public surface:
 *   - captureBeatSnapshot(boundary, ctx, deps)
 *   - runPostTurnForensics(pre, post, ctx, signals, deps)
 *
 * Both APIs are fire-and-forget from the take loop's perspective —
 * snapshot writes and audit emits are awaited internally but the
 * functions never re-throw into the take loop. A capture error is
 * recorded in `BeatSnapshot.captureErrors` and the snapshot file is
 * still written (with whatever data was collected) so an
 * investigator sees the gap rather than a missing file.
 *
 * Dependencies (snapshot writer, kno data fetchers, audit logger,
 * banner pusher) are injected so unit tests stay hermetic per the
 * project's Hermetic Test Policy.
 */

import type { KnotRecord } from "@/lib/knots";
import { logLeaseAudit } from "@/lib/lease-audit";
import {
  showKnot as defaultShowKnot,
  listLeases as defaultListLeases,
} from "@/lib/knots";
import {
  buildForensicBannerBody,
  classifyTurnFailure,
  emitForensicBanner,
  type ClassifierSignals,
} from "@/lib/dispatch-forensics-classify";
import {
  createFsSnapshotWriter,
  type SnapshotWriter,
} from "@/lib/dispatch-forensics-storage";
import type {
  BeatSnapshot,
  CaptureContext,
  DispatchForensicBoundary,
} from "@/lib/dispatch-forensics-types";

const KNO_FETCH_TIMEOUT_MS = 5000;

export interface ForensicDeps {
  writer?: SnapshotWriter;
  showKnot?: typeof defaultShowKnot;
  listLeases?: typeof defaultListLeases;
  /**
   * Called with the assembled audit-event payload. Defaults to
   * `logLeaseAudit`. Tests inject an in-memory recorder.
   */
  logAudit?: (
    event: string,
    payload: Record<string, unknown>,
  ) => Promise<void> | void;
  /**
   * Push a banner string into the session UI as a stderr event.
   * Defaults to a no-op (the take loop wires this when it has a
   * push handle).
   */
  pushBannerToSession?: (banner: string) => void;
  /**
   * Override `Date.now()` for deterministic tests.
   */
  now?: () => Date;
}

function nowFrom(deps: ForensicDeps): Date {
  return deps.now?.() ?? new Date();
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<{ value?: T; error?: string }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      promise.then((value) => ({ value })),
      new Promise<{ error: string }>((resolve) => {
        timer = setTimeout(
          () => resolve({ error: `${label} timed out after ${ms}ms` }),
          ms,
        );
      }),
    ]);
    return result;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Filter the full lease list down to leases relevant to this beat.
 * A lease is "relevant" when its nickname mentions the session id
 * (foolery's nickname format is `foolery:<source>:<sessionId>`) or
 * when the lease id appears in any new step_history entry. Callers
 * that want every lease in the repo can skip this filter and pass
 * the unfiltered array — but keeping snapshots small is preferred.
 *
 * Defensive: when the heuristic doesn't match anything but the list
 * is short (<10), include all so we don't accidentally drop a lease
 * that matters for the classifier.
 */
function leasesForBeat(
  beatId: string,
  sessionId: string,
  all: KnotRecord[],
): KnotRecord[] {
  const matched = all.filter((lease) => {
    if (typeof lease.id !== "string") return false;
    const nickname = lease.lease?.nickname ?? "";
    return nickname.includes(beatId) || nickname.includes(sessionId);
  });
  if (matched.length === 0 && all.length <= 10) return all;
  return matched;
}

async function safeCall<T>(
  fn: ((...args: never[]) => Promise<T>) | undefined,
  invoke: (f: (...args: never[]) => Promise<T>) => Promise<T>,
  label: string,
): Promise<{ value?: T; error?: string }> {
  if (typeof fn !== "function") {
    return { error: `${label}: dependency not available (test stub or import miss)` };
  }
  try {
    return await withTimeout(invoke(fn), KNO_FETCH_TIMEOUT_MS, label);
  } catch (err) {
    return {
      error: `${label}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function fetchSnapshotData(
  ctx: CaptureContext,
  deps: ForensicDeps,
): Promise<{
  beat?: KnotRecord;
  leases?: KnotRecord[];
  errors: string[];
}> {
  const errors: string[] = [];
  const showKnot = deps.showKnot ?? defaultShowKnot;
  const listLeases = deps.listLeases ?? defaultListLeases;

  const beatRes = await safeCall(
    showKnot as never,
    (f) => (f as typeof defaultShowKnot)(ctx.beatId, ctx.repoPath) as never,
    "showKnot",
  );
  let beat: KnotRecord | undefined;
  if (beatRes.error) {
    errors.push(beatRes.error);
  } else if (beatRes.value) {
    const r = beatRes.value as Awaited<ReturnType<typeof defaultShowKnot>>;
    if (r.ok) beat = r.data;
    else errors.push(`showKnot: ${r.error ?? "failed"}`);
  }

  const leasesRes = await safeCall(
    listLeases as never,
    (f) => (f as typeof defaultListLeases)(ctx.repoPath, true) as never,
    "listLeases",
  );
  let leases: KnotRecord[] | undefined;
  if (leasesRes.error) {
    errors.push(leasesRes.error);
  } else if (leasesRes.value) {
    const r = leasesRes.value as Awaited<ReturnType<typeof defaultListLeases>>;
    if (r.ok && r.data) {
      leases = leasesForBeat(ctx.beatId, ctx.sessionId, r.data);
    } else if (!r.ok) {
      errors.push(`listLeases: ${r.error ?? "failed"}`);
    }
  }

  return { beat, leases, errors };
}

function defaultLogAudit(
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  return logLeaseAudit({
    event,
    outcome: "success",
    message: typeof payload.message === "string"
      ? payload.message
      : event,
    repoPath: typeof payload.repoPath === "string"
      ? payload.repoPath : undefined,
    sessionId: typeof payload.sessionId === "string"
      ? payload.sessionId : undefined,
    beatId: typeof payload.beatId === "string"
      ? payload.beatId : undefined,
    knotsLeaseId: typeof payload.knotsLeaseId === "string"
      ? payload.knotsLeaseId : undefined,
    data: payload,
  });
}

/**
 * Capture a snapshot at the given boundary. Returns the captured
 * snapshot (with the on-disk path in `snapshotPath` of the audit
 * payload). Never throws into the caller — capture errors are
 * recorded in `snapshot.captureErrors`. The entire body is wrapped
 * in a top-level try/catch because the take loop calls this with
 * `void` and an unhandled promise rejection would crash test runs
 * even when the take loop itself doesn't care.
 */
export async function captureBeatSnapshot(
  boundary: DispatchForensicBoundary,
  ctx: CaptureContext,
  deps: ForensicDeps = {},
): Promise<BeatSnapshot> {
  const capturedAt = nowFrom(deps).toISOString();
  const baseSnapshot: BeatSnapshot = {
    boundary,
    capturedAt,
    sessionId: ctx.sessionId,
    beatId: ctx.beatId,
    agentInfo: ctx.agentInfo,
    leaseId: ctx.leaseId,
    iteration: ctx.iteration,
    expectedStep: ctx.expectedStep,
    observedState: ctx.observedState,
    foolerypid: process.pid,
    childPid: ctx.childPid,
  };
  try {
    return await captureBeatSnapshotUnsafe(
      boundary, ctx, deps, baseSnapshot,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[dispatch-forensics] capture aborted for ` +
      `boundary=${boundary} beat=${ctx.beatId}: ${msg}`,
    );
    return { ...baseSnapshot, captureErrors: [msg] };
  }
}

async function captureBeatSnapshotUnsafe(
  boundary: DispatchForensicBoundary,
  ctx: CaptureContext,
  deps: ForensicDeps,
  baseSnapshot: BeatSnapshot,
): Promise<BeatSnapshot> {
  const writer = deps.writer ?? createFsSnapshotWriter();
  const logAudit = deps.logAudit ?? defaultLogAudit;

  const { beat, leases, errors } = await fetchSnapshotData(ctx, deps);

  const snapshot: BeatSnapshot = {
    ...baseSnapshot,
    observedState: ctx.observedState ?? beat?.state,
    beat,
    leases,
    captureErrors: errors.length > 0 ? errors : undefined,
  };

  let snapshotPath: string | undefined;
  try {
    snapshotPath = await writer.write(snapshot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[dispatch-forensics] write failed for boundary=${boundary} ` +
      `beat=${ctx.beatId}: ${msg}`,
    );
  }

  try {
    await logAudit(`beat_snapshot_${boundary}`, {
      message: `Captured beat snapshot at boundary ${boundary}.`,
      repoPath: ctx.repoPath,
      sessionId: ctx.sessionId,
      beatId: ctx.beatId,
      knotsLeaseId: ctx.leaseId,
      iteration: ctx.iteration,
      observedState: snapshot.observedState,
      expectedStep: ctx.expectedStep,
      snapshotPath,
      captureErrors: snapshot.captureErrors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[dispatch-forensics] audit log failed for boundary=${boundary} ` +
      `beat=${ctx.beatId}: ${msg}`,
    );
  }

  return snapshot;
}

export interface PostTurnForensicResult {
  classified: boolean;
  bannerBody?: string;
}

/**
 * Run the classifier on a pre/post snapshot pair and, if the diff
 * matches a category, emit the FOOLERY DISPATCH FORENSIC banner +
 * audit event + push the banner into the session UI.
 */
export async function runPostTurnForensics(
  pre: BeatSnapshot,
  post: BeatSnapshot,
  preSnapshotPath: string,
  postSnapshotPath: string,
  signals: ClassifierSignals,
  deps: ForensicDeps = {},
): Promise<PostTurnForensicResult> {
  const classification = classifyTurnFailure(pre, post, signals);
  if (!classification) return { classified: false };

  const body = buildForensicBannerBody({
    category: classification.category,
    beatId: post.beatId,
    sessionId: post.sessionId,
    leaseId: post.leaseId,
    iteration: post.iteration,
    preSnapshotPath,
    postSnapshotPath,
    reasoning: classification.reasoning,
  });

  const banner = emitForensicBanner(body);
  deps.pushBannerToSession?.(banner);

  const logAudit = deps.logAudit ?? defaultLogAudit;
  try {
    await logAudit("dispatch_forensic_classified", {
      message:
        `Dispatch forensic classified: ${classification.category}.`,
      sessionId: post.sessionId,
      beatId: post.beatId,
      knotsLeaseId: post.leaseId,
      category: classification.category,
      reasoning: classification.reasoning,
      conflictingLeaseId: classification.conflictingLease?.id,
      preSnapshotPath,
      postSnapshotPath,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[dispatch-forensics] forensic audit log failed: ${msg}`,
    );
  }

  return { classified: true, bannerBody: body };
}
