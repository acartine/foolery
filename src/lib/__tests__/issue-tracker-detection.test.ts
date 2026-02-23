import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExistsSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

import { detectIssueTrackerType } from "@/lib/issue-tracker-detection";

describe("detectIssueTrackerType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns knots when .knots marker is present", () => {
    mockExistsSync.mockImplementation((path: string) => path.endsWith("/.knots"));
    expect(detectIssueTrackerType("/tmp/repo")).toBe("knots");
  });

  it("returns beads when .beads marker is present", () => {
    mockExistsSync.mockImplementation((path: string) => path.endsWith("/.beads"));
    expect(detectIssueTrackerType("/tmp/repo")).toBe("beads");
  });

  it("prefers knots when both markers exist", () => {
    mockExistsSync.mockImplementation((path: string) => path.endsWith("/.knots") || path.endsWith("/.beads"));
    expect(detectIssueTrackerType("/tmp/repo")).toBe("knots");
  });

  it("returns undefined when no known marker exists", () => {
    mockExistsSync.mockReturnValue(false);
    expect(detectIssueTrackerType("/tmp/repo")).toBeUndefined();
  });
});
