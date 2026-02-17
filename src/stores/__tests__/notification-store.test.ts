import { beforeEach, describe, expect, it } from "vitest";
import {
  useNotificationStore,
  selectUnreadCount,
} from "@/stores/notification-store";

describe("notification store", () => {
  beforeEach(() => {
    useNotificationStore.setState({
      notifications: [],
      lastVerificationCount: -1,
    });
  });

  it("adds a notification with generated id and timestamp", () => {
    const store = useNotificationStore.getState();
    store.addNotification({ message: "Test notification" });

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toBe("Test notification");
    expect(notifications[0].read).toBe(false);
    expect(notifications[0].id).toBeTruthy();
    expect(notifications[0].timestamp).toBeGreaterThan(0);
  });

  it("prepends new notifications (newest first)", () => {
    const store = useNotificationStore.getState();
    store.addNotification({ message: "First" });
    store.addNotification({ message: "Second" });

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(2);
    expect(notifications[0].message).toBe("Second");
    expect(notifications[1].message).toBe("First");
  });

  it("marks all notifications as read", () => {
    const store = useNotificationStore.getState();
    store.addNotification({ message: "One" });
    store.addNotification({ message: "Two" });

    store.markAllRead();

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications.every((n) => n.read)).toBe(true);
  });

  it("does not mutate state when markAllRead called with no unread", () => {
    const store = useNotificationStore.getState();
    store.addNotification({ message: "Read it" });
    store.markAllRead();

    const before = useNotificationStore.getState();
    store.markAllRead();
    const after = useNotificationStore.getState();

    expect(after).toBe(before);
  });

  it("clears all notifications", () => {
    const store = useNotificationStore.getState();
    store.addNotification({ message: "Temp" });
    store.clearAll();

    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it("selectUnreadCount returns correct count", () => {
    const store = useNotificationStore.getState();
    store.addNotification({ message: "A" });
    store.addNotification({ message: "B" });
    store.addNotification({ message: "C" });

    expect(selectUnreadCount(useNotificationStore.getState())).toBe(3);

    store.markAllRead();
    expect(selectUnreadCount(useNotificationStore.getState())).toBe(0);

    store.addNotification({ message: "D" });
    expect(selectUnreadCount(useNotificationStore.getState())).toBe(1);
  });

  it("stores optional beadId on notification", () => {
    const store = useNotificationStore.getState();
    store.addNotification({ message: "Bead ready", beadId: "foolery-42" });

    const n = useNotificationStore.getState().notifications[0];
    expect(n.beadId).toBe("foolery-42");
  });

  it("tracks lastVerificationCount", () => {
    const store = useNotificationStore.getState();
    expect(store.lastVerificationCount).toBe(-1);

    store.setLastVerificationCount(5);
    expect(useNotificationStore.getState().lastVerificationCount).toBe(5);
  });
});
