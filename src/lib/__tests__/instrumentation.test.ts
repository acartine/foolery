import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockInstallConsoleTap = vi.fn();
vi.mock("@/lib/console-log-tap", () => ({
  installConsoleTap: () => mockInstallConsoleTap(),
}));

const mockBackfillMissingSettingsDefaults = vi.fn();
vi.mock("@/lib/settings", () => ({
  backfillMissingSettingsDefaults: () =>
    mockBackfillMissingSettingsDefaults(),
}));

const mockBackfillMissingRepoMemoryManagerTypes = vi.fn();
vi.mock("@/lib/registry", () => ({
  backfillMissingRepoMemoryManagerTypes: () =>
    mockBackfillMissingRepoMemoryManagerTypes(),
}));

const mockReadMessageTypeIndex = vi.fn();
const mockBuildMessageTypeIndex = vi.fn();
const mockWriteMessageTypeIndex = vi.fn();
vi.mock("@/lib/agent-message-type-index", () => ({
  readMessageTypeIndex: () => mockReadMessageTypeIndex(),
  buildMessageTypeIndex: () => mockBuildMessageTypeIndex(),
  writeMessageTypeIndex: (index: unknown) =>
    mockWriteMessageTypeIndex(index),
}));

import { register } from "@/instrumentation";

function setupMocks(): void {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.stubEnv("NEXT_RUNTIME", undefined);
    mockBackfillMissingSettingsDefaults.mockResolvedValue({
      settings: {}, missingPaths: [],
      fileMissing: false, changed: false,
    });
    mockBackfillMissingRepoMemoryManagerTypes.mockResolvedValue({
      changed: false, migratedRepoPaths: [],
      fileMissing: false,
    });
    mockReadMessageTypeIndex.mockResolvedValue({
      version: 1, builtAt: "2026-01-01T00:00:00Z",
      entries: [],
    });
    mockBuildMessageTypeIndex.mockResolvedValue({
      version: 1, builtAt: "2026-01-01T00:00:00Z",
      entries: [],
    });
    mockWriteMessageTypeIndex.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
}

describe("register: settings and registry backfills", () => {
  setupMocks();

  it("runs both backfills", async () => {
    await register();
    expect(
      mockBackfillMissingSettingsDefaults,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockBackfillMissingRepoMemoryManagerTypes,
    ).toHaveBeenCalledTimes(1);
  });

  it("still runs registry backfill when settings reports error", async () => {
    mockBackfillMissingSettingsDefaults.mockResolvedValue({
      settings: {}, missingPaths: [],
      fileMissing: false, changed: false,
      error: "permission denied",
    });

    await register();
    expect(
      mockBackfillMissingSettingsDefaults,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockBackfillMissingRepoMemoryManagerTypes,
    ).toHaveBeenCalledTimes(1);
  });

  it("skips all backfills for non-nodejs runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
    expect(
      mockBackfillMissingSettingsDefaults,
    ).not.toHaveBeenCalled();
    expect(
      mockBackfillMissingRepoMemoryManagerTypes,
    ).not.toHaveBeenCalled();
  });

  it("logs count for multiple settings backfills", async () => {
    const spy = vi.spyOn(
      console, "log",
    ).mockImplementation(() => {});
    mockBackfillMissingSettingsDefaults.mockResolvedValue({
      settings: {}, missingPaths: ["a.b", "c.d"],
      fileMissing: false, changed: true,
    });

    await register();

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("backfilled 2 missing settings"),
    );
  });

  it("logs singular form for one setting backfill", async () => {
    const spy = vi.spyOn(
      console, "log",
    ).mockImplementation(() => {});
    mockBackfillMissingSettingsDefaults.mockResolvedValue({
      settings: {}, missingPaths: ["a.b"],
      fileMissing: false, changed: true,
    });

    await register();

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("backfilled 1 missing setting in"),
    );
    const msg = spy.mock.calls[0]?.[0] as string;
    expect(msg).not.toContain("missing settings");
  });
});

describe("register: error handling", () => {
  setupMocks();

  it("catches settings backfill Error", async () => {
    const spy = vi.spyOn(
      console, "warn",
    ).mockImplementation(() => {});
    mockBackfillMissingSettingsDefaults.mockRejectedValue(
      new Error("file not found"),
    );

    await register();

    expect(spy).toHaveBeenCalledWith(
      "[settings] startup backfill failed: file not found",
    );
    expect(
      mockBackfillMissingRepoMemoryManagerTypes,
    ).toHaveBeenCalledTimes(1);
  });

  it("catches settings backfill non-Error", async () => {
    const spy = vi.spyOn(
      console, "warn",
    ).mockImplementation(() => {});
    mockBackfillMissingSettingsDefaults.mockRejectedValue(
      "string error",
    );

    await register();

    expect(spy).toHaveBeenCalledWith(
      "[settings] startup backfill failed: string error",
    );
    expect(
      mockBackfillMissingRepoMemoryManagerTypes,
    ).toHaveBeenCalledTimes(1);
  });

  it("warns when registry backfill reports error", async () => {
    const spy = vi.spyOn(
      console, "warn",
    ).mockImplementation(() => {});
    mockBackfillMissingRepoMemoryManagerTypes.mockResolvedValue({
      changed: false, migratedRepoPaths: [],
      fileMissing: false, error: "registry locked",
    });

    await register();

    expect(spy).toHaveBeenCalledWith(
      "[registry] startup memory manager backfill skipped: registry locked",
    );
  });

  it("logs count when registry backfill migrates repos", async () => {
    const spy = vi.spyOn(
      console, "log",
    ).mockImplementation(() => {});
    mockBackfillMissingRepoMemoryManagerTypes.mockResolvedValue({
      changed: true,
      migratedRepoPaths: ["/repo/a", "/repo/b", "/repo/c"],
      fileMissing: false,
    });

    await register();

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining(
        "backfilled memory manager metadata for 3 repos",
      ),
    );
  });

  it("catches registry backfill Error", async () => {
    const spy = vi.spyOn(
      console, "warn",
    ).mockImplementation(() => {});
    mockBackfillMissingRepoMemoryManagerTypes.mockRejectedValue(
      new Error("corrupt registry"),
    );

    await register();

    expect(spy).toHaveBeenCalledWith(
      "[registry] startup memory manager backfill failed: corrupt registry",
    );
  });

  it("catches registry backfill non-Error", async () => {
    const spy = vi.spyOn(
      console, "warn",
    ).mockImplementation(() => {});
    mockBackfillMissingRepoMemoryManagerTypes.mockRejectedValue(
      42,
    );

    await register();

    expect(spy).toHaveBeenCalledWith(
      "[registry] startup memory manager backfill failed: 42",
    );
  });
});

describe("register: message-type index", () => {
  setupMocks();

  it("skips index build when index already exists", async () => {
    mockReadMessageTypeIndex.mockResolvedValue({
      version: 1, builtAt: "2026-01-01T00:00:00Z",
      entries: [{
        type: "text", agents: [],
        firstSeen: "", lastSeen: "", count: 1,
      }],
    });

    await register();

    expect(
      mockReadMessageTypeIndex,
    ).toHaveBeenCalledTimes(1);
    expect(mockBuildMessageTypeIndex).not.toHaveBeenCalled();
    expect(mockWriteMessageTypeIndex).not.toHaveBeenCalled();
  });

  it("builds and writes index when none exists", async () => {
    const spy = vi.spyOn(
      console, "log",
    ).mockImplementation(() => {});
    mockReadMessageTypeIndex.mockResolvedValue(null);
    mockBuildMessageTypeIndex.mockResolvedValue({
      version: 1, builtAt: "2026-01-01T00:00:00Z",
      entries: [
        {
          type: "text", agents: [],
          firstSeen: "", lastSeen: "", count: 3,
        },
        {
          type: "tool_use", agents: [],
          firstSeen: "", lastSeen: "", count: 1,
        },
      ],
    });

    await register();

    expect(
      mockBuildMessageTypeIndex,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockWriteMessageTypeIndex,
    ).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Building agent message type index",
      ),
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Built index with 2 message types",
      ),
    );
  });

});

describe("register: message-type index edge cases", () => {
  setupMocks();

  it("logs singular form for one type", async () => {
    const spy = vi.spyOn(
      console, "log",
    ).mockImplementation(() => {});
    mockReadMessageTypeIndex.mockResolvedValue(null);
    mockBuildMessageTypeIndex.mockResolvedValue({
      version: 1, builtAt: "2026-01-01T00:00:00Z",
      entries: [{
        type: "text", agents: [],
        firstSeen: "", lastSeen: "", count: 1,
      }],
    });

    await register();

    const builtLog = spy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" && c[0].includes("Built index"),
    );
    expect(builtLog).toBeDefined();
    expect(builtLog![0]).toContain("1 message type.");
    expect(builtLog![0]).not.toContain("message types.");
  });

  it("catches index build Error", async () => {
    const spy = vi.spyOn(
      console, "warn",
    ).mockImplementation(() => {});
    mockReadMessageTypeIndex.mockRejectedValue(
      new Error("disk full"),
    );

    await register();

    expect(spy).toHaveBeenCalledWith(
      "[message-types] startup index build failed: disk full",
    );
  });

  it("catches index build non-Error", async () => {
    const spy = vi.spyOn(
      console, "warn",
    ).mockImplementation(() => {});
    mockReadMessageTypeIndex.mockRejectedValue("unexpected");

    await register();

    expect(spy).toHaveBeenCalledWith(
      "[message-types] startup index build failed: unexpected",
    );
  });

  it("skips index build for non-nodejs runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
    expect(
      mockReadMessageTypeIndex,
    ).not.toHaveBeenCalled();
  });
});
