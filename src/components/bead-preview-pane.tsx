import type { Bead } from "@/lib/types";

export function BeadPreviewPane({ bead }: { bead: Bead | null }) {
  if (!bead) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select a bead to preview
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 overflow-y-auto h-full">
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-1">Description</h3>
        <p className="text-sm whitespace-pre-wrap">{bead.description || "-"}</p>
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-1">Notes</h3>
        <p className="text-sm whitespace-pre-wrap">{bead.notes || "-"}</p>
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-1">Acceptance Criteria</h3>
        <p className="text-sm whitespace-pre-wrap">{bead.acceptance || "-"}</p>
      </div>
    </div>
  );
}
