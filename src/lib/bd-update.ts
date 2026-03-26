/**
 * bd update logic — extracted from bd.ts to stay within
 * file-length limits.
 */
import {
  exec,
  execWithNoDaemonFallback,
  NO_DAEMON_FLAG,
} from "./bd-internal";
import type { ExecResult } from "./bd-internal";
import type { Beat, BdResult } from "./types";
import { recordCompatStatusConsumed } from "./compat-status-usage";
import {
  builtinProfileDescriptor,
  deriveWorkflowRuntimeState,
  isWorkflowProfileLabel,
  isWorkflowStateLabel,
  mapStatusToDefaultWorkflowState,
  normalizeStateForWorkflow,
  withWorkflowProfileLabel,
  withWorkflowStateLabel,
} from "./workflows";
import { showBeat } from "./bd-queries";

// ── Helpers ─────────────────────────────────────────────────

function normalizeLabels(labels: string[]): string[] {
  const deduped = new Set<string>();
  for (const label of labels) {
    const trimmed = label.trim();
    if (!trimmed) continue;
    deduped.add(trimmed);
  }
  return Array.from(deduped);
}

function isStageLabel(label: string): boolean {
  return label.startsWith("stage:");
}

function isWorkflowRelatedLabel(label: string): boolean {
  return (
    isWorkflowStateLabel(label) ||
    isWorkflowProfileLabel(label)
  );
}

// ── Workflow state resolution ───────────────────────────────

interface ResolvedWorkflowFields {
  labels?: string[];
  status?: string;
}

function resolveWorkflowFields(
  nextFields: Record<
    string, string | string[] | number | undefined
  >,
  selectedProfileId: string | null,
  current: { data?: Beat } | null,
): ResolvedWorkflowFields {
  const workflow = builtinProfileDescriptor(
    selectedProfileId ?? current?.data?.profileId,
  );
  const explicitWorkflowState =
    typeof nextFields.workflowState === "string"
      ? normalizeStateForWorkflow(
        nextFields.workflowState, workflow,
      )
      : typeof nextFields.state === "string"
        ? normalizeStateForWorkflow(
          nextFields.state, workflow,
        )
        : undefined;
  delete nextFields.workflowState;
  delete nextFields.state;

  const explicitStatus =
    typeof nextFields.status === "string"
      ? (nextFields.status as string)
      : undefined;
  if (explicitStatus !== undefined) {
    recordCompatStatusConsumed("bd:update-input-status");
  }

  const workflowState =
    explicitWorkflowState ||
    (explicitStatus
      ? mapStatusToDefaultWorkflowState(
        explicitStatus, workflow,
      )
      : undefined) ||
    (selectedProfileId
      ? normalizeStateForWorkflow(
        current?.data?.state, workflow,
      )
      : undefined);

  if (!workflowState && !selectedProfileId) return {};

  const resolvedState =
    workflowState ?? workflow.initialState;
  const compatStatus =
    explicitStatus ??
    deriveWorkflowRuntimeState(
      workflow, resolvedState,
    ).compatStatus;

  const existingLabels = Array.isArray(nextFields.labels)
    ? nextFields.labels.filter(
      (label): label is string =>
        typeof label === "string",
    )
    : [];
  const currentLabels =
    (current?.data?.labels ?? []).filter(
      (label) =>
        !isStageLabel(label) &&
        !isWorkflowRelatedLabel(label),
    );
  const mergedLabels = normalizeLabels([
    ...currentLabels,
    ...existingLabels,
  ]);

  return {
    status: compatStatus,
    labels: withWorkflowProfileLabel(
      withWorkflowStateLabel(mergedLabels, resolvedState),
      workflow.id,
    ),
  };
}

// ── Label reconciliation ────────────────────────────────────

async function reconcileExclusiveLabels(
  id: string,
  repoPath: string | undefined,
  labelsToAdd: string[],
  labelsToRemove: string[],
): Promise<{
  normalizedRemove: string[];
  error?: BdResult<void>;
}> {
  const normalizedAdd = normalizeLabels(labelsToAdd);
  let normalizedRemove = normalizeLabels(labelsToRemove);

  const mutatesStage =
    normalizedAdd.some(isStageLabel) ||
    normalizedRemove.some(isStageLabel);
  const mutatesWorkflow =
    normalizedAdd.some(isWorkflowRelatedLabel) ||
    normalizedRemove.some(isWorkflowRelatedLabel);

  if (!mutatesStage && !mutatesWorkflow) {
    return { normalizedRemove };
  }

  const current = await showBeat(id, repoPath);
  if (!current.ok || !current.data) {
    return {
      normalizedRemove,
      error: {
        ok: false,
        error:
          current.error ||
          "Failed to load beat before label update",
      },
    };
  }

  if (mutatesStage && normalizedAdd.some(isStageLabel)) {
    const stageKeep = new Set(
      normalizedAdd.filter(isStageLabel),
    );
    const extraStage =
      (current.data.labels ?? []).filter(
        (l) => isStageLabel(l) && !stageKeep.has(l),
      );
    normalizedRemove = normalizeLabels([
      ...normalizedRemove,
      ...extraStage,
    ]);
  }

  if (
    mutatesWorkflow &&
    normalizedAdd.some(isWorkflowRelatedLabel)
  ) {
    const wfKeep = new Set(
      normalizedAdd.filter(isWorkflowRelatedLabel),
    );
    const extraWf =
      (current.data.labels ?? []).filter(
        (l) =>
          isWorkflowRelatedLabel(l) && !wfKeep.has(l),
      );
    normalizedRemove = normalizeLabels([
      ...normalizedRemove,
      ...extraWf,
    ]);
  }

  return { normalizedRemove };
}

// ── Label operations ────────────────────────────────────────

async function executeLabelOps(
  id: string,
  repoPath: string | undefined,
  labelsToRemove: string[],
  labelsToAdd: string[],
): Promise<BdResult<void>> {
  type LabelResult = {
    stdout: string;
    stderr: string;
    exitCode: number;
  };
  const ops: Promise<LabelResult>[] = [];
  const descs: string[] = [];

  for (const label of labelsToRemove) {
    ops.push(
      execWithNoDaemonFallback(
        ["label", "remove", id, label, NO_DAEMON_FLAG],
        { cwd: repoPath },
      ),
    );
    descs.push(`remove ${label}`);
  }
  for (const label of labelsToAdd) {
    ops.push(
      execWithNoDaemonFallback(
        ["label", "add", id, label, NO_DAEMON_FLAG],
        { cwd: repoPath },
      ),
    );
    descs.push(`add ${label}`);
  }

  if (ops.length > 0) {
    const results = await Promise.all(ops);
    for (let i = 0; i < results.length; i++) {
      if (results[i].exitCode !== 0) {
        return {
          ok: false,
          error:
            results[i].stderr ||
            `bd label ${descs[i]} failed`,
        };
      }
    }
  }

  // Flush to JSONL so the daemon's auto-import picks up
  // the direct DB writes. Only sync after removals.
  if (labelsToRemove.length > 0) {
    const { stderr, exitCode } =
      await execWithNoDaemonFallback(
        ["sync", NO_DAEMON_FLAG],
        { cwd: repoPath },
      );
    if (exitCode !== 0) {
      return {
        ok: false,
        error:
          stderr || "bd sync failed after label update",
      };
    }
  }

  return { ok: true };
}

// ── Public API ──────────────────────────────────────────────

export async function updateBeat(
  id: string,
  fields: Record<
    string, string | string[] | number | undefined
  >,
  repoPath?: string,
): Promise<BdResult<void>> {
  const nextFields = { ...fields };
  const selectedProfileId =
    typeof nextFields.profileId === "string"
      ? nextFields.profileId
      : typeof nextFields.workflowId === "string"
        ? nextFields.workflowId
        : null;
  delete nextFields.profileId;
  delete nextFields.workflowId;

  const needsCtx =
    Boolean(selectedProfileId) ||
    typeof nextFields.workflowState === "string" ||
    typeof nextFields.state === "string" ||
    typeof nextFields.status === "string";
  const current = needsCtx
    ? await showBeat(id, repoPath)
    : null;
  if (current && !current.ok) {
    return {
      ok: false,
      error:
        current.error ||
        "Failed to load beat before update",
    };
  }

  const wf = resolveWorkflowFields(
    nextFields, selectedProfileId, current,
  );
  if (wf.status) nextFields.status = wf.status;
  if (wf.labels) nextFields.labels = wf.labels;

  // Separate label operations from field updates
  const labelsToRemove: string[] = [];
  const labelsToAdd: string[] = [];
  const args = ["update", id];
  let hasUpdateFields = false;

  for (const [key, val] of Object.entries(nextFields)) {
    if (val === undefined) continue;
    if (key === "removeLabels" && Array.isArray(val)) {
      labelsToRemove.push(...val);
    } else if (key === "labels" && Array.isArray(val)) {
      labelsToAdd.push(...val);
    } else {
      args.push(`--${key}`, String(val));
      hasUpdateFields = true;
    }
  }

  // Reconcile exclusive labels
  const { normalizedRemove, error } =
    await reconcileExclusiveLabels(
      id,
      repoPath,
      labelsToAdd,
      labelsToRemove,
    );
  if (error) return error;

  // Run field update
  let updatePromise: Promise<ExecResult> | null = null;
  updatePromise = hasUpdateFields
    ? exec(args, { cwd: repoPath })
    : null;

  if (updatePromise) {
    const { stderr, exitCode } = await updatePromise;
    if (exitCode !== 0) {
      return {
        ok: false,
        error: stderr || "bd update failed",
      };
    }
  }

  // Run label add/remove operations
  return executeLabelOps(
    id,
    repoPath,
    normalizedRemove,
    normalizeLabels(labelsToAdd),
  );
}
