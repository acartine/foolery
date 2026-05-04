import {
  afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import type { ReactElement, ReactNode } from "react";
import {
  checkForUpdates,
  type VersionCheckState,
  VersionBadgeTrigger,
  VersionPopoverBody,
} from "@/components/version-badge";
import { Button } from "@/components/ui/button";
import type { AppUpdateStatus } from "@/lib/app-update-types";
import type { VersionStatusData } from "@/lib/version-status-client";

/* --------------------------------------------------------
 * Mock global fetch so we can simulate API responses
 * without a running server.
 * ------------------------------------------------------ */

const fetchMock = vi.fn<
  (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>
>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* --------------------------------------------------------
 * Helpers
 * ------------------------------------------------------ */

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (!node || typeof node === "boolean") {
    return "";
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join("");
  }
  const element = node as ReactElement<{
    children?: ReactNode;
  }>;
  return flattenText(element.props.children);
}

function findButton(node: ReactNode): ReactElement<{
  children?: ReactNode;
}> | null {
  if (!node || typeof node === "string") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findButton(child);
      if (match) return match;
    }
    return null;
  }

  const element = node as ReactElement<{
    children?: ReactNode;
  }>;
  if (element.type === Button) {
    return element;
  }
  return findButton(element.props.children);
}

function makeUpdateStatus(
  phase: AppUpdateStatus["phase"],
): AppUpdateStatus {
  return {
    phase,
    message: null,
    error: null,
    startedAt: null,
    endedAt: null,
    workerPid: null,
    launcherPath: null,
    fallbackCommand: "foolery update && foolery restart",
  };
}

function makeVersionStatus(
  patch: Partial<VersionStatusData> = {},
): VersionStatusData {
  return {
    installedVersion: "0.5.0",
    latestVersion: "0.6.0",
    updateAvailable: true,
    ...patch,
  };
}

/* --------------------------------------------------------
 * checkForUpdates — the core fetch-then-classify logic
 * ------------------------------------------------------ */

describe("checkForUpdates — status", () => {
  it(
    "returns 'update-available' when the API " +
    "reports a newer version",
    async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            installedVersion: "0.5.0",
            latestVersion: "0.6.0",
            updateAvailable: true,
          },
        }),
      );

      const result = await checkForUpdates();

      expect(result).toEqual<VersionCheckState>({
        status: "update-available",
        latestVersion: "0.6.0",
        versionStatus: {
          installedVersion: "0.5.0",
          latestVersion: "0.6.0",
          updateAvailable: true,
        },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/version?force=1",
        expect.objectContaining({ method: "GET" }),
      );
    },
  );

  it(
    "returns 'up-to-date' when no update is " +
    "available",
    async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            installedVersion: "0.5.1",
            latestVersion: "0.5.1",
            updateAvailable: false,
          },
        }),
      );

      const result = await checkForUpdates();

      expect(result).toEqual<VersionCheckState>({
        status: "up-to-date",
        versionStatus: {
          installedVersion: "0.5.1",
          latestVersion: "0.5.1",
          updateAvailable: false,
        },
      });
    },
  );

  it(
    "returns 'error' when the API responds with " +
    "a non-200 status",
    async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { ok: false, error: "server error" },
          500,
        ),
      );

      const result = await checkForUpdates();

      expect(result).toEqual<VersionCheckState>({
        status: "error",
        message: "Version check failed",
      });
    },
  );

  it(
    "returns 'up-to-date' when updateAvailable " +
    "is true but latestVersion is null",
    async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            installedVersion: "0.5.0",
            latestVersion: null,
            updateAvailable: true,
          },
        }),
      );

      const result = await checkForUpdates();

      expect(result).toEqual<VersionCheckState>({
        status: "up-to-date",
        versionStatus: {
          installedVersion: "0.5.0",
          latestVersion: null,
          updateAvailable: false,
        },
      });
    },
  );
});

describe("checkForUpdates — fetch options", () => {
  it(
    "passes the abort signal to fetch",
    async () => {
      const ctrl = new AbortController();

      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            installedVersion: "0.5.0",
            latestVersion: "0.5.0",
            updateAvailable: false,
          },
        }),
      );

      await checkForUpdates(ctrl.signal);

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/version?force=1",
        expect.objectContaining({
          signal: ctrl.signal,
        }),
      );
    },
  );

  it(
    "propagates fetch network errors to caller",
    async () => {
      fetchMock.mockRejectedValueOnce(
        new TypeError("Failed to fetch"),
      );

      await expect(
        checkForUpdates(),
      ).rejects.toThrow("Failed to fetch");
    },
  );
});

describe("VersionBadgeTrigger", () => {
  it("renders the installed version supplied by shared status", () => {
    const tree = VersionBadgeTrigger({
      installedVersion: "0.13.3",
      onCheck: vi.fn(),
    });

    expect(flattenText(tree)).toContain("v0.13.3");
    expect(flattenText(tree)).not.toContain("0.0.0");
  });

  it("uses a neutral label while the canonical version loads", () => {
    const tree = VersionBadgeTrigger({
      installedVersion: null,
      onCheck: vi.fn(),
    });

    expect(flattenText(tree)).toBe("version");
    expect(flattenText(tree)).not.toBe("v");
  });
});

describe("VersionPopoverBody", () => {
  it("formats prefixed latest versions without duplicating v", () => {
    const tree = VersionPopoverBody({
      state: {
        status: "update-available",
        latestVersion: "v0.6.2",
        versionStatus: makeVersionStatus({
          latestVersion: "v0.6.2",
        }),
      },
      installedVersion: "0.5.0",
      updateStatus: makeUpdateStatus("idle"),
      onCheck: vi.fn(),
      onUpdateNow: vi.fn(),
    });

    expect(flattenText(tree)).toContain("v0.6.2 available");
    expect(flattenText(tree)).not.toContain("vv0.6.2");

    const updateButton = findButton(tree);
    expect(flattenText(updateButton)).toContain(
      "Update now to v0.6.2",
    );
  });

  it("formats unprefixed latest versions with a single v", () => {
    const tree = VersionPopoverBody({
      state: {
        status: "update-available",
        latestVersion: "0.6.2",
        versionStatus: makeVersionStatus({
          latestVersion: "0.6.2",
        }),
      },
      installedVersion: "0.5.0",
      updateStatus: makeUpdateStatus("idle"),
      onCheck: vi.fn(),
      onUpdateNow: vi.fn(),
    });

    expect(flattenText(tree)).toContain("v0.6.2 available");
    const updateButton = findButton(tree);
    expect(flattenText(updateButton)).toContain(
      "Update now to v0.6.2",
    );
  });

  it("renders restart progress while automatic update is running", () => {
    const tree = VersionPopoverBody({
      state: {
        status: "update-available",
        latestVersion: "0.6.2",
        versionStatus: makeVersionStatus({
          latestVersion: "0.6.2",
        }),
      },
      installedVersion: "0.5.0",
      updateStatus: makeUpdateStatus("restarting"),
      onCheck: vi.fn(),
      onUpdateNow: vi.fn(),
    });

    const updateButton = findButton(tree);
    expect(flattenText(updateButton)).toContain(
      "Restarting…",
    );
    expect(flattenText(tree)).toContain(
      "Restarting Foolery. Manual fallback:",
    );
  });

  it("renders update completion as non-clickable status", () => {
    const tree = VersionPopoverBody({
      state: {
        status: "update-available",
        latestVersion: "0.6.2",
        versionStatus: makeVersionStatus({
          latestVersion: "0.6.2",
        }),
      },
      installedVersion: "0.5.0",
      updateStatus: makeUpdateStatus("completed"),
      onCheck: vi.fn(),
      onUpdateNow: vi.fn(),
    });

    expect(findButton(tree)).toBeNull();
    expect(flattenText(tree)).toContain("Update complete");
    expect(flattenText(tree)).toContain(
      "Refreshing page shortly",
    );
  });
});
