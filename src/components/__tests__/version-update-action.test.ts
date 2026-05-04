import {
  describe, expect, it, vi,
} from "vitest";
import {
  UPDATE_COMPLETE_RELOAD_DELAY_MS,
  VERSION_UPDATE_COMMAND,
  idleUpdateStatus,
  readVersionUpdateStatus,
  scheduleUpdateCompleteReload,
  shouldAutoReloadCompletedUpdate,
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

describe("update completion reload", () => {
  it("schedules a page reload after update completion", () => {
    const reload = vi.fn();
    const setTimeoutMock = vi.fn(
      (callback: () => void, delay: number) => {
        expect(delay).toBe(UPDATE_COMPLETE_RELOAD_DELAY_MS);
        callback();
        return 123;
      },
    );

    const timer = scheduleUpdateCompleteReload(
      reload,
      setTimeoutMock as unknown as typeof setTimeout,
    );

    expect(timer).toBe(123);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("only auto-reloads after this page observed an update", () => {
    const completed = {
      ...idleUpdateStatus(),
      phase: "completed" as const,
    };

    expect(
      shouldAutoReloadCompletedUpdate(
        completed,
        false,
        false,
      ),
    ).toBe(false);
    expect(
      shouldAutoReloadCompletedUpdate(
        completed,
        true,
        false,
      ),
    ).toBe(true);
    expect(
      shouldAutoReloadCompletedUpdate(
        completed,
        true,
        true,
      ),
    ).toBe(false);
  });
});
