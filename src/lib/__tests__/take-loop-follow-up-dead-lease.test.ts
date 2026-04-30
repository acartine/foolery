import { describe, it, expect } from "vitest";
import {
  evaluateLeaseHealth,
  type LeaseHealthChecker,
} from "@/lib/terminal-manager-take-follow-up";
import {
  emitDispatchFailureBanner,
  type LeaseDeadDispatchFailure,
  DISPATCH_FAILURE_MARKER,
} from "@/lib/dispatch-pool-resolver";

/**
 * Hermetic tests for the take-loop dead-lease guard (foolery-2dd7).
 *
 * The guard's contract is: before sending a take-loop follow-up
 * prompt, evaluateLeaseHealth must inspect the bound lease's state
 * and return healthy=false (with a specific reason) when the lease
 * is anything other than lease_ready / lease_active. The follow-up
 * code path treats not-healthy as fail-closed and emits a
 * FOOLERY DISPATCH FAILURE banner of kind=lease_dead.
 *
 * These tests exercise:
 *   - the pure evaluateLeaseHealth function (all reason branches),
 *   - the emitDispatchFailureBanner contract for kind=lease_dead.
 *
 * The wiring (sendFollowUpPrompt's await + refusal pattern) is
 * exercised at the integration level by the existing follow-up
 * test suite — those tests already cover the happy path; any
 * regression in the wiring would surface there.
 */

function checkerReturning(
  leases: Array<{ id?: string | null; state?: string }>,
): LeaseHealthChecker {
  return {
    list: async () => ({ ok: true, data: leases }),
  };
}

function checkerFailing(error: string): LeaseHealthChecker {
  return {
    list: async () => ({ ok: false, error }),
  };
}

describe("evaluateLeaseHealth", () => {
  it("healthy when lease state is lease_ready", async () => {
    const result = await evaluateLeaseHealth(
      "lease-A",
      undefined,
      checkerReturning([{ id: "lease-A", state: "lease_ready" }]),
    );
    expect(result.healthy).toBe(true);
    expect(result.leaseState).toBe("lease_ready");
    expect(result.reason).toBeUndefined();
  });

  it("healthy when lease state is lease_active", async () => {
    const result = await evaluateLeaseHealth(
      "lease-A",
      undefined,
      checkerReturning([{ id: "lease-A", state: "lease_active" }]),
    );
    expect(result.healthy).toBe(true);
    expect(result.leaseState).toBe("lease_active");
  });

  it("dead with reason=lease_terminated when state is lease_terminated", async () => {
    const result = await evaluateLeaseHealth(
      "lease-A",
      undefined,
      checkerReturning([{ id: "lease-A", state: "lease_terminated" }]),
    );
    expect(result.healthy).toBe(false);
    expect(result.reason).toBe("lease_terminated");
    expect(result.leaseState).toBe("lease_terminated");
    expect(result.detail).toContain("lease_terminated");
  });

  it("dead with reason=lease_missing when ctx has no leaseId", async () => {
    const result = await evaluateLeaseHealth(
      undefined,
      undefined,
      checkerReturning([]),
    );
    expect(result.healthy).toBe(false);
    expect(result.reason).toBe("lease_missing");
    expect(result.detail).toContain("knotsLeaseId is undefined");
  });

  it("dead with reason=lease_missing when leaseId not in list", async () => {
    const result = await evaluateLeaseHealth(
      "lease-A",
      undefined,
      checkerReturning([{ id: "other-lease", state: "lease_ready" }]),
    );
    expect(result.healthy).toBe(false);
    expect(result.reason).toBe("lease_missing");
    expect(result.detail).toContain("not present");
  });

  it("dead with reason=lease_state_unknown when listLeases fails", async () => {
    const result = await evaluateLeaseHealth(
      "lease-A",
      undefined,
      checkerFailing("kno not on PATH"),
    );
    expect(result.healthy).toBe(false);
    expect(result.reason).toBe("lease_state_unknown");
    expect(result.detail).toBe("kno not on PATH");
  });

  it("treats unrecognized lease state as dead (fail-closed)", async () => {
    const result = await evaluateLeaseHealth(
      "lease-A",
      undefined,
      checkerReturning([{ id: "lease-A", state: "lease_pending_unknown" }]),
    );
    expect(result.healthy).toBe(false);
    expect(result.reason).toBe("lease_terminated");
    expect(result.leaseState).toBe("lease_pending_unknown");
  });
});

describe("emitDispatchFailureBanner kind=lease_dead", () => {
  it("includes all dead-lease metadata in the banner", () => {
    const failure: LeaseDeadDispatchFailure = {
      kind: "lease_dead",
      beatId: "maestro-ca91",
      sessionId: "term-1777515514586-a2eu8t",
      iteration: 3,
      leaseId: "maestro-a85e",
      leaseState: "lease_terminated",
      beatState: "ready_for_implementation",
      expectedStep: "implementation",
      agentName: "OpenCode",
      agentProvider: "OpenCode",
      agentModel: "openrouter/moonshotai/kimi-k2.6",
      agentVersion: "4.7",
      followUpCount: 2,
      promptSource: "take_loop_follow_up",
      reason: "lease_terminated",
      detail:
        "lease state lease_terminated is not in {lease_ready, lease_active}",
    };
    const banner = emitDispatchFailureBanner(failure);
    expect(banner).toContain(DISPATCH_FAILURE_MARKER);
    expect(banner).toContain("lease is dead");
    expect(banner).toContain("maestro-ca91");
    expect(banner).toContain("term-1777515514586-a2eu8t");
    expect(banner).toContain("maestro-a85e");
    expect(banner).toContain("lease_terminated");
    expect(banner).toContain("ready_for_implementation");
    expect(banner).toContain("implementation");
    expect(banner).toContain("OpenCode");
    expect(banner).toContain("openrouter/moonshotai/kimi-k2.6");
    expect(banner).toContain("followUpCount = 2");
    expect(banner).toContain("take_loop_follow_up");
    expect(banner).toContain("kno rollback");
  });

  it("includes lease_state_unknown remediation when fetch failed", () => {
    const failure: LeaseDeadDispatchFailure = {
      kind: "lease_dead",
      beatId: "b",
      sessionId: "s",
      reason: "lease_state_unknown",
      detail: "listLeases failed",
    };
    const banner = emitDispatchFailureBanner(failure);
    expect(banner).toContain("Failing closed");
  });

  it("includes lease_missing remediation when lease not in list", () => {
    const failure: LeaseDeadDispatchFailure = {
      kind: "lease_dead",
      beatId: "b",
      sessionId: "s",
      reason: "lease_missing",
      leaseId: "lease-A",
    };
    const banner = emitDispatchFailureBanner(failure);
    expect(banner).toContain("not present");
  });
});
