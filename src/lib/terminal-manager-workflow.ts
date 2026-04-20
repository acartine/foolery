import { getBackend } from "@/lib/backend-instance";
import type { MemoryManagerType } from "@/lib/memory-managers";
import {
  buildWorkflowStateCommand,
  rollbackBeatState,
} from "@/lib/memory-manager-commands";
import type { Beat, MemoryWorkflowDescriptor } from "@/lib/types";
import {
  defaultWorkflowDescriptor,
  StepPhase,
  workflowOwnerKindForState,
  workflowQueueStateForState,
  workflowStatePhase,
} from "@/lib/workflows";
import {
  buildShipFollowUpBoundaryLines,
} from "@/lib/agent-prompt-guardrails";

export interface WorkflowPromptTarget {
  id: string;
  workflow: MemoryWorkflowDescriptor;
  workflowState?: string;
}

function normalizeWorkflowState(
  value: string | undefined,
): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function buildGranularProgressionCommands(
  target: WorkflowPromptTarget,
  memoryManagerType: MemoryManagerType,
): string[] {
  const nonTerminalStates = target.workflow.states.filter(
    (state) =>
      !target.workflow.terminalStates.includes(state),
  );
  if (nonTerminalStates.length === 0) return [];

  const current = normalizeWorkflowState(target.workflowState);
  const currentIndex = current
    ? nonTerminalStates.indexOf(current)
    : -1;
  const progression =
    currentIndex >= 0 &&
    currentIndex + 1 < nonTerminalStates.length
      ? nonTerminalStates.slice(currentIndex + 1)
      : nonTerminalStates;

  const commands = progression.map((state) =>
    buildWorkflowStateCommand(
      target.id,
      state,
      memoryManagerType,
    ),
  );
  return [...new Set(commands)];
}

function buildSingleTargetFollowUpLines(
  target: WorkflowPromptTarget,
  memoryManagerType: MemoryManagerType,
): string[] {
  const lines: string[] = [
    `Beat ${target.id} (${target.workflow.mode}):`,
  ];

  if (target.workflow.mode === "granular_autonomous") {
    const commands = buildGranularProgressionCommands(
      target,
      memoryManagerType,
    );
    lines.push(
      "Progress through workflow states in order " +
      "after merge/push:",
    );
    if (commands.length > 0) {
      lines.push(
        ...commands.map((command) => `- ${command}`),
      );
    } else {
      lines.push(
        "- No non-terminal progression states configured.",
      );
    }
    return lines;
  }

  lines.push(
    "Human review is required: either review manually " +
    "or delegate review to an agent.",
  );
  if (target.workflow.finalCutState) {
    lines.push(
      "After merge/PR handling, move beat to the " +
      "next human-action queue:",
    );
    lines.push(
      `- ${buildWorkflowStateCommand(
        target.id,
        target.workflow.finalCutState,
        memoryManagerType,
      )}`,
    );
  } else {
    lines.push(
      "This workflow does not define a " +
      "human-action queue state.",
    );
  }
  return lines;
}

export function buildSingleBeatCompletionFollowUp(
  target: WorkflowPromptTarget,
  memoryManagerType: MemoryManagerType,
): string {
  return [
    "Ship completion follow-up:",
    `Confirm that changes for ${target.id} are merged ` +
    `and pushed according to your normal shipping ` +
    `guidelines.`,
    "Do not ask for another follow-up prompt until " +
    "merge/push confirmation is done " +
    "(or blocked by a hard error).",
    ...buildShipFollowUpBoundaryLines("single"),
    ...buildSingleTargetFollowUpLines(
      target,
      memoryManagerType,
    ),
    "Then summarize merge/push confirmation and " +
    "workflow command results.",
  ].join("\n");
}

export function buildWaveCompletionFollowUp(
  waveId: string,
  targets: WorkflowPromptTarget[],
  memoryManagerType: MemoryManagerType,
): string {
  const safeTargets = targets.length > 0
    ? targets
    : [{
      id: waveId,
      workflow: defaultWorkflowDescriptor(),
    }];
  return [
    "Scene completion follow-up:",
    `Handle this in one pass for scene ${waveId}.`,
    "For EACH beat below, confirm merge/push status " +
    "before workflow transitions.",
    "Do not ask for another follow-up prompt until " +
    "all listed beats are merge-confirmed " +
    "(or blocked by a hard error).",
    ...buildShipFollowUpBoundaryLines("scene"),
    ...safeTargets.flatMap((target) =>
      buildSingleTargetFollowUpLines(
        target,
        memoryManagerType,
      ),
    ),
    "Then summarize per beat: merged yes/no, " +
    "pushed yes/no, workflow command results, " +
    "and PR/review notes when applicable.",
  ].join("\n");
}


export function resolveWorkflowForBeat(
  beat: Beat,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
  fallbackWorkflow: MemoryWorkflowDescriptor,
): MemoryWorkflowDescriptor {
  if (beat.profileId) {
    const matched = workflowsById.get(beat.profileId);
    if (matched) return matched;
  }
  if (beat.workflowId) {
    const matched = workflowsById.get(beat.workflowId);
    if (matched) return matched;
  }
  return fallbackWorkflow;
}

export function toWorkflowPromptTarget(
  beat: Beat,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
  fallbackWorkflow: MemoryWorkflowDescriptor,
): WorkflowPromptTarget {
  return {
    id: beat.id,
    workflow: resolveWorkflowForBeat(
      beat,
      workflowsById,
      fallbackWorkflow,
    ),
    workflowState: beat.state,
  };
}

export function isTerminalBeatState(
  state: string | undefined,
): boolean {
  if (!state) return false;
  return (
    state === "closed" ||
    state === "shipped" ||
    state === "abandoned"
  );
}

export function isAgentOwnedActionState(
  beat: Beat,
  workflow: MemoryWorkflowDescriptor,
): boolean {
  if (
    workflowStatePhase(workflow, beat.state) !==
    StepPhase.Active
  ) {
    return false;
  }
  const ownerKind =
    workflowOwnerKindForState(
      workflow,
      beat.state,
    ) ??
    beat.nextActionOwnerKind ??
    "agent";
  return ownerKind === "agent";
}

export interface RollbackResult {
  beat: Beat;
  rolledBack: boolean;
  fromState?: string;
  toState?: string;
}

export async function rollbackAgentOwnedActionStateToQueue(
  beat: Beat,
  repoPath: string | undefined,
  memoryManagerType: MemoryManagerType,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
  fallbackWorkflow: MemoryWorkflowDescriptor,
  contextLabel: string,
): Promise<RollbackResult> {
  const workflow = resolveWorkflowForBeat(
    beat,
    workflowsById,
    fallbackWorkflow,
  );
  if (!isAgentOwnedActionState(beat, workflow)) {
    return { beat, rolledBack: false };
  }

  const rollbackState = workflowQueueStateForState(
    workflow,
    beat.state,
  );
  if (!rollbackState) {
    return { beat, rolledBack: false };
  }
  const tag =
    `[terminal-manager] [${contextLabel}] [step-failure]`;
  console.warn(
    `${tag} agent left ${beat.id} ` +
    `in active state="${beat.state}"` +
    ` — rolling back to "${rollbackState}"`,
  );

  try {
    await rollbackBeatState(
      beat.id,
      beat.state,
      rollbackState,
      repoPath,
      memoryManagerType,
      `Foolery dispatch: rolled back from ` +
      `${beat.state} to ${rollbackState} ` +
      `— prior agent left knot in action state`,
    );
  } catch (err) {
    console.error(
      `${tag} rollback failed for ${beat.id}:`,
      err,
    );
    return { beat, rolledBack: false };
  }

  const refreshed = await getBackend().get(
    beat.id,
    repoPath,
  );
  if (!refreshed.ok || !refreshed.data) {
    console.warn(
      `${tag} failed to reload ${beat.id} after rollback`,
    );
    return { beat, rolledBack: false };
  }

  console.log(
    `${tag} rolled back ${beat.id}: ${beat.state} -> ` +
    `${refreshed.data.state} ` +
    `claimable=${refreshed.data.isAgentClaimable}`,
  );
  return {
    beat: refreshed.data,
    rolledBack: true,
    fromState: beat.state,
    toState: rollbackState,
  };
}
