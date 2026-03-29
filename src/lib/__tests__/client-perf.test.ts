import { beforeEach, describe, expect, it, vi } from "vitest";

describe("client-perf", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("enables diagnostics from the query string and persists it", async () => {
    const storage = createStorage();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }))));
    vi.stubGlobal("window", {
      location: {
        search: "?diagnostics=1",
        pathname: "/beats",
      },
      localStorage: storage,
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("performance", {
      mark: vi.fn(),
      measure: vi.fn(),
      clearMarks: vi.fn(),
      memory: {
        usedJSHeapSize: 10,
        totalJSHeapSize: 20,
        jsHeapSizeLimit: 30,
      },
    });

    const clientPerf = await import("@/lib/client-perf");

    expect(clientPerf.initializeDiagnostics()).toBe(true);
    expect(storage.getItem("foolery:diagnostics-enabled")).toBe("1");
  });

  it("records and summarizes emitted events", async () => {
    vi.stubGlobal("window", {
      location: {
        search: "?diagnostics=1",
        pathname: "/beats",
      },
      localStorage: createStorage(),
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true })))));
    vi.stubGlobal("performance", {
      mark: vi.fn(),
      measure: vi.fn(),
      clearMarks: vi.fn(),
      memory: {
        usedJSHeapSize: 100,
        totalJSHeapSize: 200,
        jsHeapSizeLimit: 400,
      },
    });

    const clientPerf = await import("@/lib/client-perf");
    const { createPerfEvent } = await import("@/lib/perf-events");

    clientPerf.initializeDiagnostics();
    clientPerf.recordClientPerfEvent(createPerfEvent({
      kind: "long_task",
      durationMs: 55,
    }));

    const snapshot = clientPerf.getDiagnosticsSnapshot();
    expect(snapshot.summary.totalEvents).toBe(1);
    expect(snapshot.summary.totalLongTaskMs).toBe(55);
  });
});

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
