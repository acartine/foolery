/* eslint-disable max-lines-per-function */
import { describe, it, expect } from "vitest";
import type { FoolerySettings } from "@/lib/schemas";
import type {
  MemoryWorkflowDescriptor,
  MemoryWorkflowOwners,
} from "@/lib/types";
import {
  resolveDispatchAgent,
  DispatchFailureError,
  DISPATCH_FAILURE_MARKER,
  derivePoolKey,
} from "@/lib/dispatch-pool-resolver";
import {
  builtinProfileDescriptor,
} from "@/lib/workflows";

/**
 * Regression coverage for the "gate dispatch should not fall back to OpenCode"
 * bug. Before this refactor, any beat in a non-SDLC workflow state (like a
 * gate knot's `ready_to_evaluate`) caused `resolveSessionAgent` to fall
 * through to `getFallbackCommand`, which returned whichever agent happened
 * to be first in the settings TOML — OpenCode in the user's case. The new
 * behavior must:
 *   1. Derive the pool key from the workflow descriptor's `queueActions`.
 *   2. Select only from that pool.
 *   3. Hard-fail with a "FOOLERY DISPATCH FAILURE" banner when the pool
 *      is unconfigured, rather than silently returning the first agent.
 */
describe("resolveDispatchAgent", () => {
  const GATE_OWNERS: MemoryWorkflowOwners = {
    evaluating: "agent",
    gate_review: "agent",
  };

  const gateWorkflow: MemoryWorkflowDescriptor = {
    id: "maestro_gate",
    profileId: "maestro_gate",
    backingWorkflowId: "maestro_gate",
    label: "Maestro Gate",
    mode: "granular_autonomous",
    initialState: "ready_to_evaluate",
    states: [
      "ready_to_evaluate",
      "evaluating",
      "ready_for_gate_review",
      "gate_review",
      "approved",
      "rejected",
    ],
    terminalStates: ["approved", "rejected"],
    transitions: [
      { from: "ready_to_evaluate", to: "evaluating" },
      { from: "evaluating", to: "ready_for_gate_review" },
      { from: "ready_for_gate_review", to: "gate_review" },
      { from: "gate_review", to: "approved" },
      { from: "gate_review", to: "rejected" },
    ],
    finalCutState: null,
    retakeState: "ready_to_evaluate",
    promptProfileId: "maestro_gate",
    owners: GATE_OWNERS,
    queueStates: ["ready_to_evaluate", "ready_for_gate_review"],
    actionStates: ["evaluating", "gate_review"],
    queueActions: {
      ready_to_evaluate: "evaluating",
      ready_for_gate_review: "gate_review",
    },
    reviewQueueStates: ["ready_for_gate_review"],
    humanQueueStates: [],
  };

  const settingsWithEvaluatingPool: FoolerySettings = {
    dispatchMode: "advanced",
    maxConcurrentSessions: 5,
    maxClaimsPerQueueType: 10,
    terminalLightTheme: false,
    agents: {
      "opencode-agent": {
        command: "/opt/homebrew/bin/opencode",
        agent_type: "cli",
        vendor: "opencode",
      },
      "claude-opus-4-7": {
        command: "/Applications/cmux.app/Contents/Resources/bin/claude",
        agent_type: "cli",
        vendor: "claude",
        model: "claude-opus-4-7",
      },
      "codex-gpt-5-4": {
        command: "/Users/example/bin/codex",
        agent_type: "cli",
        vendor: "codex",
        model: "gpt-5.4",
      },
    },
    actions: { take: "", scene: "", scopeRefinement: "", staleGrooming: "" },
    pools: {
      orchestration: [],
      planning: [],
      plan_review: [],
      implementation: [],
      implementation_review: [],
      shipment: [],
      shipment_review: [],
      scope_refinement: [],
      stale_grooming: [],
      evaluating: [
        { agentId: "claude-opus-4-7", weight: 1 },
        { agentId: "codex-gpt-5-4", weight: 1 },
      ],
    },
    backend: { type: "auto" },
    defaults: {
      profileId: "",
      interactiveSessionTimeoutMinutes: 10,
    },
    scopeRefinement: { prompt: "" },
  } as unknown as FoolerySettings;

  it("derives pool key from workflow.queueActions for ready_to_evaluate", () => {
    const poolKey = derivePoolKey({
      beatId: "gate-1",
      state: "ready_to_evaluate",
      workflow: gateWorkflow,
      settings: settingsWithEvaluatingPool,
    });
    expect(poolKey).toBe("evaluating");
  });

  it("picks only from [[pools.evaluating]] — never OpenCode — even though OpenCode is first in agents", () => {
    const selections = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const agent = resolveDispatchAgent(
        {
          beatId: "gate-1",
          state: "ready_to_evaluate",
          workflow: gateWorkflow,
          settings: settingsWithEvaluatingPool,
        },
      );
      expect(agent).not.toBeNull();
      selections.add(agent!.agentId!);
    }
    expect(selections).not.toContain("opencode-agent");
    for (const id of selections) {
      expect(["claude-opus-4-7", "codex-gpt-5-4"]).toContain(id);
    }
  });

  it("throws FOOLERY DISPATCH FAILURE when [[pools.evaluating]] is empty", () => {
    const settings: FoolerySettings = {
      ...settingsWithEvaluatingPool,
      pools: { ...settingsWithEvaluatingPool.pools, evaluating: [] },
    };
    expect(() =>
      resolveDispatchAgent({
        beatId: "gate-1",
        state: "ready_to_evaluate",
        workflow: gateWorkflow,
        settings,
      }),
    ).toThrow(DispatchFailureError);
    try {
      resolveDispatchAgent({
        beatId: "gate-1",
        state: "ready_to_evaluate",
        workflow: gateWorkflow,
        settings,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(DispatchFailureError);
      expect((err as Error).message).toContain(DISPATCH_FAILURE_MARKER);
      const info = (err as DispatchFailureError).info;
      expect(info.kind).toBe("agent");
      if (info.kind === "agent") {
        expect(info.poolKey).toBe("evaluating");
        expect(info.reason).toBe("no_pool_configured");
      }
    }
  });

  it("throws FOOLERY DISPATCH FAILURE when workflow has no queueActions for the state", () => {
    const brokenWorkflow: MemoryWorkflowDescriptor = {
      ...gateWorkflow,
      queueActions: {},
    };
    expect(() =>
      resolveDispatchAgent({
        beatId: "gate-1",
        state: "ready_to_evaluate",
        workflow: brokenWorkflow,
        settings: settingsWithEvaluatingPool,
      }),
    ).toThrow(/FOOLERY DISPATCH FAILURE/);
  });

  it("throws FOOLERY DISPATCH FAILURE when the only pool entry references an unregistered agent", () => {
    const settings: FoolerySettings = {
      ...settingsWithEvaluatingPool,
      pools: {
        ...settingsWithEvaluatingPool.pools,
        evaluating: [{ agentId: "ghost", weight: 1 }],
      },
    };
    expect(() =>
      resolveDispatchAgent({
        beatId: "gate-1",
        state: "ready_to_evaluate",
        workflow: gateWorkflow,
        settings,
      }),
    ).toThrow(/FOOLERY DISPATCH FAILURE/);
  });

  it("dispatches the SDLC autopilot workflow through the same unified path", () => {
    const autopilot = builtinProfileDescriptor("autopilot");
    const settings: FoolerySettings = {
      ...settingsWithEvaluatingPool,
      pools: {
        ...settingsWithEvaluatingPool.pools,
        implementation: [
          { agentId: "claude-opus-4-7", weight: 1 },
        ],
      },
    };
    const agent = resolveDispatchAgent({
      beatId: "beat-1",
      state: "ready_for_implementation",
      workflow: autopilot,
      settings,
    });
    expect(agent).not.toBeNull();
    expect(agent!.agentId).toBe("claude-opus-4-7");
  });

  it("emits the red ANSI banner via console.error on failure", () => {
    const calls: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      resolveDispatchAgent({
        beatId: "gate-1",
        state: "ready_to_evaluate",
        workflow: { ...gateWorkflow, queueActions: {} },
        settings: settingsWithEvaluatingPool,
      });
    } catch {
      // expected
    } finally {
      console.error = originalError;
    }
    const logged = calls.map((args) => String(args[0])).join("\n");
    expect(logged).toContain("FOOLERY DISPATCH FAILURE");
    // Red-background ANSI sequence
    expect(logged).toMatch(/\x1b\[41/);
  });
});
