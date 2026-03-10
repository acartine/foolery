import Link from "next/link";
import type { BeatDependency } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { displayBeatLabel, stripBeatPrefix } from "@/lib/beat-display";

interface DepTreeProps {
  deps: BeatDependency[];
  beatId: string;
  repo?: string;
}

/** Derive the display label and linked beat ID from a dependency edge. */
function resolveEdge(dep: BeatDependency, beatId: string) {
  let linkedId: string | undefined;
  let depLabel: string;

  if (dep.source && dep.target) {
    linkedId = dep.source === beatId ? dep.target : dep.source;
    depLabel = dep.source === beatId ? "blocks" : "blocked by";
  } else {
    linkedId = dep.id;
    depLabel = dep.type ?? dep.dependency_type ?? "depends";
  }

  return { linkedId, depLabel };
}

export function DepTree({ deps, beatId, repo }: DepTreeProps) {
  if (deps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No dependencies found.</p>
    );
  }

  // Group deps by their resolved label
  const groups = new Map<string, { linkedId: string; dep: BeatDependency }[]>();

  for (const dep of deps) {
    const { linkedId, depLabel } = resolveEdge(dep, beatId);
    if (!linkedId) continue;

    let group = groups.get(depLabel);
    if (!group) {
      group = [];
      groups.set(depLabel, group);
    }
    group.push({ linkedId, dep });
  }

  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([label, items]) => (
        <div key={label} className="space-y-1">
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {items.map(({ linkedId, dep }) => {
              const shortId = stripBeatPrefix(linkedId);
              const displayId = displayBeatLabel(linkedId, dep.aliases);
              const params = new URLSearchParams({ beat: linkedId });
              if (repo) params.set("detailRepo", repo);
              return (
                <Link
                  key={dep.id}
                  href={`/beats?${params.toString()}`}
                  className="no-underline"
                >
                  <Badge
                    variant="outline"
                    className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-xs hover:bg-accent"
                  >
                    <span>{displayId}</span>
                    {displayId !== shortId && (
                      <span className="text-[10px] text-muted-foreground">{shortId}</span>
                    )}
                  </Badge>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
