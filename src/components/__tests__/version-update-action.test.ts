import {
  describe, expect, it, vi,
} from "vitest";
import {
  VERSION_UPDATE_COMMAND,
  idleUpdateStatus,
  readVersionUpdateStatus,
  triggerVersionUpdate,
} from "@/components/version-update-action";

describe("triggerVersionUpdate", () => {
  it("starts the backend update flow", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          ...idleUpdateStatus(),
          phase: "updating",
        },
      }),
    });

    await expect(
      triggerVersionUpdate(fetchMock as unknown as typeof fetch),
    ).resolves.toMatchObject({
      phase: "updating",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/app-update",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns null when the backend update call fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new Error("denied"),
    );

    await expect(
      triggerVersionUpdate(fetchMock as unknown as typeof fetch),
    ).resolves.toBeNull();
  });

  it("returns failure status payloads even from a 500 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        data: {
          ...idleUpdateStatus(),
          phase: "failed",
          error: "launcher missing",
        },
      }),
    });

    await expect(
      triggerVersionUpdate(fetchMock as unknown as typeof fetch),
    ).resolves.toMatchObject({
      phase: "failed",
      error: "launcher missing",
    });
  });

  it("reads persisted backend update status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          ...idleUpdateStatus(),
          phase: "completed",
        },
      }),
    });

    await expect(
      readVersionUpdateStatus(fetchMock as unknown as typeof fetch),
    ).resolves.toMatchObject({
      phase: "completed",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/app-update",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("keeps the manual fallback command stable", () => {
    expect(VERSION_UPDATE_COMMAND).toBe(
      "foolery update && foolery restart",
    );
  });
});
