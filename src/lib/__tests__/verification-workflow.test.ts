import { describe, expect, it, beforeEach } from "vitest";
import type { Bead } from "@/lib/types";
import {
  extractCommitLabel,
  buildCommitLabel,
  extractAttemptNumber,
  buildAttemptLabel,
  findAttemptLabel,
  findCommitLabelRaw,
  hasTransitionLock,
  isInVerification,
  isInRetry,
  isVerificationEligibleAction,
  getVerificationEligibleActions,
  computeEntryLabels,
  computePassLabels,
  computeRetryLabels,
  buildVerifierPrompt,
  parseVerifierResult,
  acquireVerificationLock,
  releaseVerificationLock,
  hasVerificationLock,
  _clearAllLocks,
  LABEL_TRANSITION_VERIFICATION,
  LABEL_STAGE_VERIFICATION,
  LABEL_STAGE_RETRY,
} from "@/lib/verification-workflow";

function makeBead(overrides: Partial<Bead> = {}): Bead {
  return {
    id: "foolery-test",
    title: "Test Bead",
    status: "in_progress",
    priority: 2,
    type: "task",
    labels: [],
    created: "2026-02-20T00:00:00.000Z",
    updated: "2026-02-20T00:00:00.000Z",
    ...overrides,
  };
}

// ── Label helpers ───────────────────────────────────────────

describe("extractCommitLabel", () => {
  it("extracts SHA from commit: label", () => {
    expect(extractCommitLabel(["commit:abc123f"])).toBe("abc123f");
  });

  it("returns null when no commit label", () => {
    expect(extractCommitLabel(["stage:verification"])).toBeNull();
  });

  it("handles empty labels", () => {
    expect(extractCommitLabel([])).toBeNull();
  });

  it("skips empty commit label", () => {
    expect(extractCommitLabel(["commit:"])).toBeNull();
  });
});

describe("buildCommitLabel", () => {
  it("builds label from SHA", () => {
    expect(buildCommitLabel("abc123f")).toBe("commit:abc123f");
  });
});

describe("extractAttemptNumber", () => {
  it("extracts attempt number", () => {
    expect(extractAttemptNumber(["attempt:3"])).toBe(3);
  });

  it("returns 0 when no attempt label", () => {
    expect(extractAttemptNumber(["stage:retry"])).toBe(0);
  });

  it("returns 0 for empty labels", () => {
    expect(extractAttemptNumber([])).toBe(0);
  });
});

describe("buildAttemptLabel", () => {
  it("builds label from number", () => {
    expect(buildAttemptLabel(5)).toBe("attempt:5");
  });
});

describe("findAttemptLabel / findCommitLabelRaw", () => {
  it("finds attempt label", () => {
    expect(findAttemptLabel(["attempt:2", "foo"])).toBe("attempt:2");
  });

  it("returns null when missing", () => {
    expect(findAttemptLabel(["foo"])).toBeNull();
  });

  it("finds commit label", () => {
    expect(findCommitLabelRaw(["commit:abc", "foo"])).toBe("commit:abc");
  });
});

// ── Bead state checks ───────────────────────────────────────

describe("bead state checks", () => {
  it("hasTransitionLock detects lock", () => {
    expect(hasTransitionLock(makeBead({ labels: [LABEL_TRANSITION_VERIFICATION] }))).toBe(true);
    expect(hasTransitionLock(makeBead({ labels: [] }))).toBe(false);
  });

  it("isInVerification detects stage", () => {
    expect(isInVerification(makeBead({ labels: [LABEL_STAGE_VERIFICATION] }))).toBe(true);
    expect(isInVerification(makeBead({ labels: [] }))).toBe(false);
  });

  it("isInRetry detects retry", () => {
    expect(isInRetry(makeBead({ labels: [LABEL_STAGE_RETRY] }))).toBe(true);
    expect(isInRetry(makeBead({ labels: [] }))).toBe(false);
  });
});

// ── Eligible actions (xmg8.1.2) ─────────────────────────────

describe("isVerificationEligibleAction", () => {
  it("marks take and scene as eligible", () => {
    expect(isVerificationEligibleAction("take")).toBe(true);
    expect(isVerificationEligibleAction("scene")).toBe(true);
  });

  it("excludes non-code actions", () => {
    expect(isVerificationEligibleAction("breakdown")).toBe(false);
    expect(isVerificationEligibleAction("direct")).toBe(false);
  });

  it("returns eligible actions list", () => {
    const actions = getVerificationEligibleActions();
    expect(actions).toContain("take");
    expect(actions).toContain("scene");
    expect(actions).not.toContain("breakdown");
  });
});

// ── State machine transitions (xmg8.1.1) ───────────────────

describe("computeEntryLabels", () => {
  it("adds transition and stage labels on fresh entry", () => {
    const result = computeEntryLabels([]);
    expect(result.add).toContain(LABEL_TRANSITION_VERIFICATION);
    expect(result.add).toContain(LABEL_STAGE_VERIFICATION);
    expect(result.remove).toEqual([]);
  });

  it("is idempotent when already in transition", () => {
    const result = computeEntryLabels([LABEL_TRANSITION_VERIFICATION, LABEL_STAGE_VERIFICATION]);
    expect(result.add).toEqual([]);
    expect(result.remove).toEqual([]);
  });

  it("removes stage:retry when re-entering verification", () => {
    const result = computeEntryLabels([LABEL_STAGE_RETRY]);
    expect(result.add).toContain(LABEL_TRANSITION_VERIFICATION);
    expect(result.add).toContain(LABEL_STAGE_VERIFICATION);
    expect(result.remove).toContain(LABEL_STAGE_RETRY);
  });

  it("does not re-add stage:verification if already present", () => {
    const result = computeEntryLabels([LABEL_STAGE_VERIFICATION]);
    expect(result.add).toContain(LABEL_TRANSITION_VERIFICATION);
    expect(result.add).not.toContain(LABEL_STAGE_VERIFICATION);
  });
});

describe("computePassLabels", () => {
  it("removes transition and stage labels", () => {
    const result = computePassLabels([LABEL_TRANSITION_VERIFICATION, LABEL_STAGE_VERIFICATION]);
    expect(result.remove).toContain(LABEL_TRANSITION_VERIFICATION);
    expect(result.remove).toContain(LABEL_STAGE_VERIFICATION);
    expect(result.add).toEqual([]);
  });

  it("handles partial label state gracefully", () => {
    const result = computePassLabels([LABEL_STAGE_VERIFICATION]);
    expect(result.remove).toEqual([LABEL_STAGE_VERIFICATION]);
    expect(result.add).toEqual([]);
  });
});

describe("computeRetryLabels", () => {
  it("transitions to retry with incremented attempt", () => {
    const result = computeRetryLabels([
      LABEL_TRANSITION_VERIFICATION,
      LABEL_STAGE_VERIFICATION,
      "attempt:2",
    ]);
    expect(result.remove).toContain(LABEL_TRANSITION_VERIFICATION);
    expect(result.remove).toContain(LABEL_STAGE_VERIFICATION);
    expect(result.remove).toContain("attempt:2");
    expect(result.add).toContain(LABEL_STAGE_RETRY);
    expect(result.add).toContain("attempt:3");
  });

  it("starts at attempt:1 when no prior attempts", () => {
    const result = computeRetryLabels([LABEL_TRANSITION_VERIFICATION, LABEL_STAGE_VERIFICATION]);
    expect(result.add).toContain("attempt:1");
    expect(result.add).toContain(LABEL_STAGE_RETRY);
  });

  it("removes existing commit label on retry", () => {
    const result = computeRetryLabels([
      LABEL_TRANSITION_VERIFICATION,
      LABEL_STAGE_VERIFICATION,
      "commit:abc123",
    ]);
    expect(result.remove).toContain("commit:abc123");
    expect(result.add).toContain(LABEL_STAGE_RETRY);
    expect(result.add).toContain("attempt:1");
  });

  it("handles retry with both commit and attempt labels", () => {
    const result = computeRetryLabels([
      LABEL_TRANSITION_VERIFICATION,
      LABEL_STAGE_VERIFICATION,
      "commit:def456",
      "attempt:2",
    ]);
    expect(result.remove).toContain("commit:def456");
    expect(result.remove).toContain("attempt:2");
    expect(result.add).toContain("attempt:3");
    expect(result.add).toContain(LABEL_STAGE_RETRY);
  });
});

// ── Verifier prompt ─────────────────────────────────────────

describe("buildVerifierPrompt", () => {
  it("includes bead and commit info", () => {
    const prompt = buildVerifierPrompt({
      beadId: "foolery-abc",
      title: "Fix login bug",
      commitSha: "def456",
    });
    expect(prompt).toContain("foolery-abc");
    expect(prompt).toContain("Fix login bug");
    expect(prompt).toContain("def456");
    expect(prompt).toContain("VERIFICATION_RESULT");
  });

  it("includes REJECTION_SUMMARY instructions for failure cases", () => {
    const prompt = buildVerifierPrompt({
      beadId: "foolery-abc",
      title: "Fix login bug",
      commitSha: "def456",
    });
    expect(prompt).toContain("REJECTION_SUMMARY:");
    expect(prompt).toContain("VERIFICATION_RESULT");
  });

  it("includes optional fields when provided", () => {
    const prompt = buildVerifierPrompt({
      beadId: "foolery-abc",
      title: "Fix login bug",
      commitSha: "def456",
      description: "The login form breaks",
      acceptance: "Login works on all browsers",
      notes: "Check Safari specifically",
    });
    expect(prompt).toContain("The login form breaks");
    expect(prompt).toContain("Login works on all browsers");
    expect(prompt).toContain("Check Safari specifically");
  });

  it("renders knots commands when memoryManagerType=knots", () => {
    const prompt = buildVerifierPrompt({
      beadId: "foolery-abc",
      title: "Fix login bug",
      commitSha: "def456",
      memoryManagerType: "knots",
    });

    expect(prompt).toContain(
      'knots update "foolery-abc" --remove-tag stage:verification --remove-tag transition:verification --add-tag stage:retry'
    );
    expect(prompt).toContain(
      'knots update "foolery-abc" --remove-tag stage:verification --remove-tag transition:verification --status shipped --force'
    );
    expect(prompt).not.toContain("bd label remove");
  });
});

// ── Verifier result parser ──────────────────────────────────

describe("parseVerifierResult", () => {
  it("parses pass result", () => {
    expect(parseVerifierResult("Some output...\nVERIFICATION_RESULT:pass\n")).toBe("pass");
  });

  it("parses fail-requirements result", () => {
    expect(parseVerifierResult("VERIFICATION_RESULT:fail-requirements")).toBe("fail-requirements");
  });

  it("parses fail-bugs result", () => {
    expect(parseVerifierResult("VERIFICATION_RESULT:fail-bugs")).toBe("fail-bugs");
  });

  it("returns null for no marker", () => {
    expect(parseVerifierResult("All done, looks good!")).toBeNull();
  });
});

// ── Dedup locks (xmg8.2.5) ─────────────────────────────────

describe("verification locks", () => {
  beforeEach(() => {
    _clearAllLocks();
  });

  it("acquires and releases lock", () => {
    expect(acquireVerificationLock("bead-1")).toBe(true);
    expect(hasVerificationLock("bead-1")).toBe(true);
    releaseVerificationLock("bead-1");
    expect(hasVerificationLock("bead-1")).toBe(false);
  });

  it("prevents duplicate acquisition", () => {
    expect(acquireVerificationLock("bead-1")).toBe(true);
    expect(acquireVerificationLock("bead-1")).toBe(false);
  });

  it("allows independent beads to have concurrent locks", () => {
    expect(acquireVerificationLock("bead-1")).toBe(true);
    expect(acquireVerificationLock("bead-2")).toBe(true);
  });
});
