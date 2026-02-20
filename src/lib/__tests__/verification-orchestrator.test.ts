import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Bead } from "@/lib/types";

// ── Mock setup ──────────────────────────────────────────────

// Mock bd.ts
const showBeadMock = vi.fn();
const updateBeadMock = vi.fn();
const closeBeadMock = vi.fn();
vi.mock("@/lib/bd", () => ({
  showBead: (...args: unknown[]) => showBeadMock(...args),
  updateBead: (...args: unknown[]) => updateBeadMock(...args),
  closeBead: (...args: unknown[]) => closeBeadMock(...args),
}));

// Mock settings
const getVerificationSettingsMock = vi.fn();
const getVerificationAgentMock = vi.fn();
vi.mock("@/lib/settings", () => ({
  getVerificationSettings: () => getVerificationSettingsMock(),
  getVerificationAgent: () => getVerificationAgentMock(),
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

import { onAgentComplete } from "@/lib/verification-orchestrator";
import {
  _clearAllLocks,
  computeEntryLabels,
  computePassLabels,
  computeRetryLabels,
} from "@/lib/verification-workflow";
import { EventEmitter } from "node:events";

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

  // Default: verification disabled
  getVerificationSettingsMock.mockResolvedValue({ enabled: false, agent: "" });
  getVerificationAgentMock.mockResolvedValue({ command: "claude" });
  showBeadMock.mockResolvedValue({ ok: true, data: makeBead() });
  updateBeadMock.mockResolvedValue({ ok: true });
  closeBeadMock.mockResolvedValue({ ok: true });
});

// ── Test: disabled verification ─────────────────────────────

describe("onAgentComplete", () => {
  it("does nothing when verification is disabled", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: false, agent: "" });
    await onAgentComplete(["foolery-test"], "take", "/repo", 0);
    expect(updateBeadMock).not.toHaveBeenCalled();
  });

  it("does nothing for non-eligible actions", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "" });
    await onAgentComplete(["foolery-test"], "breakdown", "/repo", 0);
    expect(updateBeadMock).not.toHaveBeenCalled();
  });

  it("does nothing for failed agent exit", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "" });
    await onAgentComplete(["foolery-test"], "take", "/repo", 1);
    expect(updateBeadMock).not.toHaveBeenCalled();
  });
});

// ── Test: pass path (xmg8.4.1) ─────────────────────────────

describe("pass path", () => {
  it("enters verification, launches verifier, and closes bead on pass", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "" });

    // First show: fresh bead (no labels)
    // Second show: after entry labels applied (for commit check)
    // Third show: after commit check (with commit label)
    // Fourth show: for verifier prompt build
    // Fifth show: for outcome application
    let showCallCount = 0;
    showBeadMock.mockImplementation(() => {
      showCallCount++;
      if (showCallCount <= 1) {
        return { ok: true, data: makeBead({ labels: [] }) };
      }
      // After first update, bead has transition + stage + commit labels
      return {
        ok: true,
        data: makeBead({
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
    expect(updateBeadMock).toHaveBeenCalled();

    // Should have called closeBead for the pass outcome
    expect(closeBeadMock).toHaveBeenCalledWith(
      "foolery-test",
      "Auto-verification passed",
      "/repo"
    );
  });
});

// ── Test: retry path (xmg8.4.2) ────────────────────────────

describe("retry paths", () => {
  it("transitions to retry when no commit label found", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "" });

    // Always return bead with no commit label
    showBeadMock.mockResolvedValue({
      ok: true,
      data: makeBead({
        labels: ["transition:verification", "stage:verification"],
      }),
    });

    await onAgentComplete(["foolery-test"], "take", "/repo", 0);

    // Should have called updateBead to transition to retry
    const retryCall = updateBeadMock.mock.calls.find(
      (call: unknown[]) => {
        const fields = call[1] as Record<string, unknown>;
        return fields.status === "open" && Array.isArray(fields.labels) && (fields.labels as string[]).includes("stage:retry");
      }
    );
    expect(retryCall).toBeDefined();
  });

  it("transitions to retry on verifier fail-requirements", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "" });

    showBeadMock.mockResolvedValue({
      ok: true,
      data: makeBead({
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
    expect(closeBeadMock).not.toHaveBeenCalled();

    // Should have called updateBead with retry labels
    const retryCall = updateBeadMock.mock.calls.find(
      (call: unknown[]) => {
        const fields = call[1] as Record<string, unknown>;
        return fields.status === "open";
      }
    );
    expect(retryCall).toBeDefined();
  });
});

// ── Test: idempotency (xmg8.4.3) ───────────────────────────

describe("idempotency", () => {
  it("deduplicates concurrent verification requests", async () => {
    getVerificationSettingsMock.mockResolvedValue({ enabled: true, agent: "" });

    // Bead with commit label ready to go
    showBeadMock.mockResolvedValue({
      ok: true,
      data: makeBead({
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
