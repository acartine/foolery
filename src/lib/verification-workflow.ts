/**
 * Auto-verification workflow — state machine, label contracts, and orchestration.
 *
 * This module defines the deterministic verification lifecycle that runs after
 * an agent invocation completes for code-producing actions (Take!, Scene!).
 *
 * ## State Machine
 *
 * ```
 *  agent-complete ──► transition:verification + stage:verification
 *                          │
 *                          ├── commit label missing?
 *                          │     └── remediate (prompt agent / relaunch)
 *                          │           └── still missing? → stage:retry + attempt:N
 *                          │
 *                          ├── commit label present → launch verifier
 *                          │     ├── pass → remove transition/stage labels, close bead
 *                          │     └── fail → stage:retry + attempt:N
 *                          │
 *                          └── idempotent re-entry: noop if already in transition
 * ```
 *
 * ## Label Invariants
 *
 * - `transition:verification` — transient lock; present only while the workflow
 *   is actively running. Prevents edits (UI + API). Removed on every terminal state.
 * - `stage:verification` — indicates the bead is queued/undergoing verification.
 *   Set at workflow entry, removed on pass or retry.
 * - `stage:retry` — set when verification fails; mutually exclusive with stage:verification.
 * - `attempt:N` — monotonically incrementing counter of verification attempts.
 * - `commit:<sha>` — short SHA of the implementing commit. Required before verifier launch.
 *
 * ## Idempotency
 *
 * - If `transition:verification` is already present, the workflow is a noop (deduped).
 * - The in-memory lock map prevents concurrent launches for the same bead.
 */

import type { Bead } from "@/lib/types";
import type { MemoryManagerType } from "@/lib/memory-managers";
import {
  buildVerificationPassCommands,
  buildVerificationRetryCommands,
} from "@/lib/memory-manager-commands";

// ── Label constants ─────────────────────────────────────────

export const LABEL_TRANSITION_VERIFICATION = "transition:verification";
export const LABEL_STAGE_VERIFICATION = "stage:verification";
export const LABEL_STAGE_RETRY = "stage:retry";

export const LABEL_PREFIX_COMMIT = "commit:";
export const LABEL_PREFIX_ATTEMPT = "attempt:";

// ── Label helpers (xmg8.1.4) ───────────────────────────────

/** Extract the commit SHA from labels, or null if not present. */
export function extractCommitLabel(labels: string[]): string | null {
  for (const label of labels) {
    if (label.startsWith(LABEL_PREFIX_COMMIT)) {
      const sha = label.slice(LABEL_PREFIX_COMMIT.length).trim();
      if (sha) return sha;
    }
  }
  return null;
}

/** Build a commit label from a short SHA. */
export function buildCommitLabel(sha: string): string {
  return `${LABEL_PREFIX_COMMIT}${sha}`;
}

/** Extract the current attempt number from labels, or 0 if not present. */
export function extractAttemptNumber(labels: string[]): number {
  for (const label of labels) {
    if (label.startsWith(LABEL_PREFIX_ATTEMPT)) {
      const num = parseInt(label.slice(LABEL_PREFIX_ATTEMPT.length), 10);
      if (!isNaN(num) && num >= 0) return num;
    }
  }
  return 0;
}

/** Build an attempt label for the given attempt number. */
export function buildAttemptLabel(attempt: number): string {
  return `${LABEL_PREFIX_ATTEMPT}${attempt}`;
}

/** Find the existing attempt label string in the labels array, or null. */
export function findAttemptLabel(labels: string[]): string | null {
  return labels.find((l) => l.startsWith(LABEL_PREFIX_ATTEMPT)) ?? null;
}

/** Find the existing commit label string in the labels array, or null. */
export function findCommitLabelRaw(labels: string[]): string | null {
  return labels.find((l) => l.startsWith(LABEL_PREFIX_COMMIT)) ?? null;
}

/** Check if a bead has the transition:verification lock. */
export function hasTransitionLock(bead: Bead): boolean {
  return (bead.labels ?? []).includes(LABEL_TRANSITION_VERIFICATION);
}

/** Check if a bead is in stage:verification. */
export function isInVerification(bead: Bead): boolean {
  return (bead.labels ?? []).includes(LABEL_STAGE_VERIFICATION);
}

/** Check if a bead is in stage:retry. */
export function isInRetry(bead: Bead): boolean {
  return (bead.labels ?? []).includes(LABEL_STAGE_RETRY);
}

// ── Eligible action classification (xmg8.1.2) ──────────────

import type { ActionName } from "@/lib/types";

/**
 * Actions that produce code changes and should trigger auto-verification
 * after the agent invocation completes.
 *
 * - "take" — single bead implementation
 * - "scene" — multi-bead scene implementation
 *
 * Excluded:
 * - "breakdown" — only creates child beads, no code changes
 * - "direct" — planning/orchestration only, no code changes
 */
const CODE_PRODUCING_ACTIONS: ReadonlySet<ActionName> = new Set([
  "take",
  "scene",
]);

/** Returns true if the action produces code and should trigger auto-verification. */
export function isVerificationEligibleAction(action: ActionName): boolean {
  return CODE_PRODUCING_ACTIONS.has(action);
}

/** Returns the list of all verification-eligible action names. */
export function getVerificationEligibleActions(): ActionName[] {
  return Array.from(CODE_PRODUCING_ACTIONS);
}

// ── Workflow state types ────────────────────────────────────

export type VerificationOutcome = "pass" | "fail-requirements" | "fail-bugs";

export interface VerificationTransitionLabels {
  add: string[];
  remove: string[];
}

/**
 * Compute the label mutations needed to enter the verification workflow.
 * Idempotent: if transition:verification is already present, returns empty mutations.
 */
export function computeEntryLabels(currentLabels: string[]): VerificationTransitionLabels {
  if (currentLabels.includes(LABEL_TRANSITION_VERIFICATION)) {
    return { add: [], remove: [] };
  }

  const add: string[] = [LABEL_TRANSITION_VERIFICATION];
  const remove: string[] = [];

  if (!currentLabels.includes(LABEL_STAGE_VERIFICATION)) {
    add.push(LABEL_STAGE_VERIFICATION);
  }

  // Remove stage:retry if present (re-entering verification from a retry)
  if (currentLabels.includes(LABEL_STAGE_RETRY)) {
    remove.push(LABEL_STAGE_RETRY);
  }

  return { add, remove };
}

/**
 * Compute the label mutations for a successful verification (pass).
 * Removes both transition and stage labels, closes the bead.
 */
export function computePassLabels(currentLabels: string[]): VerificationTransitionLabels {
  const remove: string[] = [];
  if (currentLabels.includes(LABEL_TRANSITION_VERIFICATION)) {
    remove.push(LABEL_TRANSITION_VERIFICATION);
  }
  if (currentLabels.includes(LABEL_STAGE_VERIFICATION)) {
    remove.push(LABEL_STAGE_VERIFICATION);
  }
  return { add: [], remove };
}

/**
 * Compute the label mutations for a failed verification (retry).
 * Removes transition + stage:verification + old commit label,
 * adds stage:retry + incremented attempt.
 */
export function computeRetryLabels(currentLabels: string[]): VerificationTransitionLabels {
  const remove: string[] = [];
  const add: string[] = [LABEL_STAGE_RETRY];

  if (currentLabels.includes(LABEL_TRANSITION_VERIFICATION)) {
    remove.push(LABEL_TRANSITION_VERIFICATION);
  }
  if (currentLabels.includes(LABEL_STAGE_VERIFICATION)) {
    remove.push(LABEL_STAGE_VERIFICATION);
  }

  // Remove stale commit label so the next implementation can set a fresh one
  const prevCommitLabel = findCommitLabelRaw(currentLabels);
  if (prevCommitLabel) {
    remove.push(prevCommitLabel);
  }

  // Increment attempt counter
  const prevAttemptLabel = findAttemptLabel(currentLabels);
  if (prevAttemptLabel) {
    remove.push(prevAttemptLabel);
  }
  const prevAttempt = extractAttemptNumber(currentLabels);
  add.push(buildAttemptLabel(prevAttempt + 1));

  return { add, remove };
}

// ── Verifier prompt builder ─────────────────────────────────

export interface VerifierPromptContext {
  beadId: string;
  title: string;
  description?: string;
  acceptance?: string;
  notes?: string;
  commitSha: string;
  memoryManagerType?: MemoryManagerType;
}

/**
 * Build the prompt for the verification agent.
 * This prompt instructs the agent to verify the commit against bead requirements.
 */
export function buildVerifierPrompt(ctx: VerifierPromptContext): string {
  const memoryManagerType = ctx.memoryManagerType ?? "beads";
  const retryCommands = buildVerificationRetryCommands(ctx.beadId, memoryManagerType, { noDaemon: true });
  const passCommands = buildVerificationPassCommands(ctx.beadId, memoryManagerType, { noDaemon: true });

  const lines: string[] = [
    `Bead ${ctx.beadId} has just been queued for verification. You are going to verify it with the following steps:`,
    ``,
    `## Reference`,
    `- Bead ID: ${ctx.beadId}`,
    `- Title: ${ctx.title}`,
    `- Commit: ${ctx.commitSha}`,
  ];

  if (ctx.description) {
    lines.push(``, `## Description`, ctx.description);
  }
  if (ctx.acceptance) {
    lines.push(``, `## Acceptance Criteria`, ctx.acceptance);
  }
  if (ctx.notes) {
    lines.push(``, `## Notes`, ctx.notes);
  }

  lines.push(
    ``,
    `## Verification Steps`,
    ``,
    `1. Use commit ${ctx.commitSha} as a basis for reference.`,
    `2. Check: Does the code on main satisfy the requirements of the bead?`,
    `   - If NO: run the following memory manager commands and stop:`,
    ...retryCommands.map((command) => `     ${command}`),
    `     Then output a brief rejection summary (2-4 sentences) explaining what is wrong and what needs to change, prefixed with REJECTION_SUMMARY:`,
    `     Example: REJECTION_SUMMARY: The login form component was not updated to handle the new OAuth flow. The redirect URL is still hardcoded. Update src/components/LoginForm.tsx to use the dynamic redirect from config.`,
    `     Then output: VERIFICATION_RESULT:fail-requirements`,
    `3. Check: Does the commit introduce bugs that require correction?`,
    `   - If YES: run the same memory manager commands as step 2 and stop.`,
    `     Then output a brief rejection summary explaining the bugs found, prefixed with REJECTION_SUMMARY:`,
    `     Then output: VERIFICATION_RESULT:fail-bugs`,
    `4. If both checks pass (code satisfies requirements, no bugs):`,
    ...passCommands.map((command) => `     ${command}`),
    `     Then output: VERIFICATION_RESULT:pass`,
    ``,
    `IMPORTANT: On failure, you MUST output a REJECTION_SUMMARY line followed by a VERIFICATION_RESULT line.`,
    `Use the format: REJECTION_SUMMARY: <2-4 sentence explanation of what failed and what to fix>`,
    `Then: VERIFICATION_RESULT:<pass|fail-requirements|fail-bugs>`,
    `On pass, output only: VERIFICATION_RESULT:pass`,
  );

  return lines.join("\n");
}

// ── Verifier result parser ──────────────────────────────────

const RESULT_RE = /VERIFICATION_RESULT:(pass|fail-requirements|fail-bugs)/;

/** Parse the verification result from agent output. */
export function parseVerifierResult(output: string): VerificationOutcome | null {
  const match = RESULT_RE.exec(output);
  if (!match) return null;
  return match[1] as VerificationOutcome;
}

// ── In-memory dedup lock (xmg8.2.5 preview) ────────────────

const activeLocks = new Map<string, { startedAt: number }>();
const LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** Attempt to acquire a verification lock for a bead. Returns true if acquired. */
export function acquireVerificationLock(beadId: string): boolean {
  const existing = activeLocks.get(beadId);
  if (existing) {
    // Allow re-acquisition if the lock is stale (timed out)
    if (Date.now() - existing.startedAt < LOCK_TIMEOUT_MS) {
      return false;
    }
  }
  activeLocks.set(beadId, { startedAt: Date.now() });
  return true;
}

/** Release the verification lock for a bead. */
export function releaseVerificationLock(beadId: string): void {
  activeLocks.delete(beadId);
}

/** Check if a bead currently has a verification lock. */
export function hasVerificationLock(beadId: string): boolean {
  const existing = activeLocks.get(beadId);
  if (!existing) return false;
  if (Date.now() - existing.startedAt >= LOCK_TIMEOUT_MS) {
    activeLocks.delete(beadId);
    return false;
  }
  return true;
}

/** Clear all locks (for testing). */
export function _clearAllLocks(): void {
  activeLocks.clear();
}

// ── Lifecycle event types (xmg8.2.6 preview) ───────────────

export type VerificationEventType =
  | "queued"
  | "missing-commit"
  | "remediation-started"
  | "remediation-failed"
  | "verifier-started"
  | "verifier-completed"
  | "retry"
  | "closed"
  | "notes-updated"
  | "retry-session-started";

export interface VerificationEvent {
  type: VerificationEventType;
  beadId: string;
  timestamp: string;
  detail?: string;
}
