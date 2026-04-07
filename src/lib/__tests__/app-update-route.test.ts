import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdateStatus } from "@/lib/app-update-types";

const mockReadAppUpdateStatus = vi.fn();
const mockStartAppUpdate = vi.fn();
const mockIsAllowedLocalUpdateRequest = vi.fn();
const mockLogAppUpdateEvent = vi.fn();

vi.mock("@/lib/app-update", () => ({
  readAppUpdateStatus: () => mockReadAppUpdateStatus(),
  startAppUpdate: () => mockStartAppUpdate(),
  isAllowedLocalUpdateRequest: (request: unknown) =>
    mockIsAllowedLocalUpdateRequest(request),
  logAppUpdateEvent: (...args: unknown[]) =>
    mockLogAppUpdateEvent(...args),
}));

import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/app-update/route";

function makeStatus(
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

describe("app-update route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the persisted update status", async () => {
    mockReadAppUpdateStatus.mockResolvedValue(
      makeStatus("completed"),
    );

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.phase).toBe("completed");
  });

  it("rejects disallowed POST callers", async () => {
    mockIsAllowedLocalUpdateRequest.mockReturnValue(false);

    const response = await POST(
      new NextRequest("http://localhost/api/app-update", {
        method: "POST",
        headers: { origin: "http://127.0.0.1" },
      }),
    );

    expect(response.status).toBe(403);
    expect(mockLogAppUpdateEvent).toHaveBeenCalledWith(
      "Rejected update request from origin http://127.0.0.1.",
    );
  });

  it("returns 202 when an update is started", async () => {
    mockIsAllowedLocalUpdateRequest.mockReturnValue(true);
    mockStartAppUpdate.mockResolvedValue({
      started: true,
      status: makeStatus("updating"),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/app-update", {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json.data.phase).toBe("updating");
  });

  it("returns 409 when an update is already in progress", async () => {
    mockIsAllowedLocalUpdateRequest.mockReturnValue(true);
    mockStartAppUpdate.mockResolvedValue({
      started: false,
      status: makeStatus("restarting"),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/app-update", {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
    );

    expect(response.status).toBe(409);
  });

  it("returns persisted failure state when startup throws", async () => {
    mockIsAllowedLocalUpdateRequest.mockReturnValue(true);
    mockStartAppUpdate.mockRejectedValue(
      new Error("launcher missing"),
    );
    mockReadAppUpdateStatus.mockResolvedValue(
      makeStatus("failed"),
    );

    const response = await POST(
      new NextRequest("http://localhost/api/app-update", {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("launcher missing");
    expect(json.data.phase).toBe("failed");
  });
});
