/**
 * Shared mock setup for doctor split test files.
 */
import { vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────

export const mockList = vi.fn();
export const mockUpdate = vi.fn();
export const mockListWorkflows = vi.fn();

export const mockGetRegisteredAgents = vi.fn();
export const mockScanForAgents = vi.fn();
export const mockLoadSettings = vi.fn();
export const mockUpdateSettings = vi.fn();
export const mockInspectSettingsDefaults = vi.fn();
export const mockInspectStaleSettingsKeys = vi.fn();
export const mockBackfillMissingSettingsDefaults = vi.fn();
export const mockInspectSettingsPermissions = vi.fn();
export const mockEnsureSettingsPermissions = vi.fn();
export const mockCleanStaleSettingsKeys = vi.fn();

export const mockListRepos = vi.fn();
export const mockInspectMissingRepoMemoryManagerTypes =
  vi.fn();
export const mockBackfillMissingRepoMemoryManagerTypes =
  vi.fn();
export const mockInspectRegistryPermissions = vi.fn();
export const mockEnsureRegistryPermissions = vi.fn();
export const mockUpdateRegisteredRepoMemoryManagerType =
  vi.fn();

export const mockGetReleaseVersionStatus = vi.fn();

export const mockExecFile = vi.fn();

export const mockDetectMemoryManagerType = vi.fn();

export const DEFAULT_SETTINGS = {
  agents: {},
  actions: {
    take: "",
    scene: "",
  },
  backend: { type: "auto" as const },
};

export function setupDefaultMocks(): void {
  mockListRepos.mockResolvedValue([]);
  mockGetRegisteredAgents.mockResolvedValue({});
  mockLoadSettings.mockResolvedValue(DEFAULT_SETTINGS);
  mockListWorkflows.mockResolvedValue({
    ok: true,
    data: [
      {
        id: "beads-coarse",
        backingWorkflowId: "beads-coarse",
        label: "Beats (Coarse)",
        mode: "coarse_human_gated",
        initialState: "open",
        states: [
          "open",
          "in_progress",
          "retake",
          "closed",
        ],
        terminalStates: ["closed"],
        finalCutState: null,
        retakeState: "retake",
        promptProfileId: "beads-coarse-human-gated",
      },
    ],
  });
  mockInspectSettingsDefaults.mockResolvedValue({
    settings: DEFAULT_SETTINGS,
    missingPaths: [],
    normalizationPaths: [],
    fileMissing: false,
  });
  mockInspectStaleSettingsKeys.mockResolvedValue({
    stalePaths: [],
    fileMissing: false,
  });
  mockBackfillMissingSettingsDefaults.mockResolvedValue({
    settings: DEFAULT_SETTINGS,
    missingPaths: [],
    normalizationPaths: [],
    fileMissing: false,
    changed: false,
  });
  mockInspectSettingsPermissions.mockResolvedValue({
    fileMissing: false,
    needsFix: false,
    actualMode: 0o600,
  });
  mockEnsureSettingsPermissions.mockResolvedValue({
    fileMissing: false,
    needsFix: false,
    actualMode: 0o600,
    changed: false,
  });
  mockCleanStaleSettingsKeys.mockResolvedValue({
    stalePaths: [],
    fileMissing: false,
    changed: false,
  });
  mockInspectMissingRepoMemoryManagerTypes.mockResolvedValue({
    missingRepoPaths: [],
    fileMissing: false,
  });
  mockBackfillMissingRepoMemoryManagerTypes.mockResolvedValue({
    changed: false,
    migratedRepoPaths: [],
    fileMissing: false,
  });
  mockInspectRegistryPermissions.mockResolvedValue({
    fileMissing: false,
    needsFix: false,
    actualMode: 0o600,
  });
  mockEnsureRegistryPermissions.mockResolvedValue({
    fileMissing: false,
    needsFix: false,
    actualMode: 0o600,
    changed: false,
  });
  mockUpdateRegisteredRepoMemoryManagerType
    .mockResolvedValue({
      changed: false,
      fileMissing: false,
      repoFound: true,
    });
  mockGetReleaseVersionStatus.mockResolvedValue({
    installedVersion: "1.0.0",
    latestVersion: "1.0.0",
    updateAvailable: false,
  });
  mockDetectMemoryManagerType.mockReturnValue(undefined);
  mockExecFile.mockResolvedValue({
    stdout: "1.0.0", stderr: "",
  });
}

export function buildBackendMock() {
  return {
    getBackend: () => ({
      list: (...args: unknown[]) => mockList(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      listWorkflows: (...args: unknown[]) =>
        mockListWorkflows(...args),
    }),
  };
}

export function buildSettingsMock() {
  return {
    getRegisteredAgents: () =>
      mockGetRegisteredAgents(),
    scanForAgents: () => mockScanForAgents(),
    loadSettings: () => mockLoadSettings(),
    updateSettings: (...args: unknown[]) =>
      mockUpdateSettings(...args),
    inspectSettingsDefaults: () =>
      mockInspectSettingsDefaults(),
    inspectStaleSettingsKeys: () =>
      mockInspectStaleSettingsKeys(),
    backfillMissingSettingsDefaults: () =>
      mockBackfillMissingSettingsDefaults(),
    inspectSettingsPermissions: () =>
      mockInspectSettingsPermissions(),
    ensureSettingsPermissions: () =>
      mockEnsureSettingsPermissions(),
    cleanStaleSettingsKeys: () =>
      mockCleanStaleSettingsKeys(),
  };
}

export function buildRegistryMock() {
  return {
    listRepos: () => mockListRepos(),
    inspectMissingRepoMemoryManagerTypes: () =>
      mockInspectMissingRepoMemoryManagerTypes(),
    backfillMissingRepoMemoryManagerTypes: () =>
      mockBackfillMissingRepoMemoryManagerTypes(),
    inspectRegistryPermissions: () =>
      mockInspectRegistryPermissions(),
    ensureRegistryPermissions: () =>
      mockEnsureRegistryPermissions(),
    updateRegisteredRepoMemoryManagerType: (
      ...args: unknown[]
    ) =>
      mockUpdateRegisteredRepoMemoryManagerType(
        ...args,
      ),
  };
}

export function buildReleaseVersionMock() {
  return {
    getReleaseVersionStatus: () =>
      mockGetReleaseVersionStatus(),
  };
}

export function buildChildProcessMock() {
  return {
    execFile: (...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        const p = mockExecFile(args[0], args[1]);
        p.then(
          (r: { stdout: string; stderr: string }) =>
            cb(null, r.stdout, r.stderr),
          (e: Error) => cb(e, "", ""),
        );
      }
    },
  };
}

export function buildMemoryManagerDetectionMock() {
  return {
    detectMemoryManagerType: (...args: unknown[]) =>
      mockDetectMemoryManagerType(...args),
  };
}
