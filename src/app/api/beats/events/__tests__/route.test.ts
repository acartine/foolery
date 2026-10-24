import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  list: vi.fn(), detect: vi.fn(), subscribe: vi.fn(), reset: vi.fn(),
}));
vi.mock("@/lib/registry", () => ({ listRepos: mocks.list }));
vi.mock("@/lib/memory-manager-detection", () => ({ detectMemoryManagerType: mocks.detect }));
vi.mock("@/lib/beads-journal-runtime", () => ({ subscribeBeadsJournal: mocks.subscribe }));
vi.mock("@/lib/beats-multi-repo", () => ({ _resetAggregateBeatsCache: mocks.reset }));
import { GET } from "../route";

function decode(value?: Uint8Array): string { return new TextDecoder().decode(value); }

describe("Beads journal SSE route", () => {
  it("multiplexes Beads repositories, marks mixed scopes polling, and releases subscriptions", async () => {
    vi.useFakeTimers();
    mocks.list.mockResolvedValue([{ path: "/beads" }, { path: "/knots" }]);
    mocks.detect.mockImplementation((path: string) => path === "/beads" ? "beads" : "knots");
    const unsubscribe = vi.fn();
    mocks.subscribe.mockImplementation((repoPath, callback) => {
      callback({ type: "ready", repoPath });
      return unsubscribe;
    });
    const response = await GET(new NextRequest("http://localhost/api/beats/events"));
    const reader = response.body!.getReader();
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(decode((await reader.read()).value)).toContain('"type":"polling"');
    expect(decode((await reader.read()).value)).toContain('"complete":false');
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    await reader.cancel();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("allows a single Beads scope to stop polling only after its mirror is ready", async () => {
    vi.useFakeTimers();
    mocks.detect.mockReturnValue("beads");
    const response = await GET(new NextRequest("http://localhost/api/beats/events?_repo=/beads"));
    const reader = response.body!.getReader();
    await reader.read();
    expect(decode((await reader.read()).value)).toContain('"complete":true');
    await reader.cancel();
    vi.useRealTimers();
  });
});
