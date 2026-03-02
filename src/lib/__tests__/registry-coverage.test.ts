import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

const mockDetectMemoryManagerType = vi.fn();
vi.mock("@/lib/memory-manager-detection", () => ({
  detectMemoryManagerType: (...args: unknown[]) => mockDetectMemoryManagerType(...args),
}));

import {
  addRepo,
  removeRepo,
  loadRegistry,
  saveRegistry,
  backfillMissingRepoMemoryManagerTypes,
  inspectMissingRepoMemoryManagerTypes,
} from "@/lib/registry";

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockDetectMemoryManagerType.mockReturnValue(undefined);
});

describe("normalizeRepo edge cases (line 61)", () => {
  it("rejects unknown memoryManagerType string and falls back to detection", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          {
            path: "/repo",
            name: "repo",
            addedAt: "2026-01-01T00:00:00.000Z",
            memoryManagerType: "unknown-type",
          },
        ],
      }),
    );
    mockDetectMemoryManagerType.mockReturnValue("knots");

    const { loadRegistry } = await import("@/lib/registry");
    const reg = await loadRegistry();
    expect(reg.repos[0]?.memoryManagerType).toBe("knots");
  });
});

describe("backfillMissingRepoMemoryManagerTypes edge cases", () => {
  it("returns error when readFile throws non-ENOENT error (line 181)", async () => {
    const err = new Error("EACCES: permission denied");
    (err as NodeJS.ErrnoException).code = "EACCES";
    mockReadFile.mockRejectedValue(err);

    const result = await backfillMissingRepoMemoryManagerTypes();
    expect(result.changed).toBe(false);
    expect(result.error).toContain("EACCES");
    expect(result.fileMissing).toBe(false);
  });

  it("returns unchanged when parsed value is not an object (line 198)", async () => {
    mockReadFile.mockResolvedValue('"just a string"');

    const result = await backfillMissingRepoMemoryManagerTypes();
    expect(result.changed).toBe(false);
    expect(result.migratedRepoPaths).toEqual([]);
    expect(result.fileMissing).toBe(false);
  });

  it("returns unchanged when parsed object has no repos array (line 207)", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ other: "data" }));

    const result = await backfillMissingRepoMemoryManagerTypes();
    expect(result.changed).toBe(false);
    expect(result.migratedRepoPaths).toEqual([]);
    expect(result.fileMissing).toBe(false);
  });

  it("returns unchanged when JSON parse fails", async () => {
    mockReadFile.mockResolvedValue("{{not valid json}}");

    const result = await backfillMissingRepoMemoryManagerTypes();
    expect(result.changed).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("inspectMissingRepoMemoryManagerTypes edge cases", () => {
  it("returns empty missing list when readFile errors", async () => {
    const err = new Error("EACCES") as NodeJS.ErrnoException;
    err.code = "EACCES";
    mockReadFile.mockRejectedValue(err);

    const result = await inspectMissingRepoMemoryManagerTypes();
    expect(result.missingRepoPaths).toEqual([]);
    expect(result.error).toContain("EACCES");
  });

  it("skips repos with empty path in missing check", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [{ path: "", name: "empty" }],
      }),
    );

    const result = await inspectMissingRepoMemoryManagerTypes();
    expect(result.missingRepoPaths).toEqual([]);
  });

  it("skips non-object entries in repos array", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [null, "not-an-object", 42],
      }),
    );

    const result = await inspectMissingRepoMemoryManagerTypes();
    expect(result.missingRepoPaths).toEqual([]);
  });
});

describe("addRepo", () => {
  it("throws when no memory manager is detected", async () => {
    mockDetectMemoryManagerType.mockReturnValue(undefined);
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await expect(addRepo("/new-repo")).rejects.toThrow("No supported memory manager found");
  });

  it("throws when repo is already registered", async () => {
    mockDetectMemoryManagerType.mockReturnValue("beads");
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          { path: "/existing", name: "existing", addedAt: "2026-01-01T00:00:00.000Z", memoryManagerType: "beads" },
        ],
      }),
    );

    await expect(addRepo("/existing")).rejects.toThrow("already registered");
  });

  it("adds a new repo successfully", async () => {
    mockDetectMemoryManagerType.mockReturnValue("beads");
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const repo = await addRepo("/new-repo");
    expect(repo.path).toBe("/new-repo");
    expect(repo.memoryManagerType).toBe("beads");
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });
});

describe("removeRepo", () => {
  it("removes a repo from the registry", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          { path: "/repo-a", name: "a", addedAt: "2026-01-01T00:00:00.000Z", memoryManagerType: "beads" },
          { path: "/repo-b", name: "b", addedAt: "2026-01-01T00:00:00.000Z", memoryManagerType: "knots" },
        ],
      }),
    );

    await removeRepo("/repo-a");
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    expect(written.repos).toHaveLength(1);
    expect(written.repos[0].path).toBe("/repo-b");
  });
});

describe("loadRegistry edge cases", () => {
  it("returns empty repos on parse error", async () => {
    mockReadFile.mockResolvedValue("{{invalid json}}");
    const reg = await loadRegistry();
    expect(reg.repos).toEqual([]);
  });

  it("normalizes repos with missing name and addedAt", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [{ path: "/my-repo" }],
      }),
    );

    const reg = await loadRegistry();
    expect(reg.repos).toHaveLength(1);
    expect(reg.repos[0]?.name).toBe("my-repo");
    expect(reg.repos[0]?.addedAt).toBeTruthy();
  });

  it("skips entries with no path", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [{ name: "no-path" }, { path: "", name: "empty-path" }],
      }),
    );

    const reg = await loadRegistry();
    expect(reg.repos).toEqual([]);
  });
});

describe("saveRegistry", () => {
  it("creates config dir and writes JSON", async () => {
    await saveRegistry({ repos: [] });
    expect(mockMkdir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });
});
