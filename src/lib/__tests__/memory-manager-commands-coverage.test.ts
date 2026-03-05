import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDetectMemoryManagerType = vi.fn();

vi.mock("@/lib/memory-manager-detection", () => ({
  detectMemoryManagerType: (...args: unknown[]) => mockDetectMemoryManagerType(...args),
}));

import {
  buildClaimCommand,
  buildWorkflowStateCommand,
} from "@/lib/memory-manager-commands";

beforeEach(() => {
  vi.clearAllMocks();
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
