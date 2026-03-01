import type { Beat } from "@/lib/types";

export function BeatPreviewPane({ beat }: { beat: Beat | null }) {
  if (!beat) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select a beat to preview
      </div>
    );
  }

  return (
    <div className="space-y-1 p-1 overflow-y-auto h-full">
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-1">Description</h3>
        <p className="text-sm whitespace-pre-wrap">{beat.description || "-"}</p>
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-1">Notes</h3>
        <p className="text-sm whitespace-pre-wrap">{beat.notes || "-"}</p>
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-1">Acceptance Criteria</h3>
        <p className="text-sm whitespace-pre-wrap">{beat.acceptance || "-"}</p>
      </div>
    </div>
  );
}
