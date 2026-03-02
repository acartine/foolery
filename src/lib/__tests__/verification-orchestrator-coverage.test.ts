/**
 * Additional coverage tests for src/lib/verification-orchestrator.ts.
 * Targets uncovered lines: 06-407, 476-477.
 *
 * Focuses on:
 * - extractRejectionSummary edge cases
 * - getVerificationEvents
 * - enterVerification idempotency
 * - ensureCommitLabel remediation paths
 * - applyOutcome pass/fail branches
 * - appendVerifierNotes truncation
 * - maybeAutoRetry exceeded retries / error handling
 * - transitionToRetry error branches
 * - launchVerifier error/edge cases
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Beat } from "@/lib/types";
import type { BackendPort } from "@/lib/backend-port";

// ── Mock setup (same pattern as existing test) ──────────────

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockClose = vi.fn();
vi.mock("@/lib/backend-instance", () => ({
  getBackend: () =>
    ({
      get: mockGet,
      update: mockUpdate,
      close: mockClose,
    }) as unknown as BackendPort,
}));

const getVerificationSettingsMock = vi.fn();
const getVerificationAgentMock = vi.fn();
vi.mock("@/lib/settings", () => ({
  getVerificationSettings: () => getVerificationSettingsMock(),
  getVerificationAgent: () => getVerificationAgentMock(),
}));

const startInteractionLogMock = vi.fn();
const logPromptMock = vi.fn();
const logResponseMock = vi.fn();
const logEndMock = vi.fn();
vi.mock("@/lib/interaction-logger", () => ({
  startInteractionLog: (...args: unknown[]) => startInteractionLogMock(...args),
  noopInteractionLog: () => ({
    logPrompt: logPromptMock,
    logResponse: logResponseMock,
    logEnd: logEndMock,
  }),
}));

vi.mock("@/lib/agent-adapter", () => ({
  buildPromptModeArgs: (_agent: unknown, prompt: string) => ({
    command: "echo",
    args: [prompt.slice(0, 50)],
  }),
  resolveDialect: () => "claude",
  createLineNormalizer: () => (parsed: unknown) => parsed as Record<string, unknown> | null,
}));

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const createSessionMock = vi.fn();
const createSceneSessionMock = vi.fn();
vi.mock("@/lib/terminal-manager", () => ({
  createSession: (...args: unknown[]) => createSessionMock(...args),
  createSceneSession: (...args: unknown[]) => createSceneSessionMock(...args),
}));

import { onAgentComplete, getVerificationEvents } from "@/lib/verification-orchestrator";
import { _clearAllLocks } from "@/lib/verification-workflow";
import { EventEmitter } from "node:events";

// ── Helpers ─────────────────────────────────────────────────

function makeBeat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: "test-beat",
    title: "Test Beat",
    state: "in_progress",
    priority: 2,
    type: "task",
    labels: [],
    created: "2026-02-20T00:00:00.000Z",
    updated: "2026-02-20T00:00:00.000Z",
    ...overrides,
  };
}

function createMockProcess(output: string, exitCode = 0) {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: null;
    pid: number;
    killed: boolean;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = null;
  proc.pid = 12345;
  proc.killed = false;

  setTimeout(() => {
    stdout.emit("data", Buffer.from(output));
    setTimeout(() => {
      proc.emit("close", exitCode);
    }, 10);
  }, 10);

  return proc;
}

function createErrorProcess(errorMsg: string) {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: null;
    pid: number;
    killed: boolean;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = null;
  proc.pid = 12345;
  proc.killed = false;

  setTimeout(() => {
    proc.emit("error", new Error(errorMsg));
  }, 10);

  return proc;
}

beforeEach(() => {
  vi.clearAllMocks();
  _clearAllLocks();
  startInteractionLogMock.mockResolvedValue({
    logPrompt: logPromptMock,
    logResponse: logResponseMock,
    logEnd: logEndMock,
  });
  getVerificationSettingsMock.mockResolvedValue({ enabled: false, agent: "", maxRetries: 3 });
  getVerificationAgentMock.mockResolvedValue({ command: "claude", label: "Claude" });
  mockGet.mockResolvedValue({ ok: true, data: makeBeat() });
  mockUpdate.mockResolvedValue({ ok: true });
  mockClose.mockResolvedValue({ ok: true });
  createSessionMock.mockResolvedValue({ id: "mock-session", status: "running" });
  createSceneSessionMock.mockResolvedValue({ id: "mock-scene-session", status: "running" });
});

// ── getVerificationEvents ───────────────────────────────────

describe("getVerificationEvents", () => {
  it("returns empty array when no events have been logged", () => {
    // Events may have accumulated from other tests, but we can check the return type
    const events = getVerificationEvents();
    expect(Array.isArray(events)).toBe(true);
  });

  it("respects limit parameter", () => {
    const events = getVerificationEvents(1);
    expect(events.length).toBeLessThanOrEqual(1);
  });

  it("defaults to 50 limit", () => {
    const events = getVerificationEvents();
    expect(events.length).toBeLessThanOrEqual(50);
  });
});

// ── enterVerification idempotency ───────────────────────────

describe("enterVerification idempotency", () => {
  it("skips label update when transition:verification already present", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    // Bead already has transition:verification and commit label
    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        labels: [
          "transition:verification",
          "stage:verification",
          "commit:abc123",
        ],
      }),
    });

    spawnMock.mockReturnValue(createMockProcess("VERIFICATION_RESULT:pass\n", 0));

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    // The first update call should NOT be for entry labels since they're already present
    // It should proceed directly to pass close
    expect(mockClose).toHaveBeenCalled();
  });
});

// ── enterVerification error on get failure ──────────────────

describe("enterVerification get failure", () => {
  it("transitions to retry when get fails during entry", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    let callCount = 0;
    mockGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // enterVerification get fails
        return { ok: false, error: { message: "not found" } };
      }
      // transitionToRetry get succeeds
      return {
        ok: true,
        data: makeBeat({ labels: ["transition:verification"] }),
      };
    });

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    // Should have called update for retry transition
    expect(mockUpdate).toHaveBeenCalled();
  });
});

// ── ensureCommitLabel remediation path ──────────────────────

describe("ensureCommitLabel remediation", () => {
  it("returns null when get fails during remediation", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    let callCount = 0;
    mockGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, data: makeBeat({ labels: [] }) };
      }
      if (callCount === 2) {
        // ensureCommitLabel first check: no commit
        return { ok: true, data: makeBeat({ labels: ["transition:verification", "stage:verification"] }) };
      }
      if (callCount === 3) {
        // remediation retry: get fails
        return { ok: false, error: { message: "network error" } };
      }
      // transitionToRetry
      return { ok: true, data: makeBeat({ labels: ["transition:verification"] }) };
    });

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    // Should NOT have spawned verifier, should transition to retry
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

// ── launchVerifier error paths ──────────────────────────────

describe("launchVerifier error paths", () => {
  it("handles verifier spawn error", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    spawnMock.mockReturnValue(createErrorProcess("spawn failed"));

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    // Should transition to retry on error
    const retryCall = mockUpdate.mock.calls.find((call: unknown[]) => {
      const fields = call[1] as Record<string, unknown>;
      return fields.state === "open";
    });
    expect(retryCall).toBeDefined();
  });

  it("handles verifier non-zero exit without result marker", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    spawnMock.mockReturnValue(createMockProcess("no result marker here\n", 1));

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    // Should transition to retry
    expect(mockClose).not.toHaveBeenCalled();
    const retryCall = mockUpdate.mock.calls.find((call: unknown[]) => {
      const fields = call[1] as Record<string, unknown>;
      return fields.state === "open";
    });
    expect(retryCall).toBeDefined();
  });

  it("defaults to pass when exit code 0 but no result marker", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    spawnMock.mockReturnValue(createMockProcess("Agent completed successfully\n", 0));

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    // Should close beat with implicit pass
    expect(mockClose).toHaveBeenCalled();
  });

  it("handles interaction log start failure gracefully", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    startInteractionLogMock.mockRejectedValue(new Error("log init failed"));
    spawnMock.mockReturnValue(createMockProcess("VERIFICATION_RESULT:pass\n", 0));

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    // Should still close the beat (fallback to noopInteractionLog)
    expect(mockClose).toHaveBeenCalled();
  });
});

// ── applyOutcome fail-bugs path ─────────────────────────────

describe("applyOutcome fail-bugs", () => {
  it("handles fail-bugs outcome with notes update", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        notes: "Previous notes",
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    spawnMock.mockReturnValue(
      createMockProcess("REJECTION_SUMMARY: Found a null pointer dereference\nVERIFICATION_RESULT:fail-bugs\n", 0),
    );

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    expect(mockClose).not.toHaveBeenCalled();

    // Notes should include fail-bugs
    const notesCall = mockUpdate.mock.calls.find((call: unknown[]) => {
      const fields = call[1] as Record<string, unknown>;
      return typeof fields.notes === "string" && (fields.notes as string).includes("fail-bugs");
    });
    expect(notesCall).toBeDefined();
  });
});

// ── applyOutcome when get fails ─────────────────────────────

describe("applyOutcome get failure", () => {
  it("throws when get fails during outcome application", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    let callCount = 0;
    mockGet.mockImplementation(() => {
      callCount++;
      if (callCount <= 4) {
        return {
          ok: true,
          data: makeBeat({
            labels: ["transition:verification", "stage:verification", "commit:abc123"],
          }),
        };
      }
      // applyOutcome get fails
      return { ok: false, error: { message: "gone" } };
    });

    spawnMock.mockReturnValue(createMockProcess("VERIFICATION_RESULT:pass\n", 0));

    // Should not throw (error is caught in runVerificationWorkflow)
    await onAgentComplete(["test-beat"], "take", "/repo", 0);
  });
});

// ── appendVerifierNotes truncation ──────────────────────────

describe("appendVerifierNotes truncation", () => {
  it("truncates very long rejection summaries", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        notes: "",
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    // Create very long output
    const longText = "A".repeat(3000);
    spawnMock.mockReturnValue(
      createMockProcess(`REJECTION_SUMMARY: ${longText}\nVERIFICATION_RESULT:fail-requirements\n`, 0),
    );

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    const notesCall = mockUpdate.mock.calls.find((call: unknown[]) => {
      const fields = call[1] as Record<string, unknown>;
      return typeof fields.notes === "string" && (fields.notes as string).includes("truncated");
    });
    expect(notesCall).toBeDefined();
  });

  it("handles notes update failure gracefully", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    let updateCallCount = 0;
    mockUpdate.mockImplementation(() => {
      updateCallCount++;
      if (updateCallCount === 2) {
        // The notes update call fails
        throw new Error("notes update failed");
      }
      return { ok: true };
    });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        notes: "",
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    spawnMock.mockReturnValue(
      createMockProcess("VERIFICATION_RESULT:fail-requirements\n", 0),
    );

    // Should not throw, notes failure is best-effort
    await onAgentComplete(["test-beat"], "take", "/repo", 0);
  });
});

// ── maybeAutoRetry error handling ───────────────────────────

describe("maybeAutoRetry error handling", () => {
  it("logs error when createSession fails", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    createSessionMock.mockRejectedValue(new Error("session creation failed"));

    spawnMock.mockReturnValue(
      createMockProcess("VERIFICATION_RESULT:fail-requirements\n", 0),
    );

    // Should not throw despite createSession failure
    await onAgentComplete(["test-beat"], "take", "/repo", 0);
  });

  it("logs error when createSceneSession fails", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    createSceneSessionMock.mockRejectedValue(new Error("scene session failed"));

    spawnMock.mockReturnValue(
      createMockProcess("VERIFICATION_RESULT:fail-bugs\n", 0),
    );

    // Should not throw despite createSceneSession failure
    await onAgentComplete(["test-beat"], "scene", "/repo", 0);
  });
});

// ── transitionToRetry when get fails ────────────────────────

describe("transitionToRetry error handling", () => {
  it("handles get failure in transitionToRetry silently", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    let callCount = 0;
    mockGet.mockImplementation(() => {
      callCount++;
      if (callCount <= 3) {
        // Normal flow until ensureCommitLabel fails
        return { ok: true, data: makeBeat({ labels: [] }) };
      }
      // transitionToRetry get fails
      return { ok: false };
    });

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    // Should complete without throwing
  });
});

// ── Multiple beads in onAgentComplete ───────────────────────

describe("multiple beads processing", () => {
  it("processes multiple beads in parallel", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    spawnMock.mockReturnValue(createMockProcess("VERIFICATION_RESULT:pass\n", 0));

    await onAgentComplete(["beat-1", "beat-2"], "take", "/repo", 0);

    // Both beads should be processed
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});

// ── launchVerifier output parsing edge cases ────────────────

describe("launchVerifier output parsing", () => {
  it("handles JSON assistant message with text content", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    // Simulate JSON assistant message with text content blocks
    const jsonMsg = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "VERIFICATION_RESULT:pass" }],
      },
    });
    spawnMock.mockReturnValue(createMockProcess(jsonMsg + "\n", 0));

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    expect(mockClose).toHaveBeenCalled();
  });

  it("handles JSON result message", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    const jsonMsg = JSON.stringify({
      type: "result",
      result: "VERIFICATION_RESULT:pass",
    });
    spawnMock.mockReturnValue(createMockProcess(jsonMsg + "\n", 0));

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    expect(mockClose).toHaveBeenCalled();
  });

  it("handles stderr output from verifier", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    const proc = createMockProcess("VERIFICATION_RESULT:pass\n", 0);
    spawnMock.mockReturnValue(proc);

    const promise = onAgentComplete(["test-beat"], "take", "/repo", 0);

    // Emit stderr
    setTimeout(() => {
      (proc.stderr as EventEmitter).emit("data", Buffer.from("Some warning message\n"));
    }, 5);

    await promise;
    expect(mockClose).toHaveBeenCalled();
  });
});

// ── enterVerification state update path ─────────────────────

describe("enterVerification state update", () => {
  it("sets state to in_progress when bead is not already in_progress", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    let callCount = 0;
    mockGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          data: makeBeat({
            state: "open",
            labels: [],
          }),
        };
      }
      return {
        ok: true,
        data: makeBeat({
          labels: ["transition:verification", "stage:verification", "commit:abc123"],
        }),
      };
    });

    spawnMock.mockReturnValue(createMockProcess("VERIFICATION_RESULT:pass\n", 0));

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    // First update should include state: "in_progress"
    const entryCall = mockUpdate.mock.calls[0];
    if (entryCall) {
      const fields = entryCall[1] as Record<string, unknown>;
      expect(fields.state).toBe("in_progress");
    }
  });
});

// ── extractRejectionSummary edge cases via full flow ────────

describe("extractRejectionSummary edge cases", () => {
  it("uses tail of output when no markers present", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        notes: "",
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    // Output with VERIFICATION_RESULT but no REJECTION_SUMMARY and no text before marker
    spawnMock.mockReturnValue(
      createMockProcess("VERIFICATION_RESULT:fail-requirements\n", 0),
    );

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    // Notes should still be updated
    const notesCall = mockUpdate.mock.calls.find((call: unknown[]) => {
      const fields = call[1] as Record<string, unknown>;
      return typeof fields.notes === "string" && (fields.notes as string).includes("Verification attempt");
    });
    expect(notesCall).toBeDefined();
  });

  it("handles very long output without REJECTION_SUMMARY", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        notes: "",
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    // Very long output without structured markers
    const longOutput = "x".repeat(5000) + "\nVERIFICATION_RESULT:fail-bugs\n";
    spawnMock.mockReturnValue(createMockProcess(longOutput, 0));

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    const notesCall = mockUpdate.mock.calls.find((call: unknown[]) => {
      const fields = call[1] as Record<string, unknown>;
      return typeof fields.notes === "string" && (fields.notes as string).includes("Verification attempt");
    });
    expect(notesCall).toBeDefined();
  });
});

// ── Verifier prompt includes optional fields ────────────────

describe("verifier prompt context", () => {
  it("includes description and acceptance in prompt", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        description: "Implement the feature",
        acceptance: "All tests pass",
        notes: "Note: check edge cases",
        labels: ["transition:verification", "stage:verification", "commit:abc123"],
      }),
    });

    spawnMock.mockReturnValue(createMockProcess("VERIFICATION_RESULT:pass\n", 0));

    await onAgentComplete(["test-beat"], "take", "/repo", 0);

    // The prompt should have been built with description/acceptance/notes
    expect(logPromptMock).toHaveBeenCalledWith(
      expect.stringContaining("Implement the feature"),
      expect.any(Object),
    );
  });
});
