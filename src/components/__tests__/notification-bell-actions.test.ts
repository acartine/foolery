import { describe, expect, it, vi } from "vitest";
import {
  buildNotificationBeatFocusHref,
  focusNotificationBeat,
  markAllNotificationsReadAndClose,
  NOTIFICATION_BEAT_FOCUS_FAILURE_MARKER,
} from "@/components/notification-bell-actions";
import type { Beat, BdResult } from "@/lib/types";

describe("markAllNotificationsReadAndClose", () => {
  it("marks all notifications as read before closing the lightbox", () => {
    const calls: string[] = [];

    markAllNotificationsReadAndClose({
      markAllRead: () => {
        calls.push("markAllRead");
      },
      closeLightbox: () => {
        calls.push("closeLightbox");
      },
    });

    expect(calls).toEqual(["markAllRead", "closeLightbox"]);
  });
});

describe("buildNotificationBeatFocusHref", () => {
  it("forces queued beats onto the queues view before opening detail", () => {
    expect(
      buildNotificationBeatFocusHref({
        beat: makeBeat({
          state: "ready_for_implementation",
        }),
        currentSearch: "view=finalcut&q=alpha",
        repoPath: "/repos/foolery",
      }),
    ).toBe(
      "/beats?view=queues&q=alpha&repo=%2Frepos%2Ffoolery"
        + "&beat=foolery-18b6&detailRepo=%2Frepos%2Ffoolery",
    );
  });

  it("keeps active beats on the active view", () => {
    expect(
      buildNotificationBeatFocusHref({
        beat: makeBeat({
          state: "shipment",
        }),
        currentSearch: "view=active",
        repoPath: "/repos/foolery",
      }),
    ).toBe(
      "/beats?view=active&repo=%2Frepos%2Ffoolery"
        + "&beat=foolery-18b6&detailRepo=%2Frepos%2Ffoolery",
    );
  });

  it("fails loudly for terminal beats instead of silently choosing a view", () => {
    expect(() =>
      buildNotificationBeatFocusHref({
        beat: makeBeat({
          state: "shipped",
        }),
        currentSearch: "view=history",
        repoPath: "/repos/foolery",
      }),
    ).toThrow(NOTIFICATION_BEAT_FOCUS_FAILURE_MARKER);
  });
});

describe("focusNotificationBeat", () => {
  it("fetches the beat, activates the repo, and navigates to the correct list view", async () => {
    const setActiveRepo = vi.fn();
    const navigate = vi.fn();
    const fetchBeatById = vi.fn<
      (id: string, repo?: string) => Promise<BdResult<Beat>>
    >().mockResolvedValue({
      ok: true,
      data: makeBeat({
        state: "shipment",
      }),
    });

    await focusNotificationBeat({
      beatId: "foolery-18b6",
      currentSearch: "view=history&q=alpha",
      registeredRepos: [
        {
          name: "foolery",
          path: "/repos/foolery",
          addedAt: "2026-04-23T00:00:00.000Z",
        },
      ],
      setActiveRepo,
      navigate,
      fetchBeatById,
    });

    expect(fetchBeatById).toHaveBeenCalledWith(
      "foolery-18b6",
      "/repos/foolery",
    );
    expect(setActiveRepo).toHaveBeenCalledWith("/repos/foolery");
    expect(navigate).toHaveBeenCalledWith(
      "/beats?view=active&q=alpha&repo=%2Frepos%2Ffoolery"
        + "&beat=foolery-18b6&detailRepo=%2Frepos%2Ffoolery",
    );
  });

  it("logs a failure marker and skips navigation when beat fetch fails", async () => {
    const logError = vi.fn();
    const setActiveRepo = vi.fn();
    const navigate = vi.fn();

    await focusNotificationBeat({
      beatId: "foolery-18b6",
      currentSearch: "view=history",
      registeredRepos: [],
      setActiveRepo,
      navigate,
      logError,
      fetchBeatById: vi.fn().mockResolvedValue({
        ok: false,
        error: "not found",
      }),
    });

    expect(setActiveRepo).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      `${NOTIFICATION_BEAT_FOCUS_FAILURE_MARKER}: failed to fetch beat `
        + "foolery-18b6: not found",
    );
  });

  it("logs a failure marker and skips navigation when beat state is terminal", async () => {
    const logError = vi.fn();
    const setActiveRepo = vi.fn();
    const navigate = vi.fn();

    await focusNotificationBeat({
      beatId: "foolery-18b6",
      currentSearch: "view=history",
      registeredRepos: [],
      setActiveRepo,
      navigate,
      logError,
      fetchBeatById: vi.fn().mockResolvedValue({
        ok: true,
        data: makeBeat({
          state: "shipped",
        }),
      }),
    });

    expect(setActiveRepo).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining(NOTIFICATION_BEAT_FOCUS_FAILURE_MARKER),
    );
  });
});

function makeBeat(
  overrides: Partial<Beat> = {},
): Beat {
  return {
    id: "foolery-18b6",
    title: "Beat",
    type: "work",
    state: "implementation",
    profileId: "autopilot",
    priority: 2,
    labels: [],
    created: "2026-04-23T00:00:00.000Z",
    updated: "2026-04-23T00:00:00.000Z",
    ...overrides,
  };
}
