"use client";

import {
  Check,
  ExternalLink,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  buildApprovalConsoleHref,
  formatApprovalDetailText,
  formatApprovalPrimaryText,
  type ApprovalEscalation,
} from "@/lib/approval-escalations";
import {
  approvalActionLabel,
  type ApprovalAction,
  type ApprovalEscalationStatus,
} from "@/lib/approval-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ApprovalEscalationsPanel(props: {
  approvals: ApprovalEscalation[];
  onDismiss: (id: string) => void;
  onManualAction: (id: string) => void;
  onApprovalAction: (
    approval: ApprovalEscalation,
    action: ApprovalAction,
  ) => void;
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
          onApprovalAction={props.onApprovalAction}
        />
      ))}
    </div>
  );
}

function ApprovalEscalationRow(props: {
  approval: ApprovalEscalation;
  onDismiss: (id: string) => void;
  onManualAction: (id: string) => void;
  onApprovalAction: (
    approval: ApprovalEscalation,
    action: ApprovalAction,
  ) => void;
}) {
  const { approval } = props;
  const consoleHref = buildApprovalConsoleHref(approval);
  const supportedActions = approval.supportedActions ?? [];
  const canUseActions = approval.status !== "unsupported";
  const isResponding = approval.status === "responding";
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
              {approvalStatusLabel(approval.status)}
            </Badge>
          </div>
          <p className="mt-1 text-muted-foreground">
            {formatApprovalDetailText(approval)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canUseActions && supportedActions.includes("approve") ? (
            <ApprovalActionButton
              action="approve"
              disabled={isResponding}
              onClick={(action) =>
                props.onApprovalAction(approval, action)}
            />
          ) : null}
          {canUseActions &&
          supportedActions.includes("always_approve") ? (
            <ApprovalActionButton
              action="always_approve"
              disabled={isResponding}
              onClick={(action) =>
                props.onApprovalAction(approval, action)}
            />
          ) : null}
          {canUseActions && supportedActions.includes("reject") ? (
            <ApprovalActionButton
              action="reject"
              disabled={isResponding}
              onClick={(action) =>
                props.onApprovalAction(approval, action)}
            />
          ) : null}
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
      <ApprovalStatusMessage approval={approval} />
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

function ApprovalActionButton(props: {
  action: ApprovalAction;
  disabled: boolean;
  onClick: (action: ApprovalAction) => void;
}) {
  const Icon = props.action === "approve"
    ? Check
    : props.action === "always_approve"
      ? ShieldCheck
      : X;
  return (
    <Button
      size="sm"
      variant={props.action === "reject" ? "ghost" : "default"}
      disabled={props.disabled}
      onClick={() => props.onClick(props.action)}
    >
      <Icon className="size-4" />
      {approvalActionLabel(props.action)}
    </Button>
  );
}

function ApprovalStatusMessage(props: {
  approval: ApprovalEscalation;
}) {
  const { approval } = props;
  if (
    approval.status === "unsupported" ||
    (approval.supportedActions ?? []).length === 0
  ) {
    return (
      <p className="mt-3 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        Programmatic approval is not available for this request.
        Handle it in the linked terminal context, then dismiss it here.
      </p>
    );
  }
  if (approval.status !== "reply_failed") return null;
  return (
    <p className="mt-3 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      Approval reply failed. Try again or handle it in the terminal.
    </p>
  );
}

function approvalStatusLabel(
  status: ApprovalEscalationStatus,
): string {
  switch (status) {
    case "manual_required":
      return "Manual action";
    case "responding":
      return "Responding";
    case "reply_failed":
      return "Reply failed";
    case "unsupported":
      return "Unsupported";
    default:
      return "Pending";
  }
}

function ApprovalMeta(props: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium text-foreground">{props.label}</dt>
      <dd className="truncate font-mono">{props.value}</dd>
    </div>
  );
}
