import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDetectMemoryManagerType = vi.fn();

vi.mock("@/lib/memory-manager-detection", () => ({
  detectMemoryManagerType: (...args: unknown[]) => mockDetectMemoryManagerType(...args),
}));

import {
  buildShowIssueCommand,
  resolveMemoryManagerType,
} from "@/lib/memory-manager-commands";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveMemoryManagerType", () => {
  it("defaults to beats when repoPath is missing", () => {
    expect(resolveMemoryManagerType()).toBe("beads");
  });

  it("falls back to beats when memory manager detection returns undefined", () => {
    mockDetectMemoryManagerType.mockReturnValue(undefined);
    expect(resolveMemoryManagerType("/repo")).toBe("beads");
  });

  it("uses detected knots memory manager when available", () => {
    mockDetectMemoryManagerType.mockReturnValue("knots");
    expect(resolveMemoryManagerType("/repo")).toBe("knots");
  });
});

describe("buildShowIssueCommand", () => {
  it("renders bd command for beats", () => {
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

