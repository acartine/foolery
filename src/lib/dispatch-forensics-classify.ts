/**
 * Post-turn classifier and red-banner emitter for dispatch forensics
 * (foolery-dd9c).
 *
 * Compares a `pre_lease` snapshot to a `post_turn_*` snapshot and
 * categorizes the change. The categories enumerate the distinct
 * hypotheses an operator can act on. When the diff doesn't fit any
 * named hypothesis, the classifier returns `unknown_state_change` —
 * an explicit unknown is preferred over a confident misclassification.
 *
 * The banner uses the marker phrase `FOOLERY DISPATCH FORENSIC` so it
 * is greppable and distinct from `FOOLERY DISPATCH FAILURE`.
 */

import type { KnotRecord } from "@/lib/knots";
import type {
  BeatSnapshot,
  ForensicCategory,
  ForensicClassification,
} from "@/lib/dispatch-forensics-types";
import { buildAnsiRedBanner } from "@/lib/ansi-red-banner";

export const DISPATCH_FORENSIC_MARKER = "FOOLERY DISPATCH FORENSIC";

/**
 * Optional caller-supplied signals that the classifier cannot infer
 * from snapshots alone. These come from the take loop (e.g., did
 * Foolery itself call `terminateLease`? did the agent's tool exit
 * non-zero?).
 */
export interface ClassifierSignals {
  /** Set true when the agent's last tool call to kno claim exited non-zero. */
  agentClaimExitedNonZero?: boolean;
  /** Set true when foolery itself initiated lease termination. */
  foolerInitiatedLeaseTerminate?: boolean;
}

interface StepEntry {
  id?: string;
  step?: string;
  lease_id?: string;
  agent_name?: string;
  agent_model?: string;
  agent_version?: string;
  started_at?: string;
  ended_at?: string;
  from_state?: string;
  to_state?: string;
}

function stepHistoryOf(beat?: KnotRecord): StepEntry[] {
  if (!beat) return [];
  const raw =
    (beat.step_history as StepEntry[] | undefined)
    ?? (beat.stepHistory as StepEntry[] | undefined)
    ?? [];
  return raw;
}

function leaseStateOf(lease?: KnotRecord): string | undefined {
  if (!lease) return undefined;
  return typeof lease.state === "string" ? lease.state : undefined;
}

function findLeaseById(
  leases: KnotRecord[] | undefined,
  id: string | undefined,
): KnotRecord | undefined {
  if (!leases || !id) return undefined;
  return leases.find((l) => l.id === id);
}

function newStepEntries(
  pre: BeatSnapshot,
  post: BeatSnapshot,
): StepEntry[] {
  const preIds = new Set(
    stepHistoryOf(pre.beat).map((s) => s.id).filter(Boolean) as string[],
  );
  return stepHistoryOf(post.beat).filter(
    (s) => s.id && !preIds.has(s.id),
  );
}

function classifyConcurrentClaim(
  newSteps: StepEntry[],
  ourLeaseId: string | undefined,
  postLeases: KnotRecord[] | undefined,
): ForensicClassification | null {
  const otherLeaseStep = newSteps.find(
    (s) => s.lease_id && s.lease_id !== ourLeaseId,
  );
  if (!otherLeaseStep) return null;
  const conflictingLease = findLeaseById(postLeases, otherLeaseStep.lease_id);
  return {
    category: "concurrent_claim_detected",
    reasoning:
      `step_history gained an action step bound to lease ` +
      `${otherLeaseStep.lease_id} (agent=${otherLeaseStep.agent_name ?? "?"}` +
      `/${otherLeaseStep.agent_model ?? "?"}` +
      `/${otherLeaseStep.agent_version ?? "?"}); ` +
      `our lease was ${ourLeaseId ?? "?"}. ` +
      `Another agent claimed this beat between our pre_lease and post_turn snapshots.`,
    conflictingLease,
  };
}

function classifyDoubleClaim(
  newSteps: StepEntry[],
  ourLeaseId: string | undefined,
): ForensicClassification | null {
  const ourSteps = newSteps.filter(
    (s) => s.lease_id && s.lease_id === ourLeaseId,
  );
  if (ourSteps.length < 2) return null;
  return {
    category: "our_agent_double_claim_suspected",
    reasoning:
      `step_history gained ${ourSteps.length} new action steps all bound ` +
      `to our lease ${ourLeaseId}. The dispatched agent appears to have ` +
      `invoked \`kno claim\` more than once in the same turn.`,
  };
}

function classifyHalfTransition(
  newSteps: StepEntry[],
  ourLeaseId: string | undefined,
  signals?: ClassifierSignals,
): ForensicClassification | null {
  if (!signals?.agentClaimExitedNonZero) return null;
  const ourSteps = newSteps.filter(
    (s) => s.lease_id && s.lease_id === ourLeaseId,
  );
  if (ourSteps.length === 0) return null;
  return {
    category: "kno_half_transition_suspected",
    reasoning:
      `agent's \`kno claim\` exited non-zero, but step_history contains ` +
      `${ourSteps.length} new action step(s) bound to our lease ` +
      `${ourLeaseId}. \`kno claim\` appears to have transitioned the beat ` +
      `state and then errored without rolling back.`,
  };
}

function classifyLeaseTerminated(
  pre: BeatSnapshot,
  post: BeatSnapshot,
  ourLeaseId: string | undefined,
  signals?: ClassifierSignals,
): ForensicClassification | null {
  if (signals?.foolerInitiatedLeaseTerminate) return null;
  const preLease = findLeaseById(pre.leases, ourLeaseId);
  const postLease = findLeaseById(post.leases, ourLeaseId);
  const preState = leaseStateOf(preLease);
  const postState = leaseStateOf(postLease);
  if (preState !== "lease_ready") return null;
  if (postState !== "lease_terminated") return null;
  return {
    category: "lease_terminated_unexpectedly",
    reasoning:
      `our lease ${ourLeaseId} moved from lease_ready to lease_terminated ` +
      `between pre_lease and post_turn snapshots, but foolery did not ` +
      `initiate the termination. Likely cause: the dispatched agent ran ` +
      `\`kno rollback\` (which kno terminates the action step's lease as ` +
      `a side effect).`,
  };
}

/**
 * Run the classifier rules in priority order. Returns null when the
 * snapshots show no diff worth flagging.
 */
export function classifyTurnFailure(
  pre: BeatSnapshot,
  post: BeatSnapshot,
  signals?: ClassifierSignals,
): ForensicClassification | null {
  const ourLeaseId = post.leaseId ?? pre.leaseId;
  const newSteps = newStepEntries(pre, post);

  const concurrent = classifyConcurrentClaim(
    newSteps, ourLeaseId, post.leases,
  );
  if (concurrent) return concurrent;

  const doubleClaim = classifyDoubleClaim(newSteps, ourLeaseId);
  if (doubleClaim) return doubleClaim;

  const halfTransition = classifyHalfTransition(
    newSteps, ourLeaseId, signals,
  );
  if (halfTransition) return halfTransition;

  const leaseTerminated = classifyLeaseTerminated(
    pre, post, ourLeaseId, signals,
  );
  if (leaseTerminated) return leaseTerminated;

  if (newSteps.length > 0 || pre.beat?.state !== post.beat?.state) {
    return {
      category: "unknown_state_change",
      reasoning:
        `state changed between snapshots (pre.state=${pre.beat?.state} ` +
        `→ post.state=${post.beat?.state}, new step_history entries: ` +
        `${newSteps.length}) but no named category fits. ` +
        `Read the snapshot files to investigate.`,
    };
  }

  return null;
}

/**
 * Build the FOOLERY DISPATCH FORENSIC banner body. Splits banner
 * construction from emission so callers can also push the banner
 * into a session UI buffer as a stderr event.
 */
export function buildForensicBannerBody(input: {
  category: ForensicCategory;
  beatId: string;
  sessionId: string;
  leaseId?: string;
  iteration?: number;
  preSnapshotPath: string;
  postSnapshotPath: string;
  reasoning: string;
}): string {
  const heading =
    `${DISPATCH_FORENSIC_MARKER}: ${input.category} on beat ${input.beatId}`;
  const body = [
    `  session      = ${input.sessionId}`,
    `  beat         = ${input.beatId}`,
    `  iteration    = ${input.iteration ?? "?"}`,
    `  lease        = ${input.leaseId ?? "?"}`,
    `  preSnapshot  = ${input.preSnapshotPath}`,
    `  postSnapshot = ${input.postSnapshotPath}`,
    "",
    "  reasoning:",
    ...input.reasoning.split("\n").map((l) => `    ${l}`),
  ].join("\n");
  return [heading, body].join("\n");
}

/**
 * Emit the banner to console.error AND return the wrapped banner
 * string so the caller can also push it to the session UI as a
 * stderr event (per CLAUDE.md "Fail Loudly, Never Silently").
 */
export function emitForensicBanner(
  body: string,
): string {
  const banner = buildAnsiRedBanner(body);
  console.error(`\n${banner}\n`);
  return `\n${banner}\n`;
}
