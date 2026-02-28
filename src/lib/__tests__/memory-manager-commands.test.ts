import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDetectMemoryManagerType = vi.fn();

vi.mock("@/lib/memory-manager-detection", () => ({
  detectMemoryManagerType: (...args: unknown[]) => mockDetectMemoryManagerType(...args),
}));

import {
  buildShowIssueCommand,
  buildVerificationPassCommands,
  buildVerificationRetryCommands,
  buildVerificationStageCommand,
  resolveMemoryManagerType,
} from "@/lib/memory-manager-commands";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveMemoryManagerType", () => {
  it("defaults to beads when repoPath is missing", () => {
    expect(resolveMemoryManagerType()).toBe("beads");
  });

  it("falls back to beads when memory manager detection returns undefined", () => {
    mockDetectMemoryManagerType.mockReturnValue(undefined);
    expect(resolveMemoryManagerType("/repo")).toBe("beads");
  });

  it("uses detected knots memory manager when available", () => {
    mockDetectMemoryManagerType.mockReturnValue("knots");
    expect(resolveMemoryManagerType("/repo")).toBe("knots");
  });
});

describe("buildShowIssueCommand", () => {
  it("renders bd command for beads", () => {
    expect(buildShowIssueCommand("foolery-abc", "beads")).toBe(
      'bd show "foolery-abc"',
    );
  });

  it("renders knots command for knots", () => {
    expect(buildShowIssueCommand("foolery-abc", "knots")).toBe(
      'kno show "foolery-abc"',
    );
  });
});

describe("verification command rendering", () => {
  it("renders beads verification stage command with no-daemon when requested", () => {
    expect(
      buildVerificationStageCommand("foolery-abc", "beads", { noDaemon: true }),
    ).toBe('bd update "foolery-abc" --status in_progress --add-label stage:verification --no-daemon');
  });

  it("renders knots verification stage command", () => {
    expect(buildVerificationStageCommand("foolery-abc", "knots")).toBe(
      'kno claim "foolery-abc" --json',
    );
  });

  it("renders knots retry and pass commands", () => {
    expect(buildVerificationRetryCommands("foolery-abc", "knots")).toEqual([]);
    expect(buildVerificationPassCommands("foolery-abc", "knots")).toEqual([]);
  });
});
