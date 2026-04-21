import type {
  ActionOwnerKind,
  MemoryWorkflowDescriptor,
  MemoryWorkflowOwners,
  WorkflowMode,
} from "@/lib/types";
import type { KnotProfileDefinition } from "@/lib/knots";
import {
  inferWorkflowMode,
  profileDisplayName,
  resolveStep,
  StepPhase,
} from "@/lib/workflows";

type OwnerStep =
  | "planning"
  | "plan_review"
  | "implementation"
  | "implementation_review"
  | "shipment"
  | "shipment_review";

function normalizeOwners(
  profile: KnotProfileDefinition,
): MemoryWorkflowOwners {
  const o = profile.owners;
  const get = (key: OwnerStep): ActionOwnerKind =>
    o.states?.[key]?.kind ?? o[key]?.kind ?? "none";
  return {
    planning: get("planning"),
    plan_review: get("plan_review"),
    implementation: get("implementation"),
    implementation_review: get("implementation_review"),
    shipment: get("shipment"),
    shipment_review: get("shipment_review"),
  };
}

function normalizeStateList(
  states: string[] | undefined,
): string[] {
  return Array.from(
    new Set(
      (states ?? [])
        .map((state) =>
          state.trim().toLowerCase()
        )
        .filter((state) => state.length > 0)
    )
  );
}

function normalizeStateOwners(
  profile: KnotProfileDefinition,
  states: string[],
): Record<string, ActionOwnerKind> {
  const explicitEntries = Object.entries(
    profile.owners.states ?? {},
  ).flatMap(([state, owner]) => {
    const normalizedState =
      state.trim().toLowerCase();
    if (
      normalizedState.length === 0 ||
      (owner.kind !== "agent" &&
        owner.kind !== "human")
    ) {
      return [];
    }
    return [[normalizedState, owner.kind] as const];
  });
  if (explicitEntries.length > 0) {
    return Object.fromEntries(explicitEntries);
  }

  return Object.fromEntries(
    states.flatMap((state) => {
      const resolved = resolveStep(state);
      if (!resolved) return [];
      return [[
        state,
        profile.owners[resolved.step]?.kind ??
          "none",
      ] as const];
    })
  );
}

function normalizeQueueActions(
  profile: KnotProfileDefinition,
  queueStates: string[],
  actionStates: string[],
): Record<string, string> {
  const explicitEntries = Object.entries(
    profile.queue_actions ?? {},
  ).flatMap(([queueState, actionState]) => {
    const normalizedQueueState =
      queueState.trim().toLowerCase();
    const normalizedActionState =
      actionState.trim().toLowerCase();
    if (
      normalizedQueueState.length === 0 ||
      normalizedActionState.length === 0
    ) {
      return [];
    }
    return [[
      normalizedQueueState,
      normalizedActionState,
    ] as const];
  });
  if (explicitEntries.length > 0) {
    return Object.fromEntries(explicitEntries);
  }

  const transitionEntries = (profile.transitions ?? [])
    .flatMap((transition) => {
      const from = transition.from
        .trim()
        .toLowerCase();
      const to = transition.to.trim().toLowerCase();
      if (
        !queueStates.includes(from) ||
        !actionStates.includes(to)
      ) {
        return [];
      }
      return [[from, to] as const];
    });
  if (transitionEntries.length > 0) {
    return Object.fromEntries(transitionEntries);
  }

  return Object.fromEntries(
    queueStates.flatMap((state) => {
      const resolved = resolveStep(state);
      return resolved
        ? [[state, resolved.step] as const]
        : [];
    })
  );
}

function modeFromOwners(
  owners: MemoryWorkflowOwners,
  stateOwners: Record<string, ActionOwnerKind>,
  profile: KnotProfileDefinition,
): WorkflowMode {
  const hasHuman =
    Object.values(stateOwners).some(
      (kind) => kind === "human"
    ) ||
    Object.values(owners).some(
      (kind) => kind === "human"
    );
  if (hasHuman) return "coarse_human_gated";
  return inferWorkflowMode(
    profile.id,
    profile.description,
    profile.states,
  );
}

function withWildcardTerminals(
  base: Array<{ from: string; to: string }>,
  terminalStates: string[],
): Array<{ from: string; to: string }> {
  const result = [...base];
  for (const terminal of terminalStates) {
    const hasWildcard = result.some(
      (t) => t.from === "*" && t.to === terminal,
    );
    if (!hasWildcard) {
      result.push({ from: "*", to: terminal });
    }
  }
  return result;
}

export function toDescriptor(
  profile: KnotProfileDefinition,
): MemoryWorkflowDescriptor {
  const states = normalizeStateList(profile.states);
  let queueStates = normalizeStateList(
    profile.queue_states,
  );
  let actionStates = normalizeStateList(
    profile.action_states,
  );
  if (queueStates.length === 0) {
    queueStates = states.filter(
      (state) =>
        resolveStep(state)?.phase ===
        StepPhase.Queued
    );
  }
  if (actionStates.length === 0) {
    actionStates = states.filter(
      (state) =>
        resolveStep(state)?.phase ===
        StepPhase.Active
    );
  }
  const queueActions = normalizeQueueActions(
    profile,
    queueStates,
    actionStates,
  );
  if (queueStates.length === 0) {
    queueStates = Object.keys(queueActions);
  }
  if (actionStates.length === 0) {
    actionStates = Array.from(
      new Set(Object.values(queueActions))
    );
  }
  const stateOwners = normalizeStateOwners(
    profile,
    states,
  );
  const owners = normalizeOwners(profile);
  const reviewQueueStates = queueStates.filter((state) => {
    const resolved = resolveStep(state);
    return resolved ? resolved.step.endsWith("_review") : false;
  });
  const humanQueueStates = queueStates.filter((queueState) => {
    return stateOwners[queueState] === "human";
  });
  const mode = modeFromOwners(
    owners,
    stateOwners,
    profile,
  );
  const initialState =
    profile.initial_state.trim().toLowerCase();

  const terminalStates = profile.terminal_states.map(
    (state) => state.trim().toLowerCase(),
  );
  const baseTransitions = (profile.transitions ?? []).map(
    (transition) => ({
      from: transition.from.trim().toLowerCase(),
      to: transition.to.trim().toLowerCase(),
    }),
  );
  const transitions = withWildcardTerminals(
    baseTransitions,
    terminalStates,
  );

  return {
    id: profile.id,
    profileId: profile.id,
    backingWorkflowId:
      profile.workflow_id
        ?.trim()
        .toLowerCase() ?? profile.id,
    label: profileDisplayName(profile.id),
    mode,
    initialState,
    states,
    terminalStates,
    transitions,
    finalCutState: humanQueueStates[0] ?? null,
    retakeState:
      queueStates.includes(initialState)
        ? initialState
        : queueStates[0] ?? initialState,
    promptProfileId: profile.id,
    owners,
    stateOwners,
    queueStates,
    actionStates,
    queueActions,
    reviewQueueStates,
    humanQueueStates,
  };
}

export function mapForProfiles(
  profiles: KnotProfileDefinition[],
): MemoryWorkflowDescriptor[] {
  const descriptors = profiles.map(toDescriptor);
  const deduped = new Map<string, MemoryWorkflowDescriptor>();
  for (const descriptor of descriptors) {
    deduped.set(descriptor.id, descriptor);
  }
  return Array.from(deduped.values());
}
