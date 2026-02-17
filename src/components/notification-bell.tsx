"use client";

import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  useNotificationStore,
  selectUnreadCount,
} from "@/stores/notification-store";

export function NotificationBell() {
  const unreadCount = useNotificationStore(selectUnreadCount);
  const notifications = useNotificationStore((s) => s.notifications);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clearAll = useNotificationStore((s) => s.clearAll);

  return (
    <Popover onOpenChange={(open) => { if (open) markAllRead(); }}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="relative size-8 shrink-0"
          title="Notifications"
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {notifications.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={clearAll}
            >
              Clear all
            </Button>
          )}
        </div>
        <NotificationList notifications={notifications} />
      </PopoverContent>
    </Popover>
  );
}

function NotificationList({
  notifications,
}: {
  notifications: readonly { id: string; message: string; timestamp: number; read: boolean }[];
}) {
  if (notifications.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-xs text-muted-foreground">
        No notifications
      </div>
    );
  }

  return (
    <ul className="max-h-64 overflow-y-auto">
      {notifications.map((n) => (
        <li
          key={n.id}
          className={`border-b px-3 py-2 text-sm last:border-b-0 ${
            n.read ? "text-muted-foreground" : "bg-muted/30"
          }`}
        >
          <p className="leading-snug">{n.message}</p>
          <time className="mt-0.5 block text-[10px] text-muted-foreground">
            {new Date(n.timestamp).toLocaleTimeString()}
          </time>
        </li>
      ))}
    </ul>
  );
}
