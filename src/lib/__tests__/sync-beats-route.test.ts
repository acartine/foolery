import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mockGetBeatsSyncState = vi.fn();
const mockTriggerBeatsSync = vi.fn();

vi.mock("@/lib/beats-sync-service", () => ({
  getBeatsSyncState: () => mockGetBeatsSyncState(),
  triggerBeatsSync: () => mockTriggerBeatsSync(),
}));

import { GET, POST } from "@/app/api/sync/beats/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/sync/beats", () => {
  it("GET returns sync state without triggering a job", async () => {
    mockGetBeatsSyncState.mockResolvedValue({
      running: false,
      projects: [],
      lastCompletedSync: null,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      running: false,
      projects: [],
      lastCompletedSync: null,
    });
    expect(mockTriggerBeatsSync).not.toHaveBeenCalled();
  });

  it("POST returns trigger state", async () => {
    mockTriggerBeatsSync.mockResolvedValue({
      running: false,
      projects: [{ repoPath: "/repo", lastSyncedAt: null }],
      lastCompletedSync: null,
    });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      running: false,
      projects: [{ repoPath: "/repo", lastSyncedAt: null }],
      lastCompletedSync: null,
    });
    expect(mockTriggerBeatsSync).toHaveBeenCalledTimes(1);
  });

  it("returns a 500 when the service throws", async () => {
    mockGetBeatsSyncState.mockRejectedValue(new Error("boom"));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "boom",
    });
  });
});
