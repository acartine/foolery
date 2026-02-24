import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExistsSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

import { detectMemoryManagerType } from "@/lib/memory-manager-detection";

describe("detectMemoryManagerType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns knots when .knots marker is present", () => {
    mockExistsSync.mockImplementation((path: string) => path.endsWith("/.knots"));
    expect(detectMemoryManagerType("/tmp/repo")).toBe("knots");
  });

  it("returns beads when .beads marker is present", () => {
    mockExistsSync.mockImplementation((path: string) => path.endsWith("/.beads"));
    expect(detectMemoryManagerType("/tmp/repo")).toBe("beads");
  });

  it("prefers knots when both markers exist", () => {
    mockExistsSync.mockImplementation((path: string) => path.endsWith("/.knots") || path.endsWith("/.beads"));
    expect(detectMemoryManagerType("/tmp/repo")).toBe("knots");
  });

  it("returns undefined when no known marker exists", () => {
    mockExistsSync.mockReturnValue(false);
    expect(detectMemoryManagerType("/tmp/repo")).toBeUndefined();
  });
});
