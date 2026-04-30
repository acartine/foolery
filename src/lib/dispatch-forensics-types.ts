/**
 * Type definitions for dispatch forensics (foolery-dd9c).
 *
 * Captures full beat + lease state at every dispatch boundary so that
 * post-mortem investigation of a stuck or failed turn can read snapshots
 * from disk and answer questions like "did another agent claim this
 * beat?", "did our agent run kno claim twice?", "was the lease still
 * active when our agent's claim landed?" — without inferring from
 * partial logs.
 *
 * See knot foolery-dd9c for the contract this module must meet.
 */

import type { ExecutionAgentInfo } from "@/lib/execution-port";
import type { KnotRecord } from "@/lib/knots";

/**
 * Boundary names. One snapshot is captured at each. The names form
 * the suffix of the `beat_snapshot_<boundary>` lease-audit event and
 * the segment of the on-disk filename.
 *
 * MUST match the boundary list in foolery-dd9c's acceptance section.
 */
export type DispatchForensicBoundary =
  | "pre_lease"
  | "post_lease"
  | "pre_prompt_build"
  | "pre_prompt_send"
  | "post_prompt_ack"
  | "periodic"
  | "pre_followup"
  | "post_turn_success"
  | "post_turn_failure"
  | "post_rollback";

/**
 * Snapshot bundle persisted to disk per boundary capture. The full
 * beat JSON and the full lease list are kept verbatim so a future
 * investigator does not need to re-derive them.
 */
export interface BeatSnapshot {
  boundary: DispatchForensicBoundary;
  /** Wall-clock ISO timestamp captured by the foolery host. */
  capturedAt: string;
  sessionId: string;
  beatId: string;
  /** Agent dispatched for this turn (when known). */
  agentInfo?: ExecutionAgentInfo;
  /** Active lease bound to this dispatch (when known). */
  leaseId?: string;
  /** Take-loop iteration number (when known). */
  iteration?: number;
  /** Beat state observed at capture (when known up front). */
  observedState?: string;
  /** Step expected to be acted on this turn (when known). */
  expectedStep?: string;
  /** Foolery host process id. */
  foolerypid: number;
  /** Spawned agent child PID, when one exists. */
  childPid?: number;
  /** Full kno show output (KnotRecord shape). */
  beat?: KnotRecord;
  /** Full lease list filtered to leases relevant to this beat. */
  leases?: KnotRecord[];
  /**
   * Errors encountered while capturing the snapshot itself (e.g.,
   * `kno show` timed out). Captured so the snapshot file is always
   * present even when its data is partial — an investigator should
   * see the gap, not a missing file.
   */
  captureErrors?: ReadonlyArray<string>;
}

/**
 * Categories the post-turn classifier may return. Each category names
 * a distinct hypothesis the operator can act on. `unknown_state_change`
 * is the default when the diff between pre and post snapshots shows
 * something changed but no other category applies — better to mark
 * the unknown loudly than to silently misclassify.
 */
export type ForensicCategory =
  | "concurrent_claim_detected"
  | "kno_half_transition_suspected"
  | "our_agent_double_claim_suspected"
  | "lease_terminated_unexpectedly"
  | "unknown_state_change";

export interface ForensicClassification {
  category: ForensicCategory;
  /** Human-readable reasoning included in the banner body. */
  reasoning: string;
  /**
   * For `concurrent_claim_detected`: the lease that won the race.
   * For other categories this may be undefined.
   */
  conflictingLease?: KnotRecord;
}

/**
 * Minimal context the capture function needs. Decoupled from
 * TakeLoopContext so unit tests can build it inline without dragging
 * in the full take-loop runtime.
 */
export interface CaptureContext {
  sessionId: string;
  beatId: string;
  repoPath?: string;
  iteration?: number;
  leaseId?: string;
  agentInfo?: ExecutionAgentInfo;
  expectedStep?: string;
  observedState?: string;
  childPid?: number;
}
