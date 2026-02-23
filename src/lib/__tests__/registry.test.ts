import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

const mockDetectIssueTrackerType = vi.fn();
vi.mock("@/lib/issue-tracker-detection", () => ({
  detectIssueTrackerType: (...args: unknown[]) => mockDetectIssueTrackerType(...args),
}));

import {
  listRepos,
  inspectMissingRepoTrackerTypes,
  backfillMissingRepoTrackerTypes,
} from "@/lib/registry";

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockDetectIssueTrackerType.mockReturnValue(undefined);
});

describe("listRepos", () => {
  it("infers beads trackerType for legacy entries missing tracker metadata", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          {
            path: "/repo-a",
            name: "repo-a",
            addedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    const repos = await listRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0].trackerType).toBe("beads");
  });

  it("infers knots trackerType when detection finds .knots", async () => {
    mockDetectIssueTrackerType.mockReturnValue("knots");
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          {
            path: "/repo-knots",
            name: "repo-knots",
            addedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    const repos = await listRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0].trackerType).toBe("knots");
  });
});

describe("inspectMissingRepoTrackerTypes", () => {
  it("reports repos missing trackerType metadata", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          { path: "/repo-a", name: "repo-a", addedAt: "2026-01-01T00:00:00.000Z" },
          {
            path: "/repo-b",
            name: "repo-b",
            addedAt: "2026-01-01T00:00:00.000Z",
            trackerType: "beads",
          },
        ],
      }),
    );

    const result = await inspectMissingRepoTrackerTypes();
    expect(result.error).toBeUndefined();
    expect(result.fileMissing).toBe(false);
    expect(result.missingRepoPaths).toEqual(["/repo-a"]);
  });
});

describe("backfillMissingRepoTrackerTypes", () => {
  it("writes tracker metadata for repos missing trackerType", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          { path: "/repo-a", name: "repo-a", addedAt: "2026-01-01T00:00:00.000Z" },
          {
            path: "/repo-b",
            name: "repo-b",
            addedAt: "2026-01-01T00:00:00.000Z",
            trackerType: "beads",
          },
        ],
      }),
    );
    mockDetectIssueTrackerType.mockReturnValue("beads");

    const result = await backfillMissingRepoTrackerTypes();
    expect(result.changed).toBe(true);
    expect(result.migratedRepoPaths).toEqual(["/repo-a"]);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);

    const written = mockWriteFile.mock.calls[0][1] as string;
    const parsed = JSON.parse(written) as {
      repos: Array<{ path: string; trackerType?: string }>;
    };
    expect(parsed.repos).toEqual([
      { path: "/repo-a", name: "repo-a", addedAt: "2026-01-01T00:00:00.000Z", trackerType: "beads" },
      { path: "/repo-b", name: "repo-b", addedAt: "2026-01-01T00:00:00.000Z", trackerType: "beads" },
    ]);
  });

  it("does not write when tracker metadata already exists", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          {
            path: "/repo-a",
            name: "repo-a",
            addedAt: "2026-01-01T00:00:00.000Z",
            trackerType: "beads",
          },
        ],
      }),
    );

    const result = await backfillMissingRepoTrackerTypes();
    expect(result.changed).toBe(false);
    expect(result.migratedRepoPaths).toEqual([]);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("returns fileMissing=true when registry file does not exist", async () => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockReadFile.mockRejectedValue(err);

    const result = await backfillMissingRepoTrackerTypes();
    expect(result.changed).toBe(false);
    expect(result.fileMissing).toBe(true);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
