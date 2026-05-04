import { beforeEach, describe, expect, it, vi } from "vitest";

const listLeases = vi.fn();

vi.mock("@/lib/knots", () => ({
  listLeases: (...args: unknown[]) => listLeases(...args),
}));

import {
  leaseAcquiredAtByLeaseId,
} from "@/lib/backends/knots-backend-leases";

beforeEach(() => {
  listLeases.mockReset();
});

describe("Knots backend lease acquisition lookup", () => {
  it("uses all leases so expired-but-bound leases keep their time", async () => {
    listLeases.mockResolvedValueOnce({
      ok: true,
      data: [{
        id: "lease-1",
        title: "Lease",
        state: "lease_active",
        updated_at: "2026-05-04T10:00:01.000Z",
        created_at: "2026-05-04T09:59:59.000Z",
        step_history: [{
          step: "lease_active",
          started_at: "2026-05-04T10:00:00.000Z",
        }],
      }],
    });

    const result = await leaseAcquiredAtByLeaseId("/repo");

    expect(listLeases).toHaveBeenCalledWith("/repo", true);
    expect(result.get("lease-1")).toBe("2026-05-04T10:00:00.000Z");
  });

  it("falls back to active leases when --all is unavailable", async () => {
    listLeases
      .mockResolvedValueOnce({ ok: false, error: "unknown flag" })
      .mockResolvedValueOnce({
        ok: true,
        data: [{
          id: "lease-2",
          title: "Lease",
          state: "lease_active",
          updated_at: "2026-05-04T10:05:00.000Z",
          created_at: "2026-05-04T10:04:59.000Z",
        }],
      });

    const result = await leaseAcquiredAtByLeaseId("/repo");

    expect(listLeases).toHaveBeenNthCalledWith(1, "/repo", true);
    expect(listLeases).toHaveBeenNthCalledWith(2, "/repo");
    expect(result.get("lease-2")).toBe("2026-05-04T10:04:59.000Z");
  });
});
