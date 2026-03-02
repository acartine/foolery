import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBackfillMissingSettingsDefaults = vi.fn();
vi.mock("@/lib/settings", () => ({
  backfillMissingSettingsDefaults: () => mockBackfillMissingSettingsDefaults(),
}));

const mockBackfillMissingRepoMemoryManagerTypes = vi.fn();
vi.mock("@/lib/registry", () => ({
  backfillMissingRepoMemoryManagerTypes: () => mockBackfillMissingRepoMemoryManagerTypes(),
}));

const mockReadMessageTypeIndex = vi.fn();
const mockBuildMessageTypeIndex = vi.fn();
const mockWriteMessageTypeIndex = vi.fn();
vi.mock("@/lib/agent-message-type-index", () => ({
  readMessageTypeIndex: () => mockReadMessageTypeIndex(),
  buildMessageTypeIndex: () => mockBuildMessageTypeIndex(),
  writeMessageTypeIndex: (index: unknown) => mockWriteMessageTypeIndex(index),
}));

import { register } from "@/instrumentation";

describe("register startup backfills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    delete process.env.NEXT_RUNTIME;
    mockBackfillMissingSettingsDefaults.mockResolvedValue({
      settings: {},
      missingPaths: [],
      fileMissing: false,
      changed: false,
    });
    mockBackfillMissingRepoMemoryManagerTypes.mockResolvedValue({
      changed: false,
      migratedRepoPaths: [],
      fileMissing: false,
    });
    // Default: index already exists (skip build)
    mockReadMessageTypeIndex.mockResolvedValue({
      version: 1,
      builtAt: "2026-01-01T00:00:00Z",
      entries: [],
    });
    mockBuildMessageTypeIndex.mockResolvedValue({
      version: 1,
      builtAt: "2026-01-01T00:00:00Z",
      entries: [],
    });
    mockWriteMessageTypeIndex.mockResolvedValue(undefined);
  });

  it("runs both settings and registry backfills", async () => {
    await register();
    expect(mockBackfillMissingSettingsDefaults).toHaveBeenCalledTimes(1);
    expect(mockBackfillMissingRepoMemoryManagerTypes).toHaveBeenCalledTimes(1);
  });

  it("still runs registry backfill when settings backfill reports an error", async () => {
    mockBackfillMissingSettingsDefaults.mockResolvedValue({
      settings: {},
      missingPaths: [],
      fileMissing: false,
      changed: false,
      error: "permission denied",
    });

    await register();
    expect(mockBackfillMissingSettingsDefaults).toHaveBeenCalledTimes(1);
    expect(mockBackfillMissingRepoMemoryManagerTypes).toHaveBeenCalledTimes(1);
  });

  // --- Line 9: early return for non-nodejs runtimes ---
  it("skips all backfills when NEXT_RUNTIME is not nodejs", async () => {
    process.env.NEXT_RUNTIME = "edge";
    await register();
    expect(mockBackfillMissingSettingsDefaults).not.toHaveBeenCalled();
    expect(mockBackfillMissingRepoMemoryManagerTypes).not.toHaveBeenCalled();
  });

  // --- Lines 18-22: settings changed path (plural) ---
  it("logs count when settings backfill changes multiple settings", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockBackfillMissingSettingsDefaults.mockResolvedValue({
      settings: {},
      missingPaths: ["a.b", "c.d"],
      fileMissing: false,
      changed: true,
    });

    await register();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("backfilled 2 missing settings"),
    );
  });

  // --- Line 20: settings changed path (singular) ---
  it("logs singular form when exactly one setting is backfilled", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockBackfillMissingSettingsDefaults.mockResolvedValue({
      settings: {},
      missingPaths: ["a.b"],
      fileMissing: false,
      changed: true,
    });

    await register();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("backfilled 1 missing setting in"),
    );
    // Ensure it does NOT say "settings" (plural)
    const loggedMessage = logSpy.mock.calls[0]?.[0] as string;
    expect(loggedMessage).not.toContain("missing settings");
  });

  // --- Lines 23-25: settings backfill throws Error instance ---
  it("catches and warns when settings backfill throws an Error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockBackfillMissingSettingsDefaults.mockRejectedValue(
      new Error("file not found"),
    );

    await register();

    expect(warnSpy).toHaveBeenCalledWith(
      "[settings] startup backfill failed: file not found",
    );
    // Registry backfill should still run
    expect(mockBackfillMissingRepoMemoryManagerTypes).toHaveBeenCalledTimes(1);
  });

  // --- Lines 23-25: settings backfill throws non-Error ---
  it("catches and warns when settings backfill throws a non-Error value", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockBackfillMissingSettingsDefaults.mockRejectedValue("string error");

    await register();

    expect(warnSpy).toHaveBeenCalledWith(
      "[settings] startup backfill failed: string error",
    );
    expect(mockBackfillMissingRepoMemoryManagerTypes).toHaveBeenCalledTimes(1);
  });

  // --- Line 32: registry backfill reports an error ---
  it("warns when registry backfill reports an error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockBackfillMissingRepoMemoryManagerTypes.mockResolvedValue({
      changed: false,
      migratedRepoPaths: [],
      fileMissing: false,
      error: "registry locked",
    });

    await register();

    expect(warnSpy).toHaveBeenCalledWith(
      "[registry] startup memory manager backfill skipped: registry locked",
    );
  });

  // --- Lines 34-38: registry changed path ---
  it("logs count when registry backfill migrates repos", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockBackfillMissingRepoMemoryManagerTypes.mockResolvedValue({
      changed: true,
      migratedRepoPaths: ["/repo/a", "/repo/b", "/repo/c"],
      fileMissing: false,
    });

    await register();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("backfilled memory manager metadata for 3 repos"),
    );
  });

  // --- Lines 39-41: registry backfill throws Error instance ---
  it("catches and warns when registry backfill throws an Error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockBackfillMissingRepoMemoryManagerTypes.mockRejectedValue(
      new Error("corrupt registry"),
    );

    await register();

    expect(warnSpy).toHaveBeenCalledWith(
      "[registry] startup memory manager backfill failed: corrupt registry",
    );
  });

  // --- Lines 39-41: registry backfill throws non-Error ---
  it("catches and warns when registry backfill throws a non-Error value", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockBackfillMissingRepoMemoryManagerTypes.mockRejectedValue(42);

    await register();

    expect(warnSpy).toHaveBeenCalledWith(
      "[registry] startup memory manager backfill failed: 42",
    );
  });

  // --- Lines 45-66: message-type index startup ---

  it("skips index build when index already exists", async () => {
    mockReadMessageTypeIndex.mockResolvedValue({
      version: 1,
      builtAt: "2026-01-01T00:00:00Z",
      entries: [{ type: "text", agents: [], firstSeen: "", lastSeen: "", count: 1 }],
    });

    await register();

    expect(mockReadMessageTypeIndex).toHaveBeenCalledTimes(1);
    expect(mockBuildMessageTypeIndex).not.toHaveBeenCalled();
    expect(mockWriteMessageTypeIndex).not.toHaveBeenCalled();
  });

  it("builds and writes index when none exists", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockReadMessageTypeIndex.mockResolvedValue(null);
    mockBuildMessageTypeIndex.mockResolvedValue({
      version: 1,
      builtAt: "2026-01-01T00:00:00Z",
      entries: [
        { type: "text", agents: [], firstSeen: "", lastSeen: "", count: 3 },
        { type: "tool_use", agents: [], firstSeen: "", lastSeen: "", count: 1 },
      ],
    });

    await register();

    expect(mockBuildMessageTypeIndex).toHaveBeenCalledTimes(1);
    expect(mockWriteMessageTypeIndex).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Building agent message type index"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Built index with 2 message types"),
    );
  });

  it("logs singular form when index has exactly one type", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockReadMessageTypeIndex.mockResolvedValue(null);
    mockBuildMessageTypeIndex.mockResolvedValue({
      version: 1,
      builtAt: "2026-01-01T00:00:00Z",
      entries: [{ type: "text", agents: [], firstSeen: "", lastSeen: "", count: 1 }],
    });

    await register();

    const builtLog = logSpy.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("Built index"),
    );
    expect(builtLog).toBeDefined();
    expect(builtLog![0]).toContain("1 message type.");
    expect(builtLog![0]).not.toContain("message types.");
  });

  it("catches and warns when message-type index build throws an Error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockReadMessageTypeIndex.mockRejectedValue(new Error("disk full"));

    await register();

    expect(warnSpy).toHaveBeenCalledWith(
      "[message-types] startup index build failed: disk full",
    );
  });

  it("catches and warns when message-type index build throws a non-Error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockReadMessageTypeIndex.mockRejectedValue("unexpected");

    await register();

    expect(warnSpy).toHaveBeenCalledWith(
      "[message-types] startup index build failed: unexpected",
    );
  });

  it("skips index build when NEXT_RUNTIME is not nodejs", async () => {
    process.env.NEXT_RUNTIME = "edge";
    await register();
    expect(mockReadMessageTypeIndex).not.toHaveBeenCalled();
  });
});
