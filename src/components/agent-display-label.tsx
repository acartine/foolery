import { Badge } from "@/components/ui/badge";
import {
  parseAgentDisplayParts,
  type AgentIdentityLike,
} from "@/lib/agent-identity";
import { cn } from "@/lib/utils";

interface AgentDisplayLabelProps {
  agent: AgentIdentityLike;
  layout?: "inline" | "stacked";
}

export function AgentDisplayLabel({
  agent,
  layout = "inline",
}: AgentDisplayLabelProps) {
  const { label, pills } = parseAgentDisplayParts(agent);
  const isStacked = layout === "stacked";

  return (
    <span
      className={cn(
        "max-w-full",
        isStacked ? "inline-flex flex-col items-start gap-1" : "inline-flex items-center gap-1.5",
      )}
    >
      <span className={cn(isStacked ? "block max-w-full truncate" : "truncate")}>
        {label}
      </span>
      {isStacked ? (
        <span className="flex max-w-full flex-wrap items-center gap-1.5">
          {pills.map((pill) => (
            <Badge
              key={pill}
              variant="secondary"
              className="text-[10px] px-1.5 py-0 h-4 font-normal shrink-0"
            >
              {pill}
            </Badge>
          ))}
        </span>
      ) : pills.map((pill) => (
        <Badge
          key={pill}
          variant="secondary"
          className="text-[10px] px-1.5 py-0 h-4 font-normal shrink-0"
        >
          {pill}
        </Badge>
      ))}
    </span>
  );
}
