import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import type { Bead } from "@/lib/types";
import { BeadStatusBadge } from "@/components/bead-status-badge";
import { BeadPriorityBadge } from "@/components/bead-priority-badge";
import { BeadTypeBadge } from "@/components/bead-type-badge";

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function BeadDetail({ bead }: { bead: Bead }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{bead.title}</CardTitle>
          <code className="text-xs text-muted-foreground">{bead.id}</code>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <BeadTypeBadge type={bead.type} />
            <BeadStatusBadge status={bead.status} />
            <BeadPriorityBadge priority={bead.priority} />
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Assignee</span>
              <p>{bead.assignee ?? "-"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Owner</span>
              <p>{bead.owner ?? "-"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Created</span>
              <p>{formatDate(bead.created)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Updated</span>
              <p>{formatDate(bead.updated)}</p>
            </div>
            {bead.due && (
              <div>
                <span className="text-muted-foreground">Due</span>
                <p>{formatDate(bead.due)}</p>
              </div>
            )}
            {bead.estimate != null && (
              <div>
                <span className="text-muted-foreground">Estimate</span>
                <p>{bead.estimate}h</p>
              </div>
            )}
          </div>

          {bead.labels.length > 0 && (
            <>
              <Separator />
              <div className="flex gap-1 flex-wrap">
                {bead.labels.map((label) => (
                  <Badge key={label} variant="secondary">
                    {label}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {bead.description && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{bead.description}</p>
          </CardContent>
        </Card>
      )}

      {bead.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{bead.notes}</p>
          </CardContent>
        </Card>
      )}

      {bead.acceptance && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Acceptance Criteria</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{bead.acceptance}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
