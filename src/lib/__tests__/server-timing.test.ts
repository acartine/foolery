import { describe, expect, it, vi } from "vitest";
import { withServerTiming } from "@/lib/server-timing";

const serverLogMock = vi.fn();

vi.mock("@/lib/server-logger", () => ({
  serverLog: (...args: unknown[]) => serverLogMock(...args),
}));

describe("withServerTiming", () => {
  it("adds Server-Timing headers", async () => {
    const response = await withServerTiming(
      { route: "GET /api/test", slowMs: 1_000 },
      async ({ measure }) => {
        await measure("read", async () => Promise.resolve("ok"));
        return new Response("ok");
      },
    );

    expect(response.headers.get("Server-Timing")).toContain("read;dur=");
    expect(response.headers.get("Server-Timing")).toContain("total;dur=");
  });

  it("logs slow requests", async () => {
    const originalPerformance = globalThis.performance;
    let now = 0;
    vi.stubGlobal("performance", {
      now: () => {
        now += 600;
        return now;
      },
    });

    await withServerTiming(
      { route: "GET /api/test", slowMs: 500, context: { repoPath: "/tmp/repo" } },
      async ({ measure }) => {
        await measure("read", async () => Promise.resolve("ok"));
        return new Response("ok");
      },
    );

    expect(serverLogMock).toHaveBeenCalledWith(
      "warn",
      "api-perf",
      "GET /api/test slow request",
      expect.objectContaining({
        route: "GET /api/test",
        repoPath: "/tmp/repo",
      }),
    );

    vi.stubGlobal("performance", originalPerformance);
  });
});
