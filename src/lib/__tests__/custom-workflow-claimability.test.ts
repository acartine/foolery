import { describe, expect, it } from "vitest";
import type {
  KnotProfileDefinition,
  KnotRecord,
} from "@/lib/knots";
import {
  applyFilters,
  toBeat,
} from "@/lib/backends/knots-backend-mappers";
import {
  toDescriptor,
} from "@/lib/backends/knots-backend-workflows";
import {
  deriveWorkflowRuntimeState,
} from "@/lib/workflows";
import {
  classifyIterationSuccess,
} from "@/lib/terminal-manager-take-loop";

function makeProfile(
  overrides: Partial<KnotProfileDefinition> = {},
): KnotProfileDefinition {
  return {
    id: "evaluate",
    workflow_id: "maestro_gate",
    description: "Evaluate gate",
    owners: {
      states: {
        ready_to_evaluate: { kind: "agent" },
        evaluating: { kind: "agent" },
      },
    },
    initial_state: "ready_to_evaluate",
    states: [
      "ready_to_evaluate",
      "evaluating",
      "ready_for_review",
      "approved",
    ],
    queue_states: [
      "ready_to_evaluate",
      "ready_for_review",
    ],
    action_states: ["evaluating"],
    queue_actions: {
      ready_to_evaluate: "evaluating",
    },
    terminal_states: ["approved"],
    transitions: [
      {
        from: "ready_to_evaluate",
        to: "evaluating",
      },
      {
        from: "evaluating",
        to: "ready_for_review",
      },
      {
        from: "evaluating",
        to: "ready_to_evaluate",
      },
      {
        from: "ready_for_review",
        to: "approved",
      },
    ],
    ...overrides,
  };
}

function makeKnot(
  state: string,
  type = "gate",
): KnotRecord {
  return {
    id: `maestro-${state}`,
    title: `Gate ${state}`,
    state,
    profile_id: "evaluate",
    workflow_id: "maestro_gate",
    updated_at: "2026-04-20T00:00:00Z",
    created_at: "2026-04-20T00:00:00Z",
    description: "Custom workflow gate",
    priority: 2,
    type,
    tags: [],
    notes: [],
    handoff_capsules: [],
    workflow_etag: "etag-1",
  };
}

describe("custom workflow runtime", () => {
  it("derives queued and active runtime from profile metadata", () => {
    const descriptor = toDescriptor(makeProfile());

    expect(descriptor.backingWorkflowId).toBe(
      "maestro_gate",
    );
    expect(descriptor.queueStates).toEqual([
      "ready_to_evaluate",
      "ready_for_review",
    ]);
    expect(descriptor.actionStates).toEqual([
      "evaluating",
    ]);
    expect(descriptor.queueActions).toEqual({
      ready_to_evaluate: "evaluating",
    });
    expect(descriptor.stateOwners).toMatchObject({
      ready_to_evaluate: "agent",
      evaluating: "agent",
    });

    const queued = deriveWorkflowRuntimeState(
      descriptor,
      "ready_to_evaluate",
    );
    expect(queued.nextActionState).toBe("evaluating");
    expect(queued.nextActionOwnerKind).toBe("agent");
    expect(queued.isAgentClaimable).toBe(true);
    expect(queued.requiresHumanAction).toBe(false);

    const active = deriveWorkflowRuntimeState(
      descriptor,
      "evaluating",
    );
    expect(active.nextActionState).toBe("evaluating");
    expect(active.isAgentClaimable).toBe(false);
    expect(active.requiresHumanAction).toBe(false);
  });

  it("treats human-owned queue states as escalations", () => {
    const descriptor = toDescriptor(
      makeProfile({
        id: "approval",
        owners: {
          states: {
            waiting_for_approval: { kind: "human" },
            approving: { kind: "human" },
          },
        },
        initial_state: "waiting_for_approval",
        states: [
          "waiting_for_approval",
          "approving",
          "approved",
        ],
        queue_states: ["waiting_for_approval"],
        action_states: ["approving"],
        queue_actions: {
          waiting_for_approval: "approving",
        },
        terminal_states: ["approved"],
        transitions: [
          {
            from: "waiting_for_approval",
            to: "approving",
          },
          { from: "approving", to: "approved" },
        ],
      }),
    );

    const runtime = deriveWorkflowRuntimeState(
      descriptor,
      "waiting_for_approval",
    );
    expect(runtime.isAgentClaimable).toBe(false);
    expect(runtime.requiresHumanAction).toBe(true);
    expect(runtime.nextActionOwnerKind).toBe("human");
  });
});

describe("custom workflow mapping", () => {
  it("maps and filters queued custom workflow knots", () => {
    const descriptor = toDescriptor(makeProfile());
    const workflowsById = new Map([
      [descriptor.id, descriptor],
    ]);
    const queuedBeat = toBeat(
      makeKnot("ready_to_evaluate"),
      [],
      new Set<string>(),
      new Map<string, string>(),
      workflowsById,
    );
    const activeBeat = toBeat(
      makeKnot("evaluating"),
      [],
      new Set<string>(),
      new Map<string, string>(),
      workflowsById,
    );

    expect(queuedBeat.type).toBe("gate");
    expect(queuedBeat.isAgentClaimable).toBe(true);
    expect(queuedBeat.nextActionState).toBe(
      "evaluating",
    );
    expect(activeBeat.isAgentClaimable).toBe(false);

    expect(
      applyFilters(
        [queuedBeat, activeBeat],
        { state: "queued" },
      ).map((beat) => beat.id),
    ).toEqual([queuedBeat.id]);
    expect(
      applyFilters(
        [queuedBeat, activeBeat],
        { state: "in_action" },
      ).map((beat) => beat.id),
    ).toEqual([activeBeat.id]);
  });

  it("classifies custom workflow action transitions as success", () => {
    const descriptor = toDescriptor(makeProfile());

    expect(
      classifyIterationSuccess(
        0,
        "ready_to_evaluate",
        "ready_for_review",
        descriptor,
      ),
    ).toBe(true);
    expect(
      classifyIterationSuccess(
        0,
        "ready_to_evaluate",
        "ready_to_evaluate",
        descriptor,
      ),
    ).toBe(false);
  });
});
