"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { buildBeatFocusHref, stripBeatPrefix } from "@/lib/beat-navigation";
import { markAllNotificationsReadAndClose } from "@/components/notification-bell-actions";
import {
  useNotificationStore,
  selectUnreadCount,
  type Notification,
} from "@/stores/notification-store";

export function NotificationBell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const unreadCount = useNotificationStore(selectUnreadCount);
  const notifications = useNotificationStore((s) => s.notifications);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const focusBeat = (beatId: string) => {
    router.push(buildBeatFocusHref(beatId, searchParams.toString()));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
          {unreadCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={() => markAllNotificationsReadAndClose({
                markAllRead,
                closeLightbox: () => setOpen(false),
              })}
            >
              Mark all as read
            </Button>
          )}
        </div>
        <NotificationList notifications={notifications} onFocusBeat={focusBeat} />
      </PopoverContent>
    </Popover>
  );
}

function NotificationList({
  notifications,
  onFocusBeat,
}: {
  notifications: readonly Notification[];
  onFocusBeat: (beatId: string) => void;
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
      {notifications.map((n) => {
          const beatId = n.beatId;
          return (
            <li
              key={n.id}
              className={`border-b px-3 py-2 text-sm last:border-b-0 ${
                n.read ? "text-muted-foreground" : "bg-muted/30"
              }`}
            >
              <p className="leading-snug">{n.message}</p>
              {beatId ? (
                <button
                  type="button"
                  className="mt-1 block font-mono text-[11px] text-primary underline-offset-4 transition-colors hover:text-primary/80 hover:underline"
                  title={`Focus ${beatId}`}
                  onClick={() => onFocusBeat(beatId)}
                >
                  {stripBeatPrefix(beatId)}
                </button>
              ) : null}
              <time className="mt-0.5 block text-[10px] text-muted-foreground">
                {new Date(n.timestamp).toLocaleTimeString()}
              </time>
            </li>
          );
      })}
    </ul>
  );
}
