/**
 * Verification orchestrator — drives the post-invocation verification workflow.
 *
 * Responsibilities:
 * - Hook into agent completion events (xmg8.2.1)
 * - Remediate missing commit labels (xmg8.2.2)
 * - Launch verifier agent (xmg8.2.3)
 * - Apply verification outcomes (xmg8.2.4)
 * - Idempotency / dedup (xmg8.2.5)
 * - Lifecycle event logging (xmg8.2.6)
 */

import { spawn } from "node:child_process";
import { getBackend } from "@/lib/backend-instance";
import type { UpdateBeadInput } from "@/lib/backend-port";
import { getVerificationSettings, getVerificationAgent } from "@/lib/settings";
import { startInteractionLog, noopInteractionLog } from "@/lib/interaction-logger";
import {
  buildPromptModeArgs,
  resolveDialect,
  createLineNormalizer,
} from "@/lib/agent-adapter";
import {
  LABEL_TRANSITION_VERIFICATION,
  extractCommitLabel,
  extractAttemptNumber,
  computeEntryLabels,
  computePassLabels,
  computeRetryLabels,
  buildVerifierPrompt,
  parseVerifierResult,
  acquireVerificationLock,
  releaseVerificationLock,
  isVerificationEligibleAction,
  type VerificationOutcome,
  type VerificationEvent,
  type VerificationEventType,
} from "@/lib/verification-workflow";
import type { ActionName } from "@/lib/types";

// ── Configuration ───────────────────────────────────────────

const MAX_COMMIT_REMEDIATION_ATTEMPTS = 1;
const MAX_VERIFIER_OUTPUT_CHARS = 2000;

// ── Lifecycle event log (xmg8.2.6) ─────────────────────────

const eventLog: VerificationEvent[] = [];
const MAX_EVENT_LOG = 500;

function logEvent(type: VerificationEventType, beadId: string, detail?: string): void {
  const event: VerificationEvent = {
    type,
    beadId,
    timestamp: new Date().toISOString(),
    detail,
  };
  if (eventLog.length >= MAX_EVENT_LOG) eventLog.shift();
  eventLog.push(event);
  console.log(`[verification] ${type} bead=${beadId}${detail ? ` ${detail}` : ""}`);
}

/** Get recent verification events (for diagnostics). */
export function getVerificationEvents(limit = 50): VerificationEvent[] {
  return eventLog.slice(-limit);
}

// ── Entry point: hook agent completion (xmg8.2.1) ──────────

/**
 * Called after an agent invocation completes for an eligible action.
 * Determines whether to enqueue verification and drives the workflow.
 *
 * @param beadIds - The bead IDs that were part of the invocation
 * @param action - The action name (take, scene, etc.)
 * @param repoPath - Repository path for bd commands
 * @param exitCode - Agent process exit code (0 = success)
 */
export async function onAgentComplete(
  beadIds: string[],
  action: ActionName,
  repoPath: string,
  exitCode: number,
): Promise<void> {
  // Only trigger for successful, code-producing actions
  if (exitCode !== 0) return;
  if (!isVerificationEligibleAction(action)) return;

  // Check if auto-verification is enabled
  const settings = await getVerificationSettings();
  if (!settings.enabled) return;

  // Process each bead in parallel
  await Promise.allSettled(
    beadIds.map((beadId) => runVerificationWorkflow(beadId, action, repoPath)),
  );
}

// ── Core workflow ────────────────────────────────────────────

async function runVerificationWorkflow(
  beadId: string,
  action: ActionName,
  repoPath: string,
): Promise<void> {
  // Idempotency: acquire lock (xmg8.2.5)
  if (!acquireVerificationLock(beadId)) {
    console.log(`[verification] Deduped: ${beadId} already has active verification`);
    return;
  }

  try {
    // Step 1: Set transition labels (xmg8.2.1)
    await enterVerification(beadId, repoPath);

    // Step 2: Ensure commit label exists (xmg8.2.2)
    const commitSha = await ensureCommitLabel(beadId, repoPath);
    if (!commitSha) {
      // Remediation failed — transition to retry
      logEvent("remediation-failed", beadId);
      await transitionToRetry(beadId, repoPath);
      return;
    }

    // Step 3: Launch verifier agent (xmg8.2.3)
    const { outcome, output } = await launchVerifier(beadId, repoPath, commitSha);

    // Step 4: Apply outcome (xmg8.2.4)
    await applyOutcome(beadId, action, repoPath, outcome, output);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logEvent("remediation-failed", beadId, msg);
    // On unexpected error, transition to retry rather than leaving in limbo
    try {
      await transitionToRetry(beadId, repoPath);
    } catch {
      // Last resort: at least release the lock
    }
  } finally {
    releaseVerificationLock(beadId);
  }
}

// ── Step 1: Enter verification (xmg8.2.1) ──────────────────

async function enterVerification(beadId: string, repoPath: string): Promise<void> {
  logEvent("queued", beadId);

  const beadResult = await getBackend().get(beadId, repoPath);
  if (!beadResult.ok || !beadResult.data) {
    throw new Error(`Failed to load bead ${beadId}: ${beadResult.error?.message}`);
  }

  const bead = beadResult.data;
  const labels = bead.labels ?? [];

  // Already in transition — idempotent noop
  if (labels.includes(LABEL_TRANSITION_VERIFICATION)) {
    return;
  }

  const mutations = computeEntryLabels(labels);
  if (mutations.add.length > 0 || mutations.remove.length > 0) {
    const updateFields: UpdateBeadInput = {};
    if (mutations.add.length > 0) updateFields.labels = mutations.add;
    if (mutations.remove.length > 0) updateFields.removeLabels = mutations.remove;
    // Ensure status is in_progress for verification
    if (bead.status !== "in_progress") {
      updateFields.status = "in_progress";
    }
    await getBackend().update(beadId, updateFields, repoPath);
  }
}

// ── Step 2: Ensure commit label (xmg8.2.2) ─────────────────

async function ensureCommitLabel(
  beadId: string,
  repoPath: string,
): Promise<string | null> {
  // Check if commit label already exists
  const beadResult = await getBackend().get(beadId, repoPath);
  if (!beadResult.ok || !beadResult.data) return null;

  let sha = extractCommitLabel(beadResult.data.labels ?? []);
  if (sha) return sha;

  logEvent("missing-commit", beadId);

  // Attempt remediation: re-check after a brief delay
  // (the producing agent may still be labeling beads)
  for (let attempt = 0; attempt < MAX_COMMIT_REMEDIATION_ATTEMPTS; attempt++) {
    await sleep(3000);
    const refreshed = await getBackend().get(beadId, repoPath);
    if (!refreshed.ok || !refreshed.data) continue;
    sha = extractCommitLabel(refreshed.data.labels ?? []);
    if (sha) return sha;
  }

  // Still no commit label — cannot verify
  return null;
}

// ── Step 3: Launch verifier (xmg8.2.3) ─────────────────────

async function launchVerifier(
  beadId: string,
  repoPath: string,
  commitSha: string,
): Promise<{ outcome: VerificationOutcome; output: string }> {
  logEvent("verifier-started", beadId, `commit=${commitSha}`);

  const beadResult = await getBackend().get(beadId, repoPath);
  if (!beadResult.ok || !beadResult.data) {
    throw new Error(`Failed to load bead ${beadId} for verifier prompt: ${beadResult.error?.message}`);
  }
  const bead = beadResult.data;

  const prompt = buildVerifierPrompt({
    beadId,
    title: bead.title,
    description: bead.description,
    acceptance: bead.acceptance,
    notes: bead.notes,
    commitSha,
  });

  const agent = await getVerificationAgent();
  const { command, args } = buildPromptModeArgs(agent, prompt);
  const dialect = resolveDialect(agent.command);
  const normalizer = createLineNormalizer(dialect);
  const interactionLog = await startInteractionLog({
    sessionId: generateVerifierSessionId(),
    interactionType: "verification",
    repoPath,
    beadIds: [beadId],
    agentName: agent.label || agent.command,
    agentModel: agent.model,
  }).catch((err) => {
    console.error(`[verification] Failed to start interaction log for ${beadId}:`, err);
    return noopInteractionLog();
  });
  interactionLog.logPrompt(prompt, { source: "verification_review" });

  return new Promise<{ outcome: VerificationOutcome; output: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoPath,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let lineBuffer = "";
    let ended = false;
    const logEnd = (exitCode: number | null, status: string) => {
      if (ended) return;
      ended = true;
      interactionLog.logEnd(exitCode, status);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        interactionLog.logResponse(line);
        try {
          const raw = JSON.parse(line) as Record<string, unknown>;
          const normalized = normalizer(raw);
          if (!normalized) continue;

          // Extract text content from assistant messages
          if (normalized.type === "assistant") {
            const msg = normalized.message as Record<string, unknown> | undefined;
            const content = msg?.content as Array<Record<string, unknown>> | undefined;
            if (content) {
              for (const block of content) {
                if (block.type === "text" && typeof block.text === "string") {
                  output += block.text;
                }
              }
            }
          }
          if (normalized.type === "result" && typeof normalized.result === "string") {
            output += normalized.result;
          }
        } catch {
          output += line;
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      console.log(`[verification] [${beadId}] stderr: ${chunk.toString().slice(0, 200)}`);
    });

    child.on("close", (code) => {
      // Flush remaining buffer
      if (lineBuffer.trim()) {
        interactionLog.logResponse(lineBuffer);
        try {
          const raw = JSON.parse(lineBuffer) as Record<string, unknown>;
          const normalized = normalizer(raw);
          if (normalized?.type === "result" && typeof normalized.result === "string") {
            output += normalized.result;
          }
        } catch {
          output += lineBuffer;
        }
      }

      const result = parseVerifierResult(output);
      if (result) {
        logEnd(code ?? 0, "completed");
        logEvent("verifier-completed", beadId, `outcome=${result}`);
        resolve({ outcome: result, output });
      } else if (code === 0) {
        // Agent completed successfully but no explicit result marker
        // Default to pass if exit code is 0
        logEnd(0, "completed");
        logEvent("verifier-completed", beadId, "outcome=pass (implicit)");
        resolve({ outcome: "pass", output });
      } else {
        logEnd(code ?? 1, "error");
        reject(new Error(`Verifier exited with code ${code}, no result marker found`));
      }
    });

    child.on("error", (err) => {
      logEnd(1, "error");
      reject(new Error(`Verifier spawn error: ${err.message}`));
    });
  });
}

// ── Step 4: Apply outcome (xmg8.2.4) ───────────────────────

async function applyOutcome(
  beadId: string,
  action: ActionName,
  repoPath: string,
  outcome: VerificationOutcome,
  verifierOutput: string,
): Promise<void> {
  const beadResult = await getBackend().get(beadId, repoPath);
  if (!beadResult.ok || !beadResult.data) {
    throw new Error(`Failed to load bead ${beadId} for outcome application: ${beadResult.error?.message}`);
  }

  const bead = beadResult.data;
  const labels = bead.labels ?? [];

  if (outcome === "pass") {
    // Pass: remove verification labels and close
    const mutations = computePassLabels(labels);
    if (mutations.remove.length > 0) {
      await getBackend().update(beadId, { removeLabels: mutations.remove }, repoPath);
    }
    await getBackend().close(beadId, "Auto-verification passed", repoPath);
    logEvent("closed", beadId);
  } else {
    // Fail: capture verifier feedback in bead notes
    logEvent("retry", beadId, `reason=${outcome}`);
    const attemptNum = extractAttemptNumber(labels) + 1;
    await appendVerifierNotes(beadId, repoPath, bead.notes, outcome, verifierOutput, attemptNum);
    await transitionToRetry(beadId, repoPath);

    // Auto-launch a new implementation session if within retry limit
    await maybeAutoRetry(beadId, action, repoPath, attemptNum);
  }
}

// ── Helper: append verifier feedback to bead notes ──────────

async function appendVerifierNotes(
  beadId: string,
  repoPath: string,
  existingNotes: string | undefined,
  outcome: VerificationOutcome,
  verifierOutput: string,
  attemptNum: number,
): Promise<void> {
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const trimmedOutput = verifierOutput.length > MAX_VERIFIER_OUTPUT_CHARS
    ? verifierOutput.slice(0, MAX_VERIFIER_OUTPUT_CHARS) + "\n...(truncated)"
    : verifierOutput;

  const section = [
    "",
    "---",
    `**Verification attempt ${attemptNum} failed (${timestamp})** — reason: ${outcome}`,
    "",
    trimmedOutput,
  ].join("\n");

  const updatedNotes = (existingNotes ?? "") + section;
  await getBackend().update(beadId, { notes: updatedNotes }, repoPath);
  logEvent("notes-updated", beadId, `attempt=${attemptNum}`);
}

// ── Helper: auto-retry implementation session ───────────────

async function maybeAutoRetry(
  beadId: string,
  action: ActionName,
  repoPath: string,
  attemptNum: number,
): Promise<void> {
  const settings = await getVerificationSettings();
  if (settings.maxRetries <= 0 || attemptNum > settings.maxRetries) {
    console.log(
      `[verification] Skipping auto-retry for ${beadId}: attempt ${attemptNum} exceeds maxRetries ${settings.maxRetries}`,
    );
    return;
  }

  try {
    // Dynamic import to avoid circular dependency (terminal-manager imports us)
    const { createSession, createSceneSession } = await import(
      "@/lib/terminal-manager"
    );

    if (action === "scene") {
      await createSceneSession([beadId], repoPath);
    } else {
      await createSession(beadId, repoPath);
    }
    logEvent("retry-session-started", beadId, `attempt=${attemptNum} action=${action}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[verification] Failed to auto-retry ${beadId}: ${msg}`);
  }
}

// ── Helper: transition to retry ─────────────────────────────

async function transitionToRetry(beadId: string, repoPath: string): Promise<void> {
  const beadResult = await getBackend().get(beadId, repoPath);
  if (!beadResult.ok || !beadResult.data) return;

  const labels = beadResult.data.labels ?? [];
  const mutations = computeRetryLabels(labels);

  const updateFields: UpdateBeadInput = {
    status: "open",
  };
  if (mutations.add.length > 0) updateFields.labels = mutations.add;
  if (mutations.remove.length > 0) updateFields.removeLabels = mutations.remove;

  await getBackend().update(beadId, updateFields, repoPath);
}

// ── Utilities ───────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateVerifierSessionId(): string {
  return `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
