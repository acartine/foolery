"use client";

import { ExternalLink } from "lucide-react";
import {
  buildApprovalConsoleHref,
  formatApprovalDetailText,
  formatApprovalPrimaryText,
  type ApprovalEscalation,
} from "@/lib/approval-escalations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ApprovalEscalationsPanel(props: {
  approvals: ApprovalEscalation[];
  onDismiss: (id: string) => void;
  onManualAction: (id: string) => void;
}) {
  if (props.approvals.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        No pending approval requests.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {props.approvals.map((approval) => (
        <ApprovalEscalationRow
          key={approval.id}
          approval={approval}
          onDismiss={props.onDismiss}
          onManualAction={props.onManualAction}
        />
      ))}
    </div>
  );
}

function ApprovalEscalationRow(props: {
  approval: ApprovalEscalation;
  onDismiss: (id: string) => void;
  onManualAction: (id: string) => void;
}) {
  const { approval } = props;
  const consoleHref = buildApprovalConsoleHref(approval);
  return (
    <article className="rounded-md border bg-card px-4 py-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">
              {formatApprovalPrimaryText(approval)}
            </h3>
            <Badge variant="outline">
              {approval.adapter}
            </Badge>
            <Badge variant="secondary">
              {approval.status === "manual_required"
                ? "Manual action"
                : "Pending"}
            </Badge>
          </div>
          <p className="mt-1 text-muted-foreground">
            {formatApprovalDetailText(approval)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.onManualAction(approval.id)}
          >
            Manual action
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => props.onDismiss(approval.id)}
          >
            Dismiss
          </Button>
        </div>
      </div>
      <dl className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
        <ApprovalMeta label="Beat" value={approval.beatId ?? "-"} />
        <ApprovalMeta label="Session" value={approval.sessionId} />
        <ApprovalMeta label="Source" value={approval.source} />
      </dl>
      <p className="mt-3 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        Programmatic approve/deny is not wired for this request yet.
        Handle it in the linked terminal context, then dismiss it here.
      </p>
      {consoleHref ? (
        <a
          href={consoleHref}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          Open history context
          <ExternalLink className="size-3" />
        </a>
      ) : null}
    </article>
  );
}

function ApprovalMeta(props: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium text-foreground">{props.label}</dt>
      <dd className="truncate font-mono">{props.value}</dd>
    </div>
  );
}
