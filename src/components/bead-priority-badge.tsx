import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BeadPriority } from "@/lib/types";

const priorityConfig: Record<BeadPriority, { label: string; color: string }> = {
  0: {
    label: "P0",
    color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  },
  1: {
    label: "P1",
    color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  },
  2: {
    label: "P2",
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  },
  3: {
    label: "P3",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  },
  4: {
    label: "P4",
    color: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
  },
};

export function BeadPriorityBadge({
  priority: rawPriority,
  className,
}: {
  priority: BeadPriority;
  className?: string;
}) {
  const priority = rawPriority ?? 2;
  const config = priorityConfig[priority] ?? priorityConfig[2];
  return (
    <Badge variant="outline" className={cn(config.color, className)}>
      {config.label}
    </Badge>
  );
}
