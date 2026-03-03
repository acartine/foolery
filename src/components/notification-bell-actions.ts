interface MarkAllNotificationsReadAndCloseArgs {
  markAllRead: () => void;
  closeLightbox: () => void;
}

export function markAllNotificationsReadAndClose({
  markAllRead,
  closeLightbox,
}: MarkAllNotificationsReadAndCloseArgs): void {
  markAllRead();
  closeLightbox();
}
