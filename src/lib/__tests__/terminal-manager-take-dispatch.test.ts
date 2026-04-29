/* eslint-disable max-lines-per-function */
/**
 * Regression coverage for the "take loop dies on review
 * step when one agent hard-fails" bug. Real-world hit:
 * Codex returned `usageLimitExceeded` on plan_review,
 * the cross-agent review exclusion then removed every
 * candidate from a 2-agent pool (Codex via failed-agent
 * exclusion, Claude via prior-action exclusion), and
 * the take loop terminated mid-knot.
 *
 * `runDispatch` must:
 *   1. Honor the cross-agent review invariant when at
 *      least one alternative remains in the pool.
 *   2. Fall back to the prior action-step agent (with
 *      a banner) when that's the ONLY remaining option,
 *      rather than killing the take.
 *   3. Keep the hard exclusion (failed-agent retry) so
 *      we never re-run the agent that just failed.
 */
import {
  describe, it, expect, vi, beforeEach,
} from "vitest";
import type { FoolerySettings } from "@/lib/schemas";
import type {
  MemoryWorkflowDescriptor,
  MemoryWorkflowOwners,
} from "@/lib/types";
import { runDispatch } from "@/lib/terminal-manager-take-dispatch";
import {
  recordStepAgent,
  _resetStepAgentMap,
} from "@/lib/agent-pool";
import type {
  TakeLoopContext,
} from "@/lib/terminal-manager-take-loop";

const SDLC_OWNERS: MemoryWorkflowOwners = {
  planning: "agent",
  plan_review: "agent",
  implementation: "agent",
};

const sdlcWorkflow: MemoryWorkflowDescriptor = {
  id: "sdlc",
  profileId: "sdlc",
  backingWorkflowId: "sdlc",
  label: "SDLC",
  mode: "granular_autonomous",
  initialState: "ready_for_planning",
  states: [
    "ready_for_planning",
    "planning",
    "ready_for_plan_review",
    "plan_review",
    "ready_for_implementation",
    "implementation",
  ],
  terminalStates: [],
  transitions: [
    { from: "ready_for_planning", to: "planning" },
    { from: "planning", to: "ready_for_plan_review" },
    { from: "ready_for_plan_review", to: "plan_review" },
    { from: "plan_review", to: "ready_for_implementation" },
    { from: "plan_review", to: "ready_for_planning" },
  ],
  finalCutState: null,
  retakeState: "ready_for_planning",
  promptProfileId: "sdlc",
  owners: SDLC_OWNERS,
  queueStates: [
    "ready_for_planning",
    "ready_for_plan_review",
    "ready_for_implementation",
  ],
  actionStates: ["planning", "plan_review", "implementation"],
  queueActions: {
    ready_for_planning: "planning",
    ready_for_plan_review: "plan_review",
    ready_for_implementation: "implementation",
  },
  reviewQueueStates: ["ready_for_plan_review"],
  humanQueueStates: [],
};

const baseSettings: FoolerySettings = {
  dispatchMode: "advanced",
  maxConcurrentSessions: 5,
  maxClaimsPerQueueType: 10,
  terminalLightTheme: false,
  agents: {
    claude: {
      command: "/usr/local/bin/claude",
      agent_type: "cli",
      vendor: "claude",
      provider: "Claude",
      agent_name: "Claude",
      lease_model: "opus/claude",
      model: "claude-opus-4-7",
      version: "4.7",
    },
    codex: {
      command: "/usr/local/bin/codex",
      agent_type: "cli",
      vendor: "codex",
      provider: "Codex",
      agent_name: "Codex",
      lease_model: "gpt",
      model: "gpt-5.5",
      version: "5.5",
    },
  },
  actions: { take: "", scene: "", scopeRefinement: "" },
  pools: {
    planning: [
      { agentId: "claude", weight: 1 },
      { agentId: "codex", weight: 1 },
    ],
    plan_review: [
      { agentId: "claude", weight: 1 },
      { agentId: "codex", weight: 1 },
    ],
    implementation: [
      { agentId: "claude", weight: 1 },
      { agentId: "codex", weight: 1 },
    ],
  },
} as unknown as FoolerySettings;

function makeCtx(): TakeLoopContext {
  return {
    id: "term-test",
    beatId: "foolery-d7b7",
    beat: { id: "foolery-d7b7", state: "ready_for_plan_review" },
    repoPath: "/tmp/repo",
    resolvedRepoPath: "/tmp/repo",
    cwd: "/tmp/repo",
    interactiveSessionTimeoutMinutes: 10,
    memoryManagerType: "knots",
    workflowsById: new Map(),
    fallbackWorkflow: sdlcWorkflow,
    agent: {
      kind: "cli",
      agentId: "codex",
      command: "/usr/local/bin/codex",
    },
    agentInfo: {
      agentName: "Codex",
      agentProvider: "Codex",
      agentModel: "gpt",
      agentVersion: "5.5",
      agentType: "cli",
    },
    entry: {} as unknown as TakeLoopContext["entry"],
    session: {} as unknown as TakeLoopContext["session"],
    interactionLog: {} as unknown as TakeLoopContext["interactionLog"],
    emitter: { emit: vi.fn() } as unknown as TakeLoopContext["emitter"],
    pushEvent: vi.fn(),
    finishSession: vi.fn(),
    sessionAborted: () => false,
    knotsLeaseTerminationStarted: { value: false },
    takeIteration: { value: 2 },
    claimsPerQueueType: new Map(),
    lastAgentPerQueueType: new Map(),
    failedAgentsPerQueueType: new Map(),
    followUpAttempts: { count: 0, lastState: null },
  } as unknown as TakeLoopContext;
}

describe("runDispatch: cross-agent review fallback", () => {
  beforeEach(() => { _resetStepAgentMap(); });

  it(
    "falls back to prior-action agent when " +
    "cross-agent review empties the pool",
    () => {
      // Codex did planning, hit usageLimitExceeded
      // on plan_review; Claude (prior) is the only one
      // left. Without fallback the take dies.
      recordStepAgent(
        "foolery-d7b7", "planning", "claude",
      );
      const ctx = makeCtx();
      ctx.failedAgentsPerQueueType.set(
        "plan_review", new Set(["codex"]),
      );
      const result = runDispatch({
        ctx,
        settings: baseSettings,
        workflow: sdlcWorkflow,
        state: "ready_for_plan_review",
        poolKey: "plan_review",
        queueType: "plan_review",
        excludeAgentIds: new Set(["codex", "claude"]),
        isErrorRetry: true,
        stepFailureRollback: false,
        isReview: true,
        priorAction: "planning",
        failedAgentId: "codex",
        maxClaims: 10,
      });
      expect(result).not.toBe("stop");
      if (result === "stop") return;
      expect(
        result.stepAgentOverride?.agentId,
      ).toBe("claude");
      const stderrCalls = (
        ctx.pushEvent as ReturnType<typeof vi.fn>
      ).mock.calls
        .filter((c) =>
          (c[0] as { type: string }).type === "stderr"
        );
      const fallbackBanner = stderrCalls.find((c) =>
        ((c[0] as { data: string }).data ?? "")
          .includes("Cross-agent review fallback")
      );
      expect(fallbackBanner).toBeDefined();
    },
  );

  it(
    "still hard-fails when even the relaxed exclusion " +
    "leaves nobody (failed-agent is the only one)",
    () => {
      // Single-agent pool: Claude planned, Claude failed
      // plan_review. Hard exclusion of failed agent must
      // be honored — fallback can only relax priorAction,
      // not re-run the agent that just failed.
      recordStepAgent(
        "foolery-d7b7", "planning", "claude",
      );
      const settings: FoolerySettings = {
        ...baseSettings,
        pools: {
          ...baseSettings.pools,
          plan_review: [{ agentId: "claude", weight: 1 }],
        },
      } as FoolerySettings;
      const ctx = makeCtx();
      ctx.failedAgentsPerQueueType.set(
        "plan_review", new Set(["claude"]),
      );
      const result = runDispatch({
        ctx,
        settings,
        workflow: sdlcWorkflow,
        state: "ready_for_plan_review",
        poolKey: "plan_review",
        queueType: "plan_review",
        excludeAgentIds: new Set(["claude"]),
        isErrorRetry: true,
        stepFailureRollback: false,
        isReview: true,
        priorAction: "planning",
        failedAgentId: "claude",
        maxClaims: 10,
      });
      expect(result).toBe("stop");
    },
  );

  it(
    "honors cross-agent invariant when " +
    "alternatives remain (no fallback needed)",
    () => {
      // 3-agent pool: Claude planned, plan_review goes
      // to Codex normally — fallback path not exercised.
      const settings: FoolerySettings = {
        ...baseSettings,
        agents: {
          ...baseSettings.agents,
          opencode: {
            command: "/usr/local/bin/opencode",
            agent_type: "cli",
            vendor: "opencode",
            provider: "OpenCode",
            agent_name: "OpenCode",
            lease_model: "kimi/opencode",
            model: "kimi-k2",
          },
        },
        pools: {
          ...baseSettings.pools,
          plan_review: [
            { agentId: "claude", weight: 1 },
            { agentId: "codex", weight: 1 },
            { agentId: "opencode", weight: 1 },
          ],
        },
      } as FoolerySettings;
      recordStepAgent(
        "foolery-d7b7", "planning", "claude",
      );
      const ctx = makeCtx();
      const result = runDispatch({
        ctx,
        settings,
        workflow: sdlcWorkflow,
        state: "ready_for_plan_review",
        poolKey: "plan_review",
        queueType: "plan_review",
        excludeAgentIds: new Set(["claude"]),
        isErrorRetry: false,
        stepFailureRollback: false,
        isReview: true,
        priorAction: "planning",
        failedAgentId: undefined,
        maxClaims: 10,
      });
      expect(result).not.toBe("stop");
      if (result === "stop") return;
      // Selected agent must NOT be Claude (cross-agent
      // invariant honored without fallback).
      expect(
        result.stepAgentOverride?.agentId,
      ).not.toBe("claude");
      // No fallback banner emitted because the normal
      // path succeeded.
      const stderrCalls = (
        ctx.pushEvent as ReturnType<typeof vi.fn>
      ).mock.calls
        .filter((c) =>
          (c[0] as { type: string }).type === "stderr"
        );
      const fallbackBanner = stderrCalls.find((c) =>
        ((c[0] as { data: string }).data ?? "")
          .includes("Cross-agent review fallback")
      );
      expect(fallbackBanner).toBeUndefined();
    },
  );
});
