/**
 * bd write operations: create, delete, close, deps.
 *
 * Extracted from bd-queries.ts to keep each module within
 * the 500-line file-length limit.
 */
import { exec, parseJson } from "./bd-internal";
import type {
  BdResult,
  BeatDependency,
} from "./types";
import {
  builtinProfileDescriptor,
  normalizeStateForWorkflow,
  withWorkflowProfileLabel,
  withWorkflowStateLabel,
} from "./workflows";
import {
  mapStatusToDefaultWorkflowState,
  mapWorkflowStateToCompatStatus,
} from "./backends/beads-compat-status";

export async function createBeat(
  fields: Record<
    string, string | string[] | number | undefined
  >,
  repoPath?: string,
): Promise<BdResult<{ id: string }>> {
  const nextFields = { ...fields };
  const selectedProfileId =
    typeof nextFields.profileId === "string"
      ? nextFields.profileId
      : typeof nextFields.workflowId === "string"
        ? nextFields.workflowId
        : null;
  delete nextFields.profileId;
  delete nextFields.workflowId;
  const workflow = builtinProfileDescriptor(
    selectedProfileId,
  );

  const explicitWorkflowState =
    typeof nextFields.workflowState === "string"
      ? normalizeStateForWorkflow(
        nextFields.workflowState, workflow,
      )
      : undefined;
  delete nextFields.workflowState;

  const explicitStatus =
    typeof nextFields.status === "string"
      ? (nextFields.status as string)
      : undefined;
  const workflowState =
    explicitWorkflowState ||
    (explicitStatus
      ? mapStatusToDefaultWorkflowState(
        explicitStatus, workflow,
      )
      : workflow.initialState);
  const compatStatus =
    explicitStatus ??
    mapWorkflowStateToCompatStatus(workflowState);
  nextFields.status = compatStatus;

  const existingLabels = Array.isArray(nextFields.labels)
    ? nextFields.labels.filter(
      (label): label is string =>
        typeof label === "string",
    )
    : [];
  nextFields.labels = withWorkflowProfileLabel(
    withWorkflowStateLabel(
      existingLabels, workflowState,
    ),
    workflow.id,
  );

  const args = ["create", "--json"];
  for (const [key, val] of Object.entries(nextFields)) {
    if (val === undefined || val === "") continue;
    if (key === "labels" && Array.isArray(val)) {
      args.push("--labels", val.join(","));
    } else {
      args.push(`--${key}`, String(val));
    }
  }
  const { stdout, stderr, exitCode } = await exec(
    args, { cwd: repoPath },
  );
  if (exitCode !== 0) {
    return {
      ok: false,
      error: stderr || "bd create failed",
    };
  }
  try {
    return {
      ok: true,
      data: parseJson<{ id: string }>(stdout),
    };
  } catch {
    const id = stdout.trim();
    if (id) return { ok: true, data: { id } };
    return {
      ok: false,
      error: "Failed to parse bd create output",
    };
  }
}

export async function deleteBeat(
  id: string,
  repoPath?: string,
): Promise<BdResult<void>> {
  const { stderr, exitCode } = await exec(
    ["delete", id, "--force"], { cwd: repoPath },
  );
  if (exitCode !== 0) {
    return {
      ok: false,
      error: stderr || "bd delete failed",
    };
  }
  return { ok: true };
}

export async function closeBeat(
  id: string,
  reason?: string,
  repoPath?: string,
): Promise<BdResult<void>> {
  const args = ["close", id];
  if (reason) args.push("--reason", reason);
  const { stderr, exitCode } = await exec(
    args, { cwd: repoPath },
  );
  if (exitCode !== 0) {
    return {
      ok: false,
      error: stderr || "bd close failed",
    };
  }
  return { ok: true };
}

export async function listDeps(
  id: string,
  repoPath?: string,
  options?: { type?: string },
): Promise<BdResult<BeatDependency[]>> {
  const args = ["dep", "list", id, "--json"];
  if (options?.type) args.push("--type", options.type);
  const { stdout, stderr, exitCode } = await exec(
    args, { cwd: repoPath },
  );
  if (exitCode !== 0) {
    return {
      ok: false,
      error: stderr || "bd dep list failed",
    };
  }
  try {
    return {
      ok: true,
      data: parseJson<BeatDependency[]>(stdout),
    };
  } catch {
    return {
      ok: false,
      error: "Failed to parse bd dep list output",
    };
  }
}

export async function addDep(
  blockerId: string,
  blockedId: string,
  repoPath?: string,
): Promise<BdResult<void>> {
  const { stderr, exitCode } = await exec(
    ["dep", blockerId, "--blocks", blockedId],
    { cwd: repoPath },
  );
  if (exitCode !== 0) {
    return {
      ok: false,
      error: stderr || "bd dep add failed",
    };
  }
  return { ok: true };
}

export async function removeDep(
  blockerId: string,
  blockedId: string,
  repoPath?: string,
): Promise<BdResult<void>> {
  const { stderr, exitCode } = await exec(
    ["dep", "remove", blockedId, blockerId],
    { cwd: repoPath },
  );
  if (exitCode !== 0) {
    return {
      ok: false,
      error: stderr || "bd dep remove failed",
    };
  }
  return { ok: true };
}
