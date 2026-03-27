import {
  afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import {
  checkForUpdates,
  type VersionCheckState,
} from "@/components/version-badge";

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
