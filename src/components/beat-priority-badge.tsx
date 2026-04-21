import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BeatPriority } from "@/lib/types";

const priorityConfig: Record<BeatPriority, { label: string; color: string }> = {
  0: {
    label: "P0",
    color: "bg-rust-100 text-rust-700 dark:bg-rust-700 dark:text-rust-100",
  },
  1: {
    label: "P1",
    color: "bg-ochre-100 text-ochre-700 dark:bg-ochre-700 dark:text-ochre-100",
  },
  2: {
    label: "P2",
    color: "bg-ochre-100 text-ochre-700 dark:bg-ochre-700 dark:text-ochre-100",
  },
  3: {
    label: "P3",
    color: "bg-lake-100 text-lake-700 dark:bg-lake-700 dark:text-lake-100",
  },
  4: {
    label: "P4",
    color: "bg-paper-200 text-ink-700 dark:bg-walnut-100 dark:text-paper-300",
  },
};

export function BeatPriorityBadge({
  priority: rawPriority,
  className,
}: {
  priority: BeatPriority;
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
