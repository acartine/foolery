import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockChmod = vi.fn();
const mockStat = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  chmod: (...args: unknown[]) => mockChmod(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

const mockDetectMemoryManagerType = vi.fn();
vi.mock("@/lib/memory-manager-detection", () => ({
  detectMemoryManagerType: (...args: unknown[]) => mockDetectMemoryManagerType(...args),
}));

import {
  listRepos,
  inspectMissingRepoMemoryManagerTypes,
  backfillMissingRepoMemoryManagerTypes,
  updateRegisteredRepoMemoryManagerType,
  inspectRegistryPermissions,
  ensureRegistryPermissions,
} from "@/lib/registry";

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockChmod.mockResolvedValue(undefined);
  mockStat.mockResolvedValue({ mode: 0o600 });
  mockDetectMemoryManagerType.mockReturnValue(undefined);
});

describe("listRepos", () => {
  it("infers beats memoryManagerType for legacy entries missing memory manager metadata", async () => {
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
    expect(repos[0].memoryManagerType).toBe("beads");
  });

  it("infers knots memoryManagerType when detection finds .knots", async () => {
    mockDetectMemoryManagerType.mockReturnValue("knots");
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
    expect(repos[0].memoryManagerType).toBe("knots");
  });
});

describe("inspectMissingRepoMemoryManagerTypes", () => {
  it("reports repos missing memoryManagerType metadata", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          { path: "/repo-a", name: "repo-a", addedAt: "2026-01-01T00:00:00.000Z" },
          {
            path: "/repo-b",
            name: "repo-b",
            addedAt: "2026-01-01T00:00:00.000Z",
            memoryManagerType: "beads",
          },
        ],
      }),
    );

    const result = await inspectMissingRepoMemoryManagerTypes();
    expect(result.error).toBeUndefined();
    expect(result.fileMissing).toBe(false);
    expect(result.missingRepoPaths).toEqual(["/repo-a"]);
  });
});

describe("backfillMissingRepoMemoryManagerTypes", () => {
  it("writes memory manager metadata for repos missing memoryManagerType", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          { path: "/repo-a", name: "repo-a", addedAt: "2026-01-01T00:00:00.000Z" },
          {
            path: "/repo-b",
            name: "repo-b",
            addedAt: "2026-01-01T00:00:00.000Z",
            memoryManagerType: "beads",
          },
        ],
      }),
    );
    mockDetectMemoryManagerType.mockReturnValue("beads");

    const result = await backfillMissingRepoMemoryManagerTypes();
    expect(result.changed).toBe(true);
    expect(result.migratedRepoPaths).toEqual(["/repo-a"]);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);

    const written = mockWriteFile.mock.calls[0][1] as string;
    const parsed = JSON.parse(written) as {
      repos: Array<{ path: string; memoryManagerType?: string }>;
    };
    expect(parsed.repos).toEqual([
      { path: "/repo-a", name: "repo-a", addedAt: "2026-01-01T00:00:00.000Z", memoryManagerType: "beads" },
      { path: "/repo-b", name: "repo-b", addedAt: "2026-01-01T00:00:00.000Z", memoryManagerType: "beads" },
    ]);
    expect(mockChmod).toHaveBeenCalledWith(
      expect.stringContaining("registry.json"),
      0o600,
    );
  });

  it("does not write when memory manager metadata already exists", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          {
            path: "/repo-a",
            name: "repo-a",
            addedAt: "2026-01-01T00:00:00.000Z",
            memoryManagerType: "beads",
          },
        ],
      }),
    );

    const result = await backfillMissingRepoMemoryManagerTypes();
    expect(result.changed).toBe(false);
    expect(result.migratedRepoPaths).toEqual([]);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("returns fileMissing=true when registry file does not exist", async () => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockReadFile.mockRejectedValue(err);

    const result = await backfillMissingRepoMemoryManagerTypes();
    expect(result.changed).toBe(false);
    expect(result.fileMissing).toBe(true);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe("updateRegisteredRepoMemoryManagerType", () => {
  it("updates an existing repo entry to the detected memory manager type", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          {
            path: "/repo-a",
            name: "repo-a",
            addedAt: "2026-01-01T00:00:00.000Z",
            memoryManagerType: "beads",
          },
        ],
      }),
    );

    const result = await updateRegisteredRepoMemoryManagerType("/repo-a", "knots");
    expect(result.changed).toBe(true);
    expect(result.repoFound).toBe(true);
    expect(result.previousMemoryManagerType).toBe("beads");
    expect(result.memoryManagerType).toBe("knots");
    expect(mockWriteFile).toHaveBeenCalledTimes(1);

    const written = mockWriteFile.mock.calls[0][1] as string;
    const parsed = JSON.parse(written) as {
      repos: Array<{ path: string; memoryManagerType?: string }>;
    };
    expect(parsed.repos[0]).toMatchObject({
      path: "/repo-a",
      memoryManagerType: "knots",
    });
    expect(mockChmod).toHaveBeenCalledWith(
      expect.stringContaining("registry.json"),
      0o600,
    );
  });

  it("does not write when the repo is already registered with the detected type", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          {
            path: "/repo-a",
            name: "repo-a",
            addedAt: "2026-01-01T00:00:00.000Z",
            memoryManagerType: "knots",
          },
        ],
      }),
    );

    const result = await updateRegisteredRepoMemoryManagerType("/repo-a", "knots");
    expect(result.changed).toBe(false);
    expect(result.repoFound).toBe(true);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe("registry permissions", () => {
  it("reports when registry.json permissions need tightening", async () => {
    mockStat.mockResolvedValue({ mode: 0o644 });

    const result = await inspectRegistryPermissions();
    expect(result.fileMissing).toBe(false);
    expect(result.needsFix).toBe(true);
    expect(result.actualMode).toBe(0o644);
  });

  it("chmods registry.json to 0600 when needed", async () => {
    mockStat.mockResolvedValue({ mode: 0o644 });

    const result = await ensureRegistryPermissions();
    expect(result.changed).toBe(true);
    expect(mockChmod).toHaveBeenCalledWith(
      expect.stringContaining("registry.json"),
      0o600,
    );
  });
});

describe("updateRegisteredRepoMemoryManagerType", () => {
  it("updates an existing repo entry to the detected memory manager type", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          {
            path: "/repo-a",
            name: "repo-a",
            addedAt: "2026-01-01T00:00:00.000Z",
            memoryManagerType: "beads",
          },
        ],
      }),
    );

    const result = await updateRegisteredRepoMemoryManagerType("/repo-a", "knots");
    expect(result.changed).toBe(true);
    expect(result.repoFound).toBe(true);
    expect(result.previousMemoryManagerType).toBe("beads");
    expect(result.memoryManagerType).toBe("knots");
    expect(mockWriteFile).toHaveBeenCalledTimes(1);

    const written = mockWriteFile.mock.calls[0][1] as string;
    const parsed = JSON.parse(written) as {
      repos: Array<{ path: string; memoryManagerType?: string }>;
    };
    expect(parsed.repos[0]).toMatchObject({
      path: "/repo-a",
      memoryManagerType: "knots",
    });
  });

  it("does not write when the repo is already registered with the detected type", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        repos: [
          {
            path: "/repo-a",
            name: "repo-a",
            addedAt: "2026-01-01T00:00:00.000Z",
            memoryManagerType: "knots",
          },
        ],
      }),
    );

    const result = await updateRegisteredRepoMemoryManagerType("/repo-a", "knots");
    expect(result.changed).toBe(false);
    expect(result.repoFound).toBe(true);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
