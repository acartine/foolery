import Link from "next/link";
import type { BeadDependency } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

interface DepTreeProps {
  deps: BeadDependency[];
  beadId: string;
}

export function DepTree({ deps, beadId }: DepTreeProps) {
  if (deps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No dependencies found.</p>
    );
  }

  return (
    <ul className="space-y-2">
      {deps.map((dep) => {
        let linkedId: string | undefined;
        if (dep.source && dep.target) {
          linkedId = dep.source === beadId ? dep.target : dep.source;
        } else {
          linkedId = dep.id;
        }

        if (!linkedId) return null;

        const depType = dep.type ?? dep.dependency_type ?? "depends";
        return (
          <li key={dep.id} className="flex items-center gap-2 text-sm">
            <Badge variant="outline">{depType}</Badge>
            <Link
              href={`/beads/${linkedId}`}
              className="text-primary hover:underline font-mono text-xs"
            >
              {linkedId.slice(0, 8)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
