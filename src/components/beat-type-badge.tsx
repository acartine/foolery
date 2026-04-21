import {
  Atom,
  Bug,
  CheckSquare,
  GitMerge,
  Layers,
  Lightbulb,
  Shield,
  Wrench,
  CircleDot,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const typeConfig: Record<
  string,
  { icon: React.ElementType; color: string }
> = {
  bug: {
    icon: Bug,
    color: "bg-rust-100 text-rust-700 dark:bg-rust-700 dark:text-rust-100",
  },
  feature: {
    icon: Lightbulb,
    color: "bg-feature-100 text-feature-700 dark:bg-feature-700 dark:text-feature-100",
  },
  task: {
    icon: CheckSquare,
    color: "bg-lake-100 text-lake-700 dark:bg-lake-700 dark:text-lake-100",
  },
  epic: {
    icon: Layers,
    color: "bg-epic-100 text-epic-700 dark:bg-epic-700 dark:text-epic-100",
  },
  work: {
    icon: Wrench,
    color: "bg-paper-200 text-ink-700 dark:bg-walnut-100 dark:text-paper-300",
  },
  chore: {
    icon: Wrench,
    color: "bg-paper-200 text-ink-700 dark:bg-walnut-100 dark:text-paper-300",
  },
  "merge-request": {
    icon: GitMerge,
    color: "bg-mr-100 text-mr-700 dark:bg-mr-700 dark:text-mr-100",
  },
  molecule: {
    icon: Atom,
    color: "bg-molecule-100 text-molecule-700 dark:bg-molecule-700 dark:text-molecule-100",
  },
  gate: {
    icon: Shield,
    color: "bg-gate-100 text-gate-700 dark:bg-gate-700 dark:text-gate-100",
  },
};

const defaultConfig = {
  icon: CircleDot,
  color: "bg-paper-200 text-ink-700 dark:bg-walnut-100 dark:text-paper-300",
};

function formatType(type: string): string {
  return (type ?? "work")
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function BeatTypeBadge({
  type: rawType,
  className,
}: {
  type: string;
  className?: string;
}) {
  const type = rawType ?? "work";
  const config = typeConfig[type] ?? defaultConfig;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={cn(config.color, className)}>
      <Icon className="size-3" />
      {formatType(type)}
    </Badge>
  );
}
