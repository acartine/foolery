import {
  Atom,
  Bug,
  CheckSquare,
  GitMerge,
  Layers,
  Lightbulb,
  Shield,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BeadType } from "@/lib/types";

const typeConfig: Record<
  BeadType,
  { icon: React.ElementType; color: string }
> = {
  bug: {
    icon: Bug,
    color: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  },
  feature: {
    icon: Lightbulb,
    color: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  },
  task: {
    icon: CheckSquare,
    color: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  },
  epic: {
    icon: Layers,
    color: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400",
  },
  chore: {
    icon: Wrench,
    color: "bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-400",
  },
  "merge-request": {
    icon: GitMerge,
    color: "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400",
  },
  molecule: {
    icon: Atom,
    color: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-400",
  },
  gate: {
    icon: Shield,
    color: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400",
  },
};

function formatType(type: BeadType): string {
  return (type ?? "task")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function BeadTypeBadge({
  type: rawType,
  className,
}: {
  type: BeadType;
  className?: string;
}) {
  const type = rawType ?? "task";
  const config = typeConfig[type] ?? typeConfig.task;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={cn(config.color, className)}>
      <Icon className="size-3" />
      {formatType(type)}
    </Badge>
  );
}
