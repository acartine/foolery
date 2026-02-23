import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDetectIssueTrackerType = vi.fn();

vi.mock("@/lib/issue-tracker-detection", () => ({
  detectIssueTrackerType: (...args: unknown[]) => mockDetectIssueTrackerType(...args),
}));

import {
  buildShowIssueCommand,
  buildVerificationPassCommands,
  buildVerificationRetryCommands,
  buildVerificationStageCommand,
  resolveIssueTrackerType,
} from "@/lib/tracker-commands";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveIssueTrackerType", () => {
  it("defaults to beads when repoPath is missing", () => {
    expect(resolveIssueTrackerType()).toBe("beads");
  });

  it("falls back to beads when tracker detection returns undefined", () => {
    mockDetectIssueTrackerType.mockReturnValue(undefined);
    expect(resolveIssueTrackerType("/repo")).toBe("beads");
  });

  it("uses detected knots tracker when available", () => {
    mockDetectIssueTrackerType.mockReturnValue("knots");
    expect(resolveIssueTrackerType("/repo")).toBe("knots");
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
      'knots show "foolery-abc"',
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
      'knots update "foolery-abc" --status implementing --add-tag stage:verification',
    );
  });

  it("renders knots retry and pass commands", () => {
    expect(buildVerificationRetryCommands("foolery-abc", "knots")).toEqual([
      'knots update "foolery-abc" --remove-tag stage:verification --remove-tag transition:verification --add-tag stage:retry',
    ]);

    expect(buildVerificationPassCommands("foolery-abc", "knots")).toEqual([
      'knots update "foolery-abc" --remove-tag stage:verification --remove-tag transition:verification --status shipped --force',
    ]);
  });
});
