import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BeadStatus } from "@/lib/types";

const statusColors: Record<BeadStatus, string> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  in_progress:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  blocked: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  deferred: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
  closed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
};

function formatStatus(status: BeadStatus): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function BeadStatusBadge({
  status,
  className,
}: {
  status: BeadStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(statusColors[status], className)}>
      {formatStatus(status)}
    </Badge>
  );
}
