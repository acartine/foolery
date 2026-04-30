/* eslint-disable max-lines-per-function */
import { describe, it, expect } from "vitest";
import type { KnotRecord } from "@/lib/knots";
import {
  captureBeatSnapshot,
  runPostTurnForensics,
} from "@/lib/dispatch-forensics";
import {
  classifyTurnFailure,
  buildForensicBannerBody,
  DISPATCH_FORENSIC_MARKER,
} from "@/lib/dispatch-forensics-classify";
import {
  createMemorySnapshotWriter,
  snapshotPath,
  DISPATCH_FORENSICS_SLUG,
} from "@/lib/dispatch-forensics-storage";
import type {
  BeatSnapshot,
  CaptureContext,
} from "@/lib/dispatch-forensics-types";

/**
 * Hermetic tests for dispatch forensics (foolery-dd9c).
 *
 * Per the project's Hermetic Test Policy, all dependencies are
 * injected. No real fs writes, no real `kno` exec. The
 * `createMemorySnapshotWriter` records every write in memory; the
 * `showKnot` / `listLeases` stubs return inline data the test built.
 */

// ── Test helpers ────────────────────────────────────────────────

interface StubKnot {
  state: string;
  steps?: Array<{
    id: string;
    step: string;
    lease_id: string;
    agent_name?: string;
    agent_model?: string;
    agent_version?: string;
    started_at?: string;
    ended_at?: string;
    from_state?: string;
    to_state?: string;
  }>;
}

function makeBeat(id: string, k: StubKnot): KnotRecord {
  return {
    id,
    title: id,
    state: k.state,
    updated_at: "2026-04-30T02:19:48.062Z",
    step_history: k.steps ?? [],
  };
}

function makeLease(
  id: string,
  state: string,
  agent?: { name?: string; model?: string; version?: string },
  beatId?: string,
  sessionId?: string,
): KnotRecord {
  return {
    id,
    title: id,
    state,
    updated_at: "2026-04-30T02:19:48.062Z",
    lease: {
      lease_type: "agent",
      nickname:
        `foolery:terminal_manager_take:${sessionId ?? "ses-1"}` +
        (beatId ? `:${beatId}` : ""),
      agent_info: {
        agent_type: "cli",
        provider: agent?.name ?? "test",
        agent_name: agent?.name ?? "test",
        model: agent?.model ?? "test",
        model_version: agent?.version ?? "1",
      },
    },
  };
}

function ctx(overrides: Partial<CaptureContext> = {}): CaptureContext {
  return {
    sessionId: "ses-1",
    beatId: "test-beat",
    leaseId: "lease-A",
    iteration: 1,
    ...overrides,
  };
}

// ── captureBeatSnapshot ────────────────────────────────────────

describe("captureBeatSnapshot", () => {
  it("persists a snapshot file and emits an audit event", async () => {
    const writer = createMemorySnapshotWriter();
    const auditCalls: Array<{
      event: string;
      payload: Record<string, unknown>;
    }> = [];
    const beat = makeBeat("test-beat", { state: "ready_for_implementation" });
    const lease = makeLease(
      "lease-A", "lease_ready", undefined, "test-beat", "ses-1",
    );
    const fixedNow = new Date("2026-04-30T02:19:41.449Z");

    const snap = await captureBeatSnapshot(
      "pre_lease",
      ctx(),
      {
        writer,
        showKnot: async () => ({ ok: true, data: beat }),
        listLeases: async () => ({ ok: true, data: [lease] }),
        logAudit: (event, payload) => {
          auditCalls.push({ event, payload });
        },
        now: () => fixedNow,
      },
    );

    expect(snap.boundary).toBe("pre_lease");
    expect(snap.capturedAt).toBe(fixedNow.toISOString());
    expect(snap.beat?.state).toBe("ready_for_implementation");
    expect(snap.leases).toHaveLength(1);
    expect(snap.captureErrors).toBeUndefined();

    expect(writer.snapshots).toHaveLength(1);
    const written = writer.snapshots[0];
    expect(written.path).toContain(DISPATCH_FORENSICS_SLUG);
    expect(written.path).toContain("pre_lease");
    expect(written.path).toContain("test-beat");

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].event).toBe("beat_snapshot_pre_lease");
    expect(auditCalls[0].payload.snapshotPath).toBe(written.path);
  });

  it("records a captureErrors entry when showKnot fails", async () => {
    const writer = createMemorySnapshotWriter();
    const snap = await captureBeatSnapshot("post_turn_failure", ctx(), {
      writer,
      showKnot: async () => ({ ok: false, error: "boom" }),
      listLeases: async () => ({ ok: true, data: [] }),
    });
    expect(snap.beat).toBeUndefined();
    expect(snap.captureErrors).toEqual(["showKnot: boom"]);
    // file still written so investigators see the gap
    expect(writer.snapshots).toHaveLength(1);
  });

  it("does not throw when the writer throws", async () => {
    const failingWriter = {
      async write() {
        throw new Error("disk full");
      },
    };
    await expect(
      captureBeatSnapshot("post_turn_success", ctx(), {
        writer: failingWriter,
        showKnot: async () => ({ ok: true, data: makeBeat("b", { state: "x" }) }),
        listLeases: async () => ({ ok: true, data: [] }),
        logAudit: () => undefined,
      }),
    ).resolves.toBeDefined();
  });
});

// ── snapshotPath ────────────────────────────────────────────────

describe("snapshotPath", () => {
  it("includes date / sessionId / boundary / beatId in the path", () => {
    const p = snapshotPath({
      logRoot: "/r",
      date: "2026-04-30",
      sessionId: "ses-1",
      beatId: "maestro-ca91",
      boundary: "post_turn_failure",
      capturedAt: "2026-04-30T02:19:48.062Z",
    });
    expect(p).toContain("/r/_dispatch_forensics/2026-04-30/ses-1/");
    expect(p).toContain("post_turn_failure");
    expect(p).toContain("maestro-ca91");
    expect(p).toMatch(/\.json$/u);
  });
});

// ── classifyTurnFailure ────────────────────────────────────────

function makePreSnapshot(
  beat: KnotRecord,
  leases: KnotRecord[],
): BeatSnapshot {
  return {
    boundary: "pre_lease",
    capturedAt: "2026-04-30T02:19:41.449Z",
    sessionId: "ses-1",
    beatId: beat.id,
    leaseId: "lease-A",
    iteration: 1,
    foolerypid: 1,
    beat,
    leases,
  };
}

function makePostSnapshot(
  beat: KnotRecord,
  leases: KnotRecord[],
): BeatSnapshot {
  return {
    boundary: "post_turn_failure",
    capturedAt: "2026-04-30T02:19:58.791Z",
    sessionId: "ses-1",
    beatId: beat.id,
    leaseId: "lease-A",
    iteration: 1,
    foolerypid: 1,
    beat,
    leases,
  };
}

describe("classifyTurnFailure", () => {
  it("returns null when nothing changed", () => {
    const beat = makeBeat("b", { state: "ready_for_implementation" });
    const lease = makeLease("lease-A", "lease_ready");
    const result = classifyTurnFailure(
      makePreSnapshot(beat, [lease]),
      makePostSnapshot(beat, [lease]),
    );
    expect(result).toBeNull();
  });

  it("detects a concurrent claim by another agent", () => {
    const preBeat = makeBeat("b", { state: "ready_for_implementation" });
    const postBeat = makeBeat("b", {
      state: "implementation",
      steps: [{
        id: "step-1",
        step: "implementation",
        lease_id: "other-lease",
        agent_name: "OtherAgent",
        agent_model: "other",
        agent_version: "1",
      }],
    });
    const otherLease = makeLease("other-lease", "lease_terminated", {
      name: "OtherAgent",
      model: "other",
      version: "1",
    });
    const result = classifyTurnFailure(
      makePreSnapshot(preBeat, [makeLease("lease-A", "lease_ready")]),
      makePostSnapshot(postBeat, [
        makeLease("lease-A", "lease_ready"),
        otherLease,
      ]),
    );
    expect(result?.category).toBe("concurrent_claim_detected");
    expect(result?.conflictingLease?.id).toBe("other-lease");
    expect(result?.reasoning).toContain("OtherAgent");
  });

  it("detects a double-claim by our agent", () => {
    const preBeat = makeBeat("b", { state: "ready_for_implementation" });
    const postBeat = makeBeat("b", {
      state: "implementation",
      steps: [
        { id: "step-1", step: "implementation", lease_id: "lease-A" },
        { id: "step-2", step: "implementation", lease_id: "lease-A" },
      ],
    });
    const result = classifyTurnFailure(
      makePreSnapshot(preBeat, [makeLease("lease-A", "lease_ready")]),
      makePostSnapshot(postBeat, [makeLease("lease-A", "lease_ready")]),
    );
    expect(result?.category).toBe("our_agent_double_claim_suspected");
    expect(result?.reasoning).toContain("2 new action steps");
  });

  it("detects a kno half-transition when claim exited non-zero", () => {
    const preBeat = makeBeat("b", { state: "ready_for_implementation" });
    const postBeat = makeBeat("b", {
      state: "implementation",
      steps: [
        { id: "step-1", step: "implementation", lease_id: "lease-A" },
      ],
    });
    const result = classifyTurnFailure(
      makePreSnapshot(preBeat, [makeLease("lease-A", "lease_ready")]),
      makePostSnapshot(postBeat, [makeLease("lease-A", "lease_ready")]),
      { agentClaimExitedNonZero: true },
    );
    expect(result?.category).toBe("kno_half_transition_suspected");
  });

  it("does NOT flag half-transition when agent claim exited cleanly", () => {
    const preBeat = makeBeat("b", { state: "ready_for_implementation" });
    const postBeat = makeBeat("b", {
      state: "implementation",
      steps: [
        { id: "step-1", step: "implementation", lease_id: "lease-A" },
      ],
    });
    const result = classifyTurnFailure(
      makePreSnapshot(preBeat, [makeLease("lease-A", "lease_ready")]),
      makePostSnapshot(postBeat, [makeLease("lease-A", "lease_ready")]),
    );
    // No concurrent / no double / no half-trans signal — falls
    // through to unknown_state_change because state moved.
    expect(result?.category).toBe("unknown_state_change");
  });

  it("detects an unexpected lease termination", () => {
    const preBeat = makeBeat("b", { state: "ready_for_implementation" });
    const postBeat = makeBeat("b", { state: "ready_for_implementation" });
    const result = classifyTurnFailure(
      makePreSnapshot(preBeat, [makeLease("lease-A", "lease_ready")]),
      makePostSnapshot(postBeat, [makeLease("lease-A", "lease_terminated")]),
      { foolerInitiatedLeaseTerminate: false },
    );
    expect(result?.category).toBe("lease_terminated_unexpectedly");
  });

  it("respects foolerInitiatedLeaseTerminate signal", () => {
    const preBeat = makeBeat("b", { state: "ready_for_implementation" });
    const postBeat = makeBeat("b", { state: "ready_for_implementation" });
    const result = classifyTurnFailure(
      makePreSnapshot(preBeat, [makeLease("lease-A", "lease_ready")]),
      makePostSnapshot(postBeat, [makeLease("lease-A", "lease_terminated")]),
      { foolerInitiatedLeaseTerminate: true },
    );
    // We initiated it, so this is normal; no banner.
    expect(result).toBeNull();
  });

  it("falls back to unknown_state_change when something changed but no rule fits", () => {
    const preBeat = makeBeat("b", { state: "ready_for_implementation" });
    const postBeat = makeBeat("b", { state: "ready_for_review" });
    const result = classifyTurnFailure(
      makePreSnapshot(preBeat, []),
      makePostSnapshot(postBeat, []),
    );
    expect(result?.category).toBe("unknown_state_change");
  });
});

// ── buildForensicBannerBody ────────────────────────────────────

describe("buildForensicBannerBody", () => {
  it("includes the FOOLERY DISPATCH FORENSIC marker and category", () => {
    const body = buildForensicBannerBody({
      category: "concurrent_claim_detected",
      beatId: "maestro-ca91",
      sessionId: "ses-1",
      leaseId: "lease-A",
      iteration: 3,
      preSnapshotPath: "/p/pre.json",
      postSnapshotPath: "/p/post.json",
      reasoning: "another agent took the beat",
    });
    expect(body).toContain(DISPATCH_FORENSIC_MARKER);
    expect(body).toContain("concurrent_claim_detected");
    expect(body).toContain("maestro-ca91");
    expect(body).toContain("lease-A");
    expect(body).toContain("iteration    = 3");
    expect(body).toContain("/p/pre.json");
    expect(body).toContain("/p/post.json");
    expect(body).toContain("another agent took the beat");
  });
});

// ── runPostTurnForensics ────────────────────────────────────────

describe("runPostTurnForensics", () => {
  it("emits banner + audit event on classified failure", async () => {
    const auditCalls: Array<{
      event: string;
      payload: Record<string, unknown>;
    }> = [];
    const sessionBanners: string[] = [];
    const preBeat = makeBeat("b", { state: "ready_for_implementation" });
    const postBeat = makeBeat("b", {
      state: "implementation",
      steps: [{
        id: "s",
        step: "implementation",
        lease_id: "other-lease",
        agent_name: "OtherAgent",
      }],
    });

    const result = await runPostTurnForensics(
      makePreSnapshot(preBeat, [makeLease("lease-A", "lease_ready")]),
      makePostSnapshot(postBeat, [
        makeLease("lease-A", "lease_ready"),
        makeLease("other-lease", "lease_terminated", { name: "OtherAgent" }),
      ]),
      "/p/pre.json",
      "/p/post.json",
      {},
      {
        logAudit: (event, payload) => {
          auditCalls.push({ event, payload });
        },
        pushBannerToSession: (banner) => {
          sessionBanners.push(banner);
        },
      },
    );

    expect(result.classified).toBe(true);
    expect(result.bannerBody).toContain(DISPATCH_FORENSIC_MARKER);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].event).toBe("dispatch_forensic_classified");
    expect(auditCalls[0].payload.category).toBe(
      "concurrent_claim_detected",
    );
    expect(auditCalls[0].payload.conflictingLeaseId).toBe("other-lease");
    expect(sessionBanners).toHaveLength(1);
    expect(sessionBanners[0]).toContain(DISPATCH_FORENSIC_MARKER);
  });

  it("returns classified=false when nothing changed", async () => {
    const beat = makeBeat("b", { state: "ready_for_implementation" });
    const lease = makeLease("lease-A", "lease_ready");
    const result = await runPostTurnForensics(
      makePreSnapshot(beat, [lease]),
      makePostSnapshot(beat, [lease]),
      "/p/pre.json",
      "/p/post.json",
      {},
      { logAudit: () => undefined, pushBannerToSession: () => undefined },
    );
    expect(result.classified).toBe(false);
  });
});
