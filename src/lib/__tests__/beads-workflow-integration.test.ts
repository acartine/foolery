/**
 * Beads Workflow Integration tests.
 *
 * Covers:
 *  (1) forwardTransitionTarget() across all states and profiles
 *  (2) nextBeat()/claimBeat() happy path + error cases across profiles
 *  (3) BeadsBackend.buildTakePrompt() claim flow
 *  (4) BeadsBackend.buildPollPrompt()
 *  (5) advanceGuarded() dispatch via terminal-manager
 *  (6) Knots regression (existing tests run alongside)
 */

import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import {
  builtinProfileDescriptor,
  builtinWorkflowDescriptors,
  forwardTransitionTarget,
  resolveStep,
  StepPhase,
} from "@/lib/workflows";


// ── (1) forwardTransitionTarget across all profiles ────────────

const ALL_PROFILE_IDS = builtinWorkflowDescriptors().map((w) => w.id);

describe("forwardTransitionTarget: exhaustive profile coverage", () => {
  for (const profileId of ALL_PROFILE_IDS) {
    describe(`profile: ${profileId}`, () => {
      const workflow = builtinProfileDescriptor(profileId);

      it("every queued state has a forward target to its active counterpart", () => {
        for (const state of workflow.states) {
          const resolved = resolveStep(state, workflow);
          if (!resolved || resolved.phase !== StepPhase.Queued) continue;
          const target = forwardTransitionTarget(state, workflow);
          expect(target).not.toBeNull();
          const targetResolved = resolveStep(target!, workflow);
          expect(targetResolved).not.toBeNull();
          expect(targetResolved!.phase).toBe(StepPhase.Active);
          expect(targetResolved!.step).toBe(resolved.step);
        }
      });

      it("every active state has a forward target to the next queue or terminal", () => {
        for (const state of workflow.states) {
          const resolved = resolveStep(state, workflow);
          if (!resolved || resolved.phase !== StepPhase.Active) continue;
          const target = forwardTransitionTarget(state, workflow);
          expect(target).not.toBeNull();
          const targetResolved = resolveStep(target!, workflow);
          if (targetResolved) {
            expect(targetResolved.phase).toBe(StepPhase.Queued);
          } else {
            expect(workflow.terminalStates).toContain(target);
          }
        }
      });

      it("terminal states have no forward target", () => {
        for (const state of workflow.terminalStates) {
          expect(forwardTransitionTarget(state, workflow)).toBeNull();
        }
      });

      it("forward chain from initial state reaches shipped", () => {
        let state = workflow.initialState;
        const visited = new Set<string>();
        while (state && !workflow.terminalStates.includes(state)) {
          expect(visited.has(state)).toBe(false);
          visited.add(state);
          const next = forwardTransitionTarget(state, workflow);
          if (!next) break;
          state = next;
        }
        expect(state).toBe("shipped");
      });
    });
  }
});

// ── (2) nextBeat/claimBeat across profiles ─────────────────────

import { nextBeat, claimBeat } from "@/lib/beads-state-machine";
import { MockBackendPort } from "@/lib/__tests__/mock-backend-port";

const mockBackend = new MockBackendPort();
vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => mockBackend,
}));

async function seedBeat(state: string, profileId = "autopilot"): Promise<string> {
  const result = await mockBackend.create({
    title: "Test beat",
    type: "work",
    priority: 2,
    labels: [],
    profileId,
  });
  const id = result.data!.id;
  await mockBackend.update(id, { state });
  return id;
}

describe("nextBeat across profiles", () => {
  beforeEach(() => mockBackend.reset());

  for (const profileId of ALL_PROFILE_IDS) {
    const workflow = builtinProfileDescriptor(profileId);

    it(`advances from initial state for profile ${profileId}`, async () => {
      const initialState = workflow.initialState;
      const id = await seedBeat(initialState, profileId);
      const { nextState } = await nextBeat(id, initialState);
      const expectedTarget = forwardTransitionTarget(initialState, workflow);
      expect(nextState).toBe(expectedTarget);
    });
  }

  it("rejects advancement when backend.get fails", async () => {
    await expect(nextBeat("nonexistent-xyz", "planning")).rejects.toThrow(/not found/i);
  });

  it("rejects advancement from deferred state", async () => {
    const id = await seedBeat("deferred");
    await expect(nextBeat(id, "deferred")).rejects.toThrow(/no forward transition/i);
  });

  it("rejects advancement from abandoned state", async () => {
    const id = await seedBeat("abandoned");
    await expect(nextBeat(id, "abandoned")).rejects.toThrow(/no forward transition/i);
  });
});

describe("claimBeat across profiles", () => {
  beforeEach(() => mockBackend.reset());

  for (const profileId of ALL_PROFILE_IDS) {
    const workflow = builtinProfileDescriptor(profileId);

    it(`claims initial state for profile ${profileId}`, async () => {
      const initialState = workflow.initialState;
      const id = await seedBeat(initialState, profileId);
      const { nextState } = await claimBeat(id);
      const expectedTarget = forwardTransitionTarget(initialState, workflow);
      expect(nextState).toBe(expectedTarget);
    });
  }

  it("rejects claim on active state (implementation)", async () => {
    const id = await seedBeat("implementation");
    await expect(claimBeat(id)).rejects.toThrow();
  });

  it("rejects claim on human-owned queue state (semiauto plan_review)", async () => {
    const id = await seedBeat("ready_for_plan_review", "semiauto");
    await expect(claimBeat(id)).rejects.toThrow(/not claimable/i);
  });

  it("rejects claim on human-owned queue state (semiauto_no_planning impl_review)", async () => {
    const id = await seedBeat("ready_for_implementation_review", "semiauto_no_planning");
    await expect(claimBeat(id)).rejects.toThrow(/not claimable/i);
  });

  it("succeeds on agent-owned queue state (autopilot_no_planning ready_for_implementation)", async () => {
    const id = await seedBeat("ready_for_implementation", "autopilot_no_planning");
    const { nextState } = await claimBeat(id);
    expect(nextState).toBe("implementation");
  });
});

// ── (3) & (4) BeadsBackend buildTakePrompt / buildPollPrompt ───

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BeadsBackend } from "@/lib/backends/beads-backend";

function makeTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "beads-wf-int-"));
  mkdirSync(join(dir, ".beads"), { recursive: true });
  return dir;
}

let tmpDirs: string[] = [];

function createBackendWithRepo(): { backend: BeadsBackend; repo: string } {
  const repo = makeTmpRepo();
  tmpDirs.push(repo);
  return { backend: new BeadsBackend(repo), repo };
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

describe("BeadsBackend.buildTakePrompt: claim flow variations", () => {
  it("claims a no-planning profile beat at ready_for_implementation", async () => {
    const { backend } = createBackendWithRepo();
    const created = await backend.create({
      title: "NP claim test",
      type: "task",
      priority: 2,
      labels: [],
      profileId: "autopilot_no_planning",
    });
    const id = created.data!.id;
    const beat = await backend.get(id);
    expect(beat.data!.state).toBe("ready_for_implementation");
    expect(beat.data!.isAgentClaimable).toBe(true);

    const result = await backend.buildTakePrompt(id);
    expect(result.ok).toBe(true);
    expect(result.data!.claimed).toBe(true);

    const afterClaim = await backend.get(id);
    expect(afterClaim.data!.state).toBe("implementation");
  });

  it("does not claim a shipped beat", async () => {
    const { backend } = createBackendWithRepo();
    const created = await backend.create({
      title: "Shipped beat",
      type: "task",
      priority: 2,
      labels: [],
    });
    await backend.update(created.data!.id, { state: "shipped" });

    const result = await backend.buildTakePrompt(created.data!.id);
    expect(result.ok).toBe(true);
    expect(result.data!.claimed).toBe(false);
  });

  it("does not claim a human-gated queued beat (semiauto ready_for_plan_review)", async () => {
    const { backend } = createBackendWithRepo();
    const created = await backend.create({
      title: "Human queue",
      type: "task",
      priority: 2,
      labels: [],
      profileId: "semiauto",
    });
    await backend.update(created.data!.id, { state: "ready_for_plan_review" });

    const result = await backend.buildTakePrompt(created.data!.id);
    expect(result.ok).toBe(true);
    expect(result.data!.claimed).toBe(false);
  });

  it("parent prompt includes child IDs and does not claim", async () => {
    const { backend } = createBackendWithRepo();
    const parent = await backend.create({ title: "Parent", type: "task", priority: 2, labels: [] });
    const child1 = await backend.create({ title: "Child 1", type: "task", priority: 2, labels: [] });
    const child2 = await backend.create({ title: "Child 2", type: "task", priority: 2, labels: [] });

    const result = await backend.buildTakePrompt(parent.data!.id, {
      isParent: true,
      childBeatIds: [child1.data!.id, child2.data!.id],
    });
    expect(result.ok).toBe(true);
    expect(result.data!.claimed).toBe(false);
    expect(result.data!.prompt).toContain(child1.data!.id);
    expect(result.data!.prompt).toContain(child2.data!.id);
    expect(result.data!.prompt).toContain("Parent beat ID:");
  });
});

describe("BeadsBackend.buildPollPrompt: priority selection", () => {
  it("selects highest priority (lowest number) beat", async () => {
    const { backend } = createBackendWithRepo();
    await backend.create({ title: "Low", type: "task", priority: 4, labels: [] });
    const high = await backend.create({ title: "High", type: "task", priority: 0, labels: [] });
    await backend.create({ title: "Medium", type: "task", priority: 2, labels: [] });

    const result = await backend.buildPollPrompt();
    expect(result.ok).toBe(true);
    expect(result.data!.claimedId).toBe(high.data!.id);
  });

  it("skips human-gated beats", async () => {
    const { backend } = createBackendWithRepo();
    const created = await backend.create({
      title: "Human beat",
      type: "task",
      priority: 0,
      labels: [],
      profileId: "semiauto",
    });
    await backend.update(created.data!.id, { state: "ready_for_plan_review" });

    const result = await backend.buildPollPrompt();
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND when all beats are in terminal states", async () => {
    const { backend } = createBackendWithRepo();
    const c = await backend.create({ title: "Done", type: "task", priority: 1, labels: [] });
    await backend.close(c.data!.id);

    const result = await backend.buildPollPrompt();
    expect(result.ok).toBe(false);
  });
});

// ── (5) advanceGuarded dispatch coverage ───────────────────────

describe("advanceGuarded dispatch (via nextBeat/nextKnot)", () => {
  beforeEach(() => mockBackend.reset());

  it("nextBeat succeeds: returns ok result", async () => {
    const id = await seedBeat("implementation");
    const result = await nextBeat(id, "implementation");
    expect(result.nextState).toBe("ready_for_implementation_review");
  });

  it("nextBeat expected-state mismatch error contains diagnostic info", async () => {
    const id = await seedBeat("implementation");
    try {
      await nextBeat(id, "planning");
      expect.fail("should throw");
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).toContain("expected state");
      expect(msg).toContain("currently");
      expect(msg).toContain("planning");
      expect(msg).toContain("implementation");
    }
  });

  it("nextBeat on terminal state gives no-forward-transition error", async () => {
    const id = await seedBeat("shipped");
    await expect(nextBeat(id, "shipped")).rejects.toThrow(/no forward transition/i);
  });
});
