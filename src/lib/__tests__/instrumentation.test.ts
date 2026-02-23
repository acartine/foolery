import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBackfillMissingSettingsDefaults = vi.fn();
vi.mock("@/lib/settings", () => ({
  backfillMissingSettingsDefaults: () => mockBackfillMissingSettingsDefaults(),
}));

const mockBackfillMissingRepoTrackerTypes = vi.fn();
vi.mock("@/lib/registry", () => ({
  backfillMissingRepoTrackerTypes: () => mockBackfillMissingRepoTrackerTypes(),
}));

import { register } from "@/instrumentation";

describe("register startup backfills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_RUNTIME;
    mockBackfillMissingSettingsDefaults.mockResolvedValue({
      settings: {},
      missingPaths: [],
      fileMissing: false,
      changed: false,
    });
    mockBackfillMissingRepoTrackerTypes.mockResolvedValue({
      changed: false,
      migratedRepoPaths: [],
      fileMissing: false,
    });
  });

  it("runs both settings and registry backfills", async () => {
    await register();
    expect(mockBackfillMissingSettingsDefaults).toHaveBeenCalledTimes(1);
    expect(mockBackfillMissingRepoTrackerTypes).toHaveBeenCalledTimes(1);
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
    expect(mockBackfillMissingRepoTrackerTypes).toHaveBeenCalledTimes(1);
  });
});
