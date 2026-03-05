import { create } from "zustand";

export interface Notification {
  id: string;
  message: string;
  beatId?: string;
  timestamp: number;
  read: boolean;
}

interface NotificationState {
  notifications: Notification[];
  addNotification: (
    notification: Omit<Notification, "id" | "timestamp" | "read">
  ) => void;
  markAllRead: () => void;
  clearAll: () => void;
}

let nextId = 1;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
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
}));

export function selectUnreadCount(state: NotificationState): number {
  return state.notifications.filter((n) => !n.read).length;
}
