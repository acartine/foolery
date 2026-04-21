/**
 * Session preparation helpers for terminal-manager.
 * Extracted from terminal-manager.ts to stay under
 * the 500-line file limit.
 */
import { getBackend } from "@/lib/backend-instance";
import {
  assertClaimable,
  resolveMemoryManagerType,
} from "@/lib/memory-manager-commands";
import type { MemoryManagerType } from "@/lib/memory-managers";
import type {
  Beat,
  MemoryWorkflowDescriptor,
} from "@/lib/types";
import {
  ORCHESTRATION_WAVE_LABEL,
} from "@/lib/wave-slugs";
import {
  defaultWorkflowDescriptor,
  resolveStep,
  workflowDescriptorById,
} from "@/lib/workflows";
import {
  resolveWorkflowForBeat,
  toWorkflowPromptTarget,
  isTerminalBeatState,
  rollbackAgentOwnedActionStateToQueue,
} from "@/lib/terminal-manager-workflow";
import type {
  WorkflowPromptTarget,
} from "@/lib/terminal-manager-workflow";

// ─── PreparedTargets ─────────────────────────────────

export interface PreparedTargets {
  beat: Beat;
  waveBeats: Beat[];
  waveBeatIds: string[];
  effectiveParent: boolean;
  resolvedRepoPath: string;
  memoryManagerType: MemoryManagerType;
  workflowsById: Map<string, MemoryWorkflowDescriptor>;
  fallbackWorkflow: MemoryWorkflowDescriptor;
  primaryTarget: WorkflowPromptTarget;
  sceneTargets: WorkflowPromptTarget[];
  healedTargets: Array<{
    beat: Beat;
    rolledBack: boolean;
    fromState?: string;
    toState?: string;
  }>;
  resolved: ReturnType<typeof resolveStep>;
  repoPath: string | undefined;
}

// ─── prepareSessionTargets ───────────────────────────

export async function prepareSessionTargets(
  beatId: string,
  repoPath?: string,
): Promise<PreparedTargets> {
  const { beat, workflowsById, fallbackWorkflow } =
    await fetchBeatAndWorkflows(beatId, repoPath);
  const { waveBeats, waveBeatIds, effectiveParent } =
    await resolveChildren(beat, repoPath);
  const resolvedRepoPath = repoPath || process.cwd();
  const memoryManagerType =
    resolveMemoryManagerType(resolvedRepoPath);

  const targets = effectiveParent ? waveBeats : [beat];
  const healedTargets = await Promise.all(
    targets.map((t) =>
      rollbackAgentOwnedActionStateToQueue(
        t, repoPath, memoryManagerType,
        workflowsById, fallbackWorkflow, beatId,
      ),
    ),
  );

  const healed = applyHealedTargets(
    beat, waveBeats, waveBeatIds,
    effectiveParent, memoryManagerType, healedTargets,
  );

  const primaryTarget = toWorkflowPromptTarget(
    healed.beat, workflowsById, fallbackWorkflow,
  );
  const sceneTargets = healed.waveBeats.map((c) =>
    toWorkflowPromptTarget(
      c, workflowsById, fallbackWorkflow,
    ),
  );

  return {
    beat: healed.beat,
    waveBeats: healed.waveBeats,
    waveBeatIds: healed.waveBeatIds,
    effectiveParent,
    resolvedRepoPath,
    memoryManagerType,
    workflowsById,
    fallbackWorkflow,
    primaryTarget,
    sceneTargets,
    healedTargets,
    resolved: resolveStep(
      healed.beat.state,
      resolveWorkflowForBeat(
        healed.beat, workflowsById, fallbackWorkflow,
      ),
    ),
    repoPath,
  };
}

// ─── Sub-helpers ─────────────────────────────────────

async function fetchBeatAndWorkflows(
  beatId: string,
  repoPath?: string,
): Promise<{
  beat: Beat;
  workflowsById: Map<string, MemoryWorkflowDescriptor>;
  fallbackWorkflow: MemoryWorkflowDescriptor;
}> {
  const result = await getBackend().get(
    beatId, repoPath,
  );
  if (!result.ok || !result.data) {
    throw new Error(
      result.error?.message ?? "Failed to fetch beat",
    );
  }
  const wfResult =
    await getBackend().listWorkflows(repoPath);
  const workflows = wfResult.ok
    ? wfResult.data ?? [] : [];
  return {
    beat: result.data,
    workflowsById: workflowDescriptorById(workflows),
    fallbackWorkflow:
      workflows[0] ?? defaultWorkflowDescriptor(),
  };
}

async function resolveChildren(
  beat: Beat,
  repoPath?: string,
): Promise<{
  waveBeats: Beat[];
  waveBeatIds: string[];
  effectiveParent: boolean;
}> {
  const isWave =
    beat.labels?.includes(ORCHESTRATION_WAVE_LABEL) ??
    false;
  let waveBeats: Beat[] = [];
  let waveBeatIds: string[] = [];
  const childResult = await getBackend().list(
    { parent: beat.id }, repoPath,
  );
  const hasChildren =
    childResult.ok &&
    childResult.data &&
    childResult.data.length > 0;

  if (hasChildren) {
    waveBeats = childResult.data!
      .filter((c) => !isTerminalBeatState(c.state))
      .sort((a, b) => a.id.localeCompare(b.id));
    waveBeatIds = waveBeats.map((c) => c.id);
  } else if (isWave) {
    const errMsg =
      childResult.error?.message ??
      "no children found";
    console.warn(
      `[terminal-manager] Failed to load scene ` +
      `children for ${beat.id}: ${errMsg}`,
    );
  }

  const effectiveParent =
    isWave ||
    Boolean(hasChildren && waveBeatIds.length > 0);
  return { waveBeats, waveBeatIds, effectiveParent };
}

function applyHealedTargets(
  originalBeat: Beat,
  originalWaveBeats: Beat[],
  originalWaveBeatIds: string[],
  effectiveParent: boolean,
  memoryManagerType: MemoryManagerType,
  healedTargets: Array<{
    beat: Beat;
    rolledBack: boolean;
  }>,
): {
  beat: Beat;
  waveBeats: Beat[];
  waveBeatIds: string[];
} {
  if (effectiveParent) {
    const waveBeats = healedTargets
      .filter(
        (h) => !isTerminalBeatState(h.beat.state),
      )
      .map((h) => h.beat);
    const waveBeatIds = waveBeats.map((c) => c.id);
    if (memoryManagerType !== "knots") {
      assertClaimable(
        waveBeats, "Scene", memoryManagerType,
      );
    }
    return {
      beat: originalBeat, waveBeats, waveBeatIds,
    };
  }
  const beat = healedTargets[0]?.beat ?? originalBeat;
  assertClaimable([beat], "Take", memoryManagerType);
  return {
    beat,
    waveBeats: originalWaveBeats,
    waveBeatIds: originalWaveBeatIds,
  };
}
