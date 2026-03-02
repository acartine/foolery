/**
 * Beads parity tests: verify listReady and deriveWorkflowRuntimeState
 * produce identical results across backends using resolveStep semantics.
 */

import { describe, expect, it } from "vitest";
import {
  builtinProfileDescriptor,
  deriveWorkflowRuntimeState,
  resolveStep,
  StepPhase,
} from "@/lib/workflows";

describe("beads parity: deriveWorkflowRuntimeState", () => {
  const profiles = ["autopilot", "semiauto", "autopilot_no_planning"] as const;

  for (const profileId of profiles) {
    describe(`profile=${profileId}`, () => {
      const workflow = builtinProfileDescriptor(profileId);

      it("queued agent-owned states produce isAgentClaimable=true", () => {
        for (const state of workflow.states) {
          const resolved = resolveStep(state);
          if (!resolved || resolved.phase !== StepPhase.Queued) continue;

          const ownerKind = workflow.owners?.[resolved.step] ?? "agent";
          if (ownerKind !== "agent") continue;

          const runtime = deriveWorkflowRuntimeState(workflow, state);
          expect(runtime.isAgentClaimable).toBe(true);
          expect(runtime.state).toBe(state);
        }
      });

      it("active states produce isAgentClaimable=false", () => {
        for (const state of workflow.states) {
          const resolved = resolveStep(state);
          if (!resolved || resolved.phase !== StepPhase.Active) continue;

          const runtime = deriveWorkflowRuntimeState(workflow, state);
          expect(runtime.isAgentClaimable).toBe(false);
        }
      });

      it("terminal states produce isAgentClaimable=false", () => {
        for (const state of workflow.terminalStates) {
          const runtime = deriveWorkflowRuntimeState(workflow, state);
          expect(runtime.isAgentClaimable).toBe(false);
        }
      });

      it("all states map correctly through resolveStep", () => {
        for (const state of workflow.states) {
          const resolved = resolveStep(state);
          const runtime = deriveWorkflowRuntimeState(workflow, state);

          if (resolved) {
            expect(runtime.nextActionState).toBe(resolved.step);
          } else {
            // terminal/deferred — no next action state
            expect(runtime.nextActionOwnerKind).toBe("none");
          }
        }
      });
    });
  }
});

describe("beads parity: listReady semantics", () => {
  const workflow = builtinProfileDescriptor("autopilot");

  it("queued phase states are the only agent-claimable states", () => {
    for (const state of workflow.states) {
      const resolved = resolveStep(state);
      const runtime = deriveWorkflowRuntimeState(workflow, state);

      if (resolved?.phase === StepPhase.Queued && runtime.nextActionOwnerKind === "agent") {
        expect(runtime.isAgentClaimable).toBe(true);
      } else {
        expect(runtime.isAgentClaimable).toBe(false);
      }
    }
  });

  it("active phase states are never agent-claimable", () => {
    for (const state of workflow.states) {
      const resolved = resolveStep(state);
      if (resolved?.phase === StepPhase.Active) {
        const runtime = deriveWorkflowRuntimeState(workflow, state);
        expect(runtime.isAgentClaimable).toBe(false);
      }
    }
  });

  it("semiauto human-owned queue states are not agent-claimable", () => {
    const semiauto = builtinProfileDescriptor("semiauto");
    for (const state of semiauto.states) {
      const resolved = resolveStep(state);
      if (!resolved || resolved.phase !== StepPhase.Queued) continue;

      const ownerKind = semiauto.owners?.[resolved.step] ?? "agent";
      const runtime = deriveWorkflowRuntimeState(semiauto, state);

      if (ownerKind === "human") {
        expect(runtime.isAgentClaimable).toBe(false);
        expect(runtime.requiresHumanAction).toBe(true);
      }
    }
  });
});
