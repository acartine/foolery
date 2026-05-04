import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDetectMemoryManagerType = vi.fn();

vi.mock("@/lib/memory-manager-detection", () => ({
  detectMemoryManagerType: (...args: unknown[]) => mockDetectMemoryManagerType(...args),
}));

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;
const mockExec = vi.fn((_cmd: string, _opts: unknown, cb: ExecCallback) => cb(null, "", ""));
vi.mock("node:child_process", () => ({
  exec: (cmd: string, opts: unknown, cb: ExecCallback) => mockExec(cmd, opts, cb),
}));

const mockBackendUpdate = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({ update: mockBackendUpdate }),
}));

const mockUpdateKnot = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/lib/knots", () => ({
  updateKnot: (...args: unknown[]) => mockUpdateKnot(...args),
}));

import {
  buildClaimCommand,
  buildWorkflowStateCommand,
  rollbackBeatState,
} from "@/lib/memory-manager-commands";

beforeEach(() => {
  vi.clearAllMocks();
  mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: ExecCallback) => cb(null, "", ""));
  mockBackendUpdate.mockResolvedValue({ ok: true });
  mockUpdateKnot.mockResolvedValue({ ok: true });
});

describe("buildClaimCommand (line 32-34)", () => {
  it("returns kno claim with --json for knots", () => {
    expect(buildClaimCommand("foo-123", "knots")).toBe(
      'kno claim "foo-123" --json',
    );
  });

  it("returns bd show command for beats (delegates to buildShowIssueCommand)", () => {
    expect(buildClaimCommand("foo-123", "beads")).toBe(
      'bd show "foo-123"',
    );
  });

  it("includes --lease flag when leaseId provided for knots", () => {
    expect(buildClaimCommand("foo-123", "knots", "L-42")).toBe(
      'kno claim "foo-123" --json --lease "L-42"',
    );
  });

  it("omits --lease flag when leaseId not provided for knots", () => {
    expect(buildClaimCommand("foo-123", "knots")).toBe(
      'kno claim "foo-123" --json',
    );
  });

  it("ignores leaseId for beads", () => {
    expect(buildClaimCommand("foo-123", "beads", "L-42")).toBe(
      'bd show "foo-123"',
    );
  });
});

describe("buildWorkflowStateCommand (lines 36-48)", () => {
  it("returns kno next with expected state for knots", () => {
    const cmd = buildWorkflowStateCommand("foo-123", "implementation", "knots");
    expect(cmd).toBe('kno next "foo-123" --expected-state "implementation" --actor-kind agent');
  });

  it("returns bd update with compat status and wf:state label for beats", () => {
    const cmd = buildWorkflowStateCommand("foo-123", "implementation", "beads");
    expect(cmd).toContain('bd update "foo-123"');
    expect(cmd).toContain("--status");
    expect(cmd).toContain('--add-label "wf:state:implementation"');
  });

  it("normalizes workflow state for knots kno next command", () => {
    const cmd = buildWorkflowStateCommand("foo-123", "  IMPLEMENTATION  ", "knots");
    expect(cmd).toBe('kno next "foo-123" --expected-state "implementation" --actor-kind agent');
  });

  it("appends --no-daemon flag when noDaemon option is set for beats", () => {
    const cmd = buildWorkflowStateCommand("foo-123", "implementation", "beads", { noDaemon: true });
    expect(cmd).toContain("--no-daemon");
  });

  it("omits --no-daemon flag when noDaemon is not set for beats", () => {
    const cmd = buildWorkflowStateCommand("foo-123", "implementation", "beads");
    expect(cmd).not.toContain("--no-daemon");
  });

  it("includes --lease flag when leaseId provided for knots", () => {
    const cmd = buildWorkflowStateCommand("foo-123", "implementation", "knots", { leaseId: "L-42" });
    expect(cmd).toBe('kno next "foo-123" --expected-state "implementation" --actor-kind agent --lease "L-42"');
  });

  it("omits --lease flag when leaseId not provided for knots", () => {
    const cmd = buildWorkflowStateCommand("foo-123", "implementation", "knots");
    expect(cmd).not.toContain("--lease");
  });

  it("ignores leaseId for beads", () => {
    const cmd = buildWorkflowStateCommand("foo-123", "implementation", "beads", { leaseId: "L-42" });
    expect(cmd).not.toContain("--lease");
  });
});

describe("quoteId helper (line 9)", () => {
  it("JSON-encodes special characters in id for knots", () => {
    const cmd = buildWorkflowStateCommand('id"special', "state", "knots");
    expect(cmd).toBe('kno next "id\\"special" --expected-state "state" --actor-kind agent');
  });

  it("JSON-encodes special characters in id for beats", () => {
    const cmd = buildWorkflowStateCommand('id"special', "state", "beads");
    expect(cmd).toContain('"id\\"special"');
  });
});

describe("rollbackBeatState", () => {
  it("uses kno rollback with quoted id for knots", async () => {
    await rollbackBeatState("beat-42", "implementation", "triage", "/tmp", "knots");
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec.mock.calls[0][0]).toBe(
      'kno rollback "beat-42" --actor-kind agent',
    );
  });

  it("adds a note when reason is provided for knots", async () => {
    await rollbackBeatState("beat-42", "implementation", "triage", "/tmp", "knots", "flaky test");
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec.mock.calls[0][0]).toBe(
      'kno rollback "beat-42" --actor-kind agent',
    );
    expect(mockUpdateKnot).toHaveBeenCalledOnce();
    expect(mockUpdateKnot).toHaveBeenCalledWith("beat-42", { addNote: "flaky test" }, "/tmp");
  });

  it("does not add a note when reason is omitted for knots", async () => {
    await rollbackBeatState("beat-42", "implementation", "triage", "/tmp", "knots");
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockUpdateKnot).not.toHaveBeenCalled();
  });

  it("uses backend.update() for beads instead of exec", async () => {
    await rollbackBeatState("beat-42", "implementation", "triage", "/tmp", "beads");
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockBackendUpdate).toHaveBeenCalledWith("beat-42", { state: "triage" }, "/tmp");
  });

  it("propagates exec errors for knots", async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: ExecCallback) =>
      cb(new Error("command failed"), "", "kno: not found"),
    );
    await expect(
      rollbackBeatState("beat-42", "implementation", "triage", "/tmp", "knots"),
    ).rejects.toThrow("command failed");
  });

  it("escapes special characters in beatId via JSON.stringify", async () => {
    await rollbackBeatState('id with "quotes" & spaces', "impl", "triage", "/tmp", "knots");
    expect(mockExec.mock.calls[0][0]).toBe(
      'kno rollback "id with \\"quotes\\" & spaces" --actor-kind agent',
    );
  });

  it("does not add a note when reason is an empty string for knots", async () => {
    await rollbackBeatState("beat-42", "implementation", "triage", "/tmp", "knots", "");
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec.mock.calls[0][0]).toBe(
      'kno rollback "beat-42" --actor-kind agent',
    );
  });

  it("does not add a note when reason is undefined for knots", async () => {
    await rollbackBeatState("beat-42", "implementation", "triage", "/tmp", "knots", undefined);
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec.mock.calls[0][0]).toBe(
      'kno rollback "beat-42" --actor-kind agent',
    );
  });
});
