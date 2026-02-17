import { create } from "zustand";

export interface Notification {
  id: string;
  message: string;
  beadId?: string;
  timestamp: number;
  read: boolean;
}

interface NotificationState {
  notifications: Notification[];
  /** Last known count of verification beads, used for change detection. */
  lastVerificationCount: number;
  addNotification: (
    notification: Omit<Notification, "id" | "timestamp" | "read">
  ) => void;
  markAllRead: () => void;
  clearAll: () => void;
  setLastVerificationCount: (count: number) => void;
}

let nextId = 1;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  lastVerificationCount: -1,
  addNotification: (notification) =>
    set((state) => ({
      notifications: [
        {
          ...notification,
          id: String(nextId++),
          timestamp: Date.now(),
          read: false,
        },
        ...state.notifications,
      ],
    })),
  markAllRead: () =>
    set((state) => {
      const hasUnread = state.notifications.some((n) => !n.read);
      if (!hasUnread) return state;
      return {
        notifications: state.notifications.map((n) =>
          n.read ? n : { ...n, read: true }
        ),
      };
    }),
  clearAll: () => set({ notifications: [] }),
  setLastVerificationCount: (count) =>
    set({ lastVerificationCount: count }),
}));

export function selectUnreadCount(state: NotificationState): number {
  return state.notifications.filter((n) => !n.read).length;
}
