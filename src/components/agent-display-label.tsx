import { Badge } from "@/components/ui/badge";
import {
  parseAgentDisplayParts,
  type AgentIdentityLike,
} from "@/lib/agent-identity";

interface AgentDisplayLabelProps {
  agent: AgentIdentityLike;
}

export function AgentDisplayLabel({ agent }: AgentDisplayLabelProps) {
  const { label, pills } = parseAgentDisplayParts(agent);

  return (
    <span className="flex max-w-full flex-wrap items-center gap-1.5">
      <span className="min-w-0 shrink truncate">{label}</span>
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
  );
}
