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
import {
  formatAgentDisplayLabel,
} from "@/lib/agent-identity";
import type { ScopedApproval } from "@/lib/approval-repo-scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ApprovalEscalationsPanel(props: {
  approvals: ScopedApproval[];
  onDismiss: (id: string) => void;
  onManualAction: (id: string) => void;
  onApprovalAction: (
    approval: ApprovalEscalation,
    action: ApprovalAction,
  ) => void;
}) {
  if (props.approvals.length === 0) {
    return (
      <div
        className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"
        data-testid="approvals-empty"
      >
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
  approval: ScopedApproval;
  onDismiss: (id: string) => void;
  onManualAction: (id: string) => void;
  onApprovalAction: (
    approval: ApprovalEscalation,
    action: ApprovalAction,
  ) => void;
}) {
  const { approval } = props;
  const consoleHref = buildApprovalConsoleHref(approval);
  const detailText = formatApprovalDetailText(approval);
  return (
    <article
      className="rounded-md border bg-card px-4 py-3 text-sm shadow-sm"
      data-approval-id={approval.id}
      data-cross-repo={approval.isCrossRepo ? "true" : "false"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ApprovalRowSummary
          approval={approval}
          detailText={detailText}
        />
        <ApprovalRowActions
          approval={approval}
          onApprovalAction={props.onApprovalAction}
          onDismiss={props.onDismiss}
          onManualAction={props.onManualAction}
        />
      </div>
      <ApprovalRowMeta approval={approval} />
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

function ApprovalRowSummary(props: {
  approval: ScopedApproval;
  detailText: string;
}) {
  const { approval, detailText } = props;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">
          {formatApprovalPrimaryText(approval)}
        </h3>
        <Badge variant="outline">{approval.adapter}</Badge>
        <Badge variant="secondary">
          {approvalStatusLabel(approval.status)}
        </Badge>
        {approval.isCrossRepo && approval.repoPath ? (
          <Badge
            variant="outline"
            className="border-feature-500/40 bg-feature-100 text-feature-700 dark:border-feature-400/40 dark:bg-feature-700/30 dark:text-feature-100"
            data-testid="approval-cross-repo-badge"
          >
            {`Other repo: ${shortRepoPath(approval.repoPath)}`}
          </Badge>
        ) : null}
      </div>
      <p
        className="mt-1 break-all text-muted-foreground"
        data-testid="approval-detail"
      >
        {detailText}
      </p>
    </div>
  );
}

function ApprovalRowActions(props: {
  approval: ScopedApproval;
  onDismiss: (id: string) => void;
  onManualAction: (id: string) => void;
  onApprovalAction: (
    approval: ApprovalEscalation,
    action: ApprovalAction,
  ) => void;
}) {
  const { approval } = props;
  const supportedActions = approval.supportedActions ?? [];
  const canUseActions = approval.status !== "unsupported";
  const isResponding = approval.status === "responding";
  const onClick = (action: ApprovalAction) =>
    props.onApprovalAction(approval, action);
  return (
    <div className="flex shrink-0 items-center gap-2">
      {canUseActions && supportedActions.includes("approve") ? (
        <ApprovalActionButton
          action="approve"
          disabled={isResponding}
          onClick={onClick}
        />
      ) : null}
      {canUseActions
      && supportedActions.includes("always_approve") ? (
          <ApprovalActionButton
            action="always_approve"
            disabled={isResponding}
            onClick={onClick}
          />
        ) : null}
      {canUseActions && supportedActions.includes("reject") ? (
        <ApprovalActionButton
          action="reject"
          disabled={isResponding}
          onClick={onClick}
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
  );
}

function ApprovalRowMeta(props: { approval: ScopedApproval }) {
  const { approval } = props;
  const agentLabel = approvalAgentLabel(approval);
  const createdLabel = formatRelativeTimestamp(approval.createdAt);
  const createdIso = new Date(approval.createdAt).toISOString();
  return (
    <dl className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
      <ApprovalMeta label="Beat" value={approval.beatId ?? "-"} />
      <ApprovalMeta label="Session" value={approval.sessionId} />
      <ApprovalMeta label="Source" value={approval.source} />
      {agentLabel ? (
        <ApprovalMeta
          label="Agent"
          value={agentLabel}
          testId="approval-agent"
        />
      ) : null}
      <ApprovalMeta
        label="Detected"
        value={createdLabel}
        title={createdIso}
        testId="approval-created"
      />
      {approval.repoPath ? (
        <ApprovalMeta
          label="Repo"
          value={shortRepoPath(approval.repoPath)}
          title={approval.repoPath}
        />
      ) : null}
    </dl>
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
      data-approval-action={props.action}
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

function ApprovalMeta(props: {
  label: string;
  value: string;
  title?: string;
  testId?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="font-medium text-foreground">{props.label}</dt>
      <dd
        className="truncate font-mono"
        title={props.title ?? props.value}
        data-testid={props.testId}
      >
        {props.value}
      </dd>
    </div>
  );
}

export function approvalAgentLabel(
  approval: Pick<
    ApprovalEscalation,
    "agentName" | "agentModel" | "agentVersion" | "agentCommand"
  >,
): string | null {
  if (
    !approval.agentName
    && !approval.agentModel
    && !approval.agentVersion
    && !approval.agentCommand
  ) {
    return null;
  }
  return formatAgentDisplayLabel({
    command: approval.agentCommand,
    model: approval.agentModel,
    version: approval.agentVersion,
    label: approval.agentName,
  });
}

function shortRepoPath(repoPath: string): string {
  const parts = repoPath.split("/").filter(Boolean);
  if (parts.length === 0) return repoPath;
  return parts.length <= 2 ? repoPath : `…/${parts.slice(-2).join("/")}`;
}

function formatRelativeTimestamp(value: number): string {
  const now = Date.now();
  const delta = now - value;
  if (Number.isNaN(delta)) return "unknown";
  const absDelta = Math.abs(delta);
  if (absDelta < 5_000) return "just now";
  const seconds = Math.floor(absDelta / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
