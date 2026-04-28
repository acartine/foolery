import { create } from "zustand";

export interface Notification {
  id: string;
  message: string;
  kind?: "general" | "approval";
  beatId?: string;
  repoPath?: string;
  href?: string;
  dedupeKey?: string;
  timestamp: number;
  read: boolean;
}

interface NotificationState {
  notifications: Notification[];
  addNotification: (
    notification: Omit<Notification, "id" | "timestamp" | "read">
  ) => boolean;
  markAllRead: () => void;
  clearAll: () => void;
}

let nextId = 1;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  addNotification: (notification) => {
    let added = false;
    set((state) => {
      if (
        notification.dedupeKey &&
        state.notifications.some(
          (n) => n.dedupeKey === notification.dedupeKey,
        )
      ) {
        return state;
      }
      added = true;
      return {
        notifications: [
          {
            ...notification,
            kind: notification.kind ?? "general",
            id: String(nextId++),
            timestamp: Date.now(),
            read: false,
          },
          ...state.notifications,
        ],
      };
    });
    return added;
  },
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
}));

export function selectUnreadCount(state: NotificationState): number {
  return state.notifications.filter((n) => !n.read).length;
}
