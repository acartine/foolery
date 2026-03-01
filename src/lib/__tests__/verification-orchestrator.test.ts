import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Beat } from "@/lib/types";
import type { BackendPort } from "@/lib/backend-port";

// ── Mock setup ──────────────────────────────────────────────

// Mock backend-instance (BackendPort abstraction)
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

// Mock settings
const getVerificationSettingsMock = vi.fn();
const getVerificationAgentMock = vi.fn();
vi.mock("@/lib/settings", () => ({
  getVerificationSettings: () => getVerificationSettingsMock(),
  getVerificationAgent: () => getVerificationAgentMock(),
}));

// Mock interaction logger
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

// Mock agent-adapter (prevent real process spawning)
vi.mock("@/lib/agent-adapter", () => ({
  buildPromptModeArgs: (_agent: unknown, prompt: string) => ({
    command: "echo",
    args: [prompt.slice(0, 50)],
  }),
  resolveDialect: () => "claude",
  createLineNormalizer: () => (parsed: unknown) => parsed as Record<string, unknown> | null,
}));

// Mock child_process
const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Mock terminal-manager (dynamically imported for auto-retry)
const createSessionMock = vi.fn();
const createSceneSessionMock = vi.fn();
vi.mock("@/lib/terminal-manager", () => ({
  createSession: (...args: unknown[]) => createSessionMock(...args),
  createSceneSession: (...args: unknown[]) => createSceneSessionMock(...args),
}));

import { onAgentComplete } from "@/lib/verification-orchestrator";
import {
  _clearAllLocks,
  computeEntryLabels,
  computePassLabels,
  computeRetryLabels,
} from "@/lib/verification-workflow";
import { EventEmitter } from "node:events";

function makeBeat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: "foolery-test",
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

  // Schedule output emission
  setTimeout(() => {
    stdout.emit("data", Buffer.from(output));
    setTimeout(() => {
      proc.emit("close", exitCode);
    }, 10);
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

  // Default: verification disabled
  getVerificationSettingsMock.mockResolvedValue({ enabled: false, agent: "", maxRetries: 3 });
  getVerificationAgentMock.mockResolvedValue({ command: "claude" });
  mockGet.mockResolvedValue({ ok: true, data: makeBeat() });
  mockUpdate.mockResolvedValue({ ok: true });
  mockClose.mockResolvedValue({ ok: true });
  createSessionMock.mockResolvedValue({ id: "mock-session", status: "running" });
  createSceneSessionMock.mockResolvedValue({ id: "mock-scene-session", status: "running" });
});

// ── Test: disabled verification ─────────────────────────────

describe("onAgentComplete", () => {
  it("does nothing when verification is disabled", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: false, agent: "", maxRetries: 3 });
    await onAgentComplete(["foolery-test"], "take", "/repo", 0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does nothing for non-eligible actions", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });
    await onAgentComplete(["foolery-test"], "breakdown", "/repo", 0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does nothing for failed agent exit", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });
    await onAgentComplete(["foolery-test"], "take", "/repo", 1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ── Test: pass path (xmg8.4.1) ─────────────────────────────

describe("pass path", () => {
  it("enters verification, launches verifier, and closes beat on pass", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    // First show: fresh bead (no labels)
    // Second show: after entry labels applied (for commit check)
    // Third show: after commit check (with commit label)
    // Fourth show: for verifier prompt build
    // Fifth show: for outcome application
    let showCallCount = 0;
    mockGet.mockImplementation(() => {
      showCallCount++;
      if (showCallCount <= 1) {
        return { ok: true, data: makeBeat({ labels: [] }) };
      }
      // After first update, bead has transition + stage + commit labels
      return {
        ok: true,
        data: makeBeat({
          labels: [
            "transition:verification",
            "stage:verification",
            "commit:abc123",
          ],
        }),
      };
    });

    // Mock the verifier process
    spawnMock.mockReturnValue(
      createMockProcess("VERIFICATION_RESULT:pass\n", 0)
    );

    await onAgentComplete(["foolery-test"], "take", "/repo", 0);

    // Should have called updateBead to set entry labels
    expect(mockUpdate).toHaveBeenCalled();

    // Should have called closeBead for the pass outcome
    expect(mockClose).toHaveBeenCalledWith(
      "foolery-test",
      "Auto-verification passed",
      "/repo"
    );

    expect(startInteractionLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionType: "verification",
        repoPath: "/repo",
        beatIds: ["foolery-test"],
      }),
    );
    expect(logPromptMock).toHaveBeenCalledWith(
      expect.any(String),
      { source: "verification_review" },
    );
    expect(logResponseMock).toHaveBeenCalledWith("VERIFICATION_RESULT:pass");
    expect(logEndMock).toHaveBeenCalledWith(0, "completed");
  });
});

// ── Test: retry path (xmg8.4.2) ────────────────────────────

describe("retry paths", () => {
  it("transitions to retry when no commit label found", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    // Always return bead with no commit label
    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        labels: ["transition:verification", "stage:verification"],
      }),
    });

    await onAgentComplete(["foolery-test"], "take", "/repo", 0);

    // Should have called updateBead to transition to retry
    const retryCall = mockUpdate.mock.calls.find(
      (call: unknown[]) => {
        const fields = call[1] as Record<string, unknown>;
        return fields.state === "open" && Array.isArray(fields.labels) && (fields.labels as string[]).includes("stage:retry");
      }
    );
    expect(retryCall).toBeDefined();
  });

  it("transitions to retry on verifier fail-requirements", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

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

    spawnMock.mockReturnValue(
      createMockProcess("VERIFICATION_RESULT:fail-requirements\n", 0)
    );

    await onAgentComplete(["foolery-test"], "take", "/repo", 0);

    // Should NOT have called closeBead
    expect(mockClose).not.toHaveBeenCalled();

    // Should have called updateBead with retry labels
    const retryCall = mockUpdate.mock.calls.find(
      (call: unknown[]) => {
        const fields = call[1] as Record<string, unknown>;
        return fields.state === "open";
      }
    );
    expect(retryCall).toBeDefined();
  });
});

// ── Test: idempotency (xmg8.4.3) ───────────────────────────

describe("idempotency", () => {
  it("deduplicates concurrent verification requests", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    // Bead with commit label ready to go
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

    spawnMock.mockReturnValue(
      createMockProcess("VERIFICATION_RESULT:pass\n", 0)
    );

    // Launch two concurrent verifications for the same bead
    const p1 = onAgentComplete(["foolery-test"], "take", "/repo", 0);
    const p2 = onAgentComplete(["foolery-test"], "take", "/repo", 0);
    await Promise.all([p1, p2]);

    // spawn should only be called once due to dedup lock
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});

// ── Test: edit lock (xmg8.4.4) ─────────────────────────────

describe("edit lock labels", () => {
  it("entry labels include transition:verification", () => {
    const result = computeEntryLabels([]);
    expect(result.add).toContain("transition:verification");
  });

  it("pass labels remove transition:verification", () => {
    const result = computePassLabels(["transition:verification", "stage:verification"]);
    expect(result.remove).toContain("transition:verification");
  });

  it("retry labels remove transition:verification", () => {
    const result = computeRetryLabels(["transition:verification", "stage:verification"]);
    expect(result.remove).toContain("transition:verification");
  });
});

// ── Test: notes update on failure (xmg8.4.5) ───────────────

describe("verifier output capture on failure", () => {
  it("updates beat notes with verifier output on fail-requirements", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        notes: "Existing notes here",
        labels: [
          "transition:verification",
          "stage:verification",
          "commit:abc123",
        ],
      }),
    });

    spawnMock.mockReturnValue(
      createMockProcess("Some analysis here.\nREJECTION_SUMMARY: The login form does not handle OAuth redirects. Update LoginForm.tsx to use dynamic config.\nVERIFICATION_RESULT:fail-requirements\n", 0)
    );

    await onAgentComplete(["foolery-test"], "take", "/repo", 0);

    // Should have updated notes with verifier output
    const notesCall = mockUpdate.mock.calls.find(
      (call: unknown[]) => {
        const fields = call[1] as Record<string, unknown>;
        return typeof fields.notes === "string" && (fields.notes as string).includes("Verification attempt");
      }
    );
    expect(notesCall).toBeDefined();
    const notesFields = notesCall![1] as Record<string, unknown>;
    expect(notesFields.notes).toContain("Existing notes here");
    expect(notesFields.notes).toContain("fail-requirements");
    expect(notesFields.notes).toContain("Verification attempt 1 failed");
    expect(notesFields.notes).toContain("The login form does not handle OAuth redirects");
  });

  it("auto-launches new take session on retry when within maxRetries", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

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

    spawnMock.mockReturnValue(
      createMockProcess("VERIFICATION_RESULT:fail-requirements\n", 0)
    );

    await onAgentComplete(["foolery-test"], "take", "/repo", 0);

    expect(createSessionMock).toHaveBeenCalledWith("foolery-test", "/repo");
  });

  it("auto-launches scene session for scene action on retry", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

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

    spawnMock.mockReturnValue(
      createMockProcess("VERIFICATION_RESULT:fail-bugs\n", 0)
    );

    await onAgentComplete(["foolery-test"], "scene", "/repo", 0);

    expect(createSceneSessionMock).toHaveBeenCalledWith(["foolery-test"], "/repo");
  });

  it("does not auto-retry when maxRetries is 0", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 0 });

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

    spawnMock.mockReturnValue(
      createMockProcess("VERIFICATION_RESULT:fail-requirements\n", 0)
    );

    await onAgentComplete(["foolery-test"], "take", "/repo", 0);

    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("does not auto-retry when attempt exceeds maxRetries", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 2 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        labels: [
          "transition:verification",
          "stage:verification",
          "commit:abc123",
          "attempt:2",
        ],
      }),
    });

    spawnMock.mockReturnValue(
      createMockProcess("VERIFICATION_RESULT:fail-requirements\n", 0)
    );

    await onAgentComplete(["foolery-test"], "take", "/repo", 0);

    // attempt 2 + 1 = 3, which exceeds maxRetries of 2
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("captures verifier output near VERIFICATION_RESULT when no REJECTION_SUMMARY present", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "", maxRetries: 3 });

    mockGet.mockResolvedValue({
      ok: true,
      data: makeBeat({
        notes: "",
        labels: [
          "transition:verification",
          "stage:verification",
          "commit:abc123",
        ],
      }),
    });

    spawnMock.mockReturnValue(
      createMockProcess("Checking requirements...\nThe feature is incomplete.\nVERIFICATION_RESULT:fail-requirements\n", 0)
    );

    await onAgentComplete(["foolery-test"], "take", "/repo", 0);

    const notesCall = mockUpdate.mock.calls.find(
      (call: unknown[]) => {
        const fields = call[1] as Record<string, unknown>;
        return typeof fields.notes === "string" && (fields.notes as string).includes("Verification attempt");
      }
    );
    expect(notesCall).toBeDefined();
    const notesFields = notesCall![1] as Record<string, unknown>;
    // Should contain the text before VERIFICATION_RESULT (fallback extraction)
    expect(notesFields.notes).toContain("The feature is incomplete");
  });
});
