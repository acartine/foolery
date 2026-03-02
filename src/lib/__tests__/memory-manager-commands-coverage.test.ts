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

  it("returns bd show command for beads (delegates to buildShowIssueCommand)", () => {
    expect(buildClaimCommand("foo-123", "beads")).toBe(
      'bd show "foo-123"',
    );
  });
});

describe("buildWorkflowStateCommand (lines 36-48)", () => {
  it("returns kno update for knots", () => {
    const cmd = buildWorkflowStateCommand("foo-123", "implementation", "knots");
    expect(cmd).toBe('kno update "foo-123" --status "implementation"');
  });

  it("returns bd update with compat status and wf:state label for beads", () => {
    const cmd = buildWorkflowStateCommand("foo-123", "implementation", "beads");
    expect(cmd).toContain('bd update "foo-123"');
    expect(cmd).toContain("--status");
    expect(cmd).toContain('--add-label "wf:state:implementation"');
  });

  it("normalizes workflow state to lowercase", () => {
    const cmd = buildWorkflowStateCommand("foo-123", "  IMPLEMENTATION  ", "knots");
    expect(cmd).toContain('"implementation"');
  });

  it("appends --no-daemon flag when noDaemon option is set for beads", () => {
    const cmd = buildWorkflowStateCommand("foo-123", "implementation", "beads", { noDaemon: true });
    expect(cmd).toContain("--no-daemon");
  });

  it("omits --no-daemon flag when noDaemon is not set for beads", () => {
    const cmd = buildWorkflowStateCommand("foo-123", "implementation", "beads");
    expect(cmd).not.toContain("--no-daemon");
  });
});

describe("quoteArg helper (line 14)", () => {
  it("JSON-encodes special characters in values", () => {
    const cmd = buildWorkflowStateCommand('id"special', "state", "knots");
    expect(cmd).toContain('"id\\"special"');
  });
});
