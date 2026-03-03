import { describe, expect, it } from "vitest";
import { markAllNotificationsReadAndClose } from "@/components/notification-bell-actions";

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
