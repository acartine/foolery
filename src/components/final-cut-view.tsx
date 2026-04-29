"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Megaphone } from "lucide-react";
import {
  buildBeatsQueryKey,
  fetchBeatsForScope,
  resolveBeatsScope,
} from "@/lib/api";
import {
  sendApprovalAction,
} from "@/lib/terminal-api";
import { Badge } from "@/components/ui/badge";
import { BeatTable } from "@/components/beat-table";
import { ApprovalEscalationsPanel } from "@/components/approval-escalations-panel";
import { PerfProfiler } from "@/components/perf-profiler";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { withClientPerfSpan } from "@/lib/client-perf";
import { useAppStore } from "@/stores/app-store";
import {
  selectPendingApprovals,
  useApprovalEscalationStore,
} from "@/stores/approval-escalation-store";
import type { ApprovalEscalation } from "@/lib/approval-escalations";
import type { ApprovalAction } from "@/lib/approval-actions";
import type { Beat } from "@/lib/types";
import { useBeatsScreenWarmup } from "@/hooks/use-beats-screen-warmup";
import { RepoSwitchLoadingState } from "@/components/repo-switch-loading-state";
import { useRepoSwitchQueryState } from "@/hooks/use-repo-switch-query-state";

const HUMAN_ACTION_PARAMS: Record<string, string> = {
  requiresHumanAction: "true",
};

type EscalationsTab = "notes" | "approvals";

export function FinalCutView() {
  const { activeRepo, registeredRepos } = useAppStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectionVersion] = useState(0);
  const allApprovals = useApprovalEscalationStore(
    (s) => s.approvals,
  );
  const approvals = useMemo(
    () => selectPendingApprovals({ approvals: allApprovals }),
    [allApprovals],
  );
  const dismissApproval = useApprovalEscalationStore(
    (s) => s.dismissApproval,
  );
  const markManualAction = useApprovalEscalationStore(
    (s) => s.markManualAction,
  );
  const handleApprovalAction = useApprovalActionHandler();
  const scope = resolveBeatsScope(activeRepo, registeredRepos);
  const activeTab: EscalationsTab =
    searchParams.get("tab") === "approvals"
      ? "approvals"
      : "notes";

  const query = useQuery({
    queryKey: buildBeatsQueryKey(
      "finalcut",
      HUMAN_ACTION_PARAMS,
      scope,
    ),
    queryFn: () => withClientPerfSpan(
      "query",
      "beats:finalcut",
      () => fetchBeatsForScope(
        HUMAN_ACTION_PARAMS,
        scope,
        registeredRepos,
      ),
    ),
    enabled: Boolean(activeRepo) || registeredRepos.length > 0,
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
  const {
    data,
    isLoading,
  } = useRepoSwitchQueryState(scope.key, {
    data: query.data,
    error: query.error,
    fetchStatus: query.fetchStatus,
    isFetched: query.isFetched,
    isLoading: query.isLoading,
  });
  useBeatsScreenWarmup(
    "finalcut",
    !isLoading && data?.ok === true,
  );

  const allBeats: Beat[] = data?.ok ? (data.data ?? []) : [];

  // Only show top-level beats (no parent) and parent beats (have children).
  // Leaf children are excluded to reduce clutter in the Final Cut view.
  const parentIds = new Set(allBeats.map((b) => b.parent).filter(Boolean));
  const beats = allBeats.filter((b) => !b.parent || parentIds.has(b.id));

  const showRepoColumn = !activeRepo && registeredRepos.length > 1;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSelectionChange = useCallback((_ids: string[]) => {
    // selection tracked for potential bulk actions
  }, []);
  const handleTabChange = useCallback(
    (value: string) => {
      const next = value === "approvals" ? "approvals" : "notes";
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", "finalcut");
      if (next === "approvals") params.set("tab", "approvals");
      else params.delete("tab");
      router.replace(`/beats?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );
  return (
    <div className="space-y-4 pb-4">
      <EscalationsHeader
        beatCount={beats.length}
        approvalCount={approvals.length}
      />
      <EscalationsTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        beats={beats}
        approvals={approvals}
        isLoading={isLoading}
        showRepoColumn={showRepoColumn}
        selectionVersion={selectionVersion}
        onSelectionChange={handleSelectionChange}
        onDismissApproval={dismissApproval}
        onManualAction={markManualAction}
        onApprovalAction={handleApprovalAction}
      />
    </div>
  );
}

function useApprovalActionHandler() {
  const markApprovalResponding = useApprovalEscalationStore(
    (s) => s.markApprovalResponding,
  );
  const markApprovalResolved = useApprovalEscalationStore(
    (s) => s.markApprovalResolved,
  );
  const markApprovalUnsupported = useApprovalEscalationStore(
    (s) => s.markApprovalUnsupported,
  );
  const markApprovalFailed = useApprovalEscalationStore(
    (s) => s.markApprovalFailed,
  );
  return useCallback(
    async (
      approval: ApprovalEscalation,
      action: ApprovalAction,
    ) => {
      markApprovalResponding(approval.id, action);
      const result = await sendApprovalAction(
        approval.sessionId,
        approval.id,
        action,
      );
      if (!result.ok) {
        const message = result.error ??
          "Approval action failed";
        if (
          message.includes("not supported") ||
          message.includes("not_supported")
        ) {
          markApprovalUnsupported(approval.id, message);
        } else {
          markApprovalFailed(approval.id, message);
        }
        return;
      }
      markApprovalResolved(
        approval.id,
        action,
        result.data?.status,
      );
    },
    [
      markApprovalResponding,
      markApprovalResolved,
      markApprovalUnsupported,
      markApprovalFailed,
    ],
  );
}

function EscalationsHeader(props: {
  beatCount: number;
  approvalCount: number;
}) {
  const { beatCount, approvalCount } = props;
  return (
    <section className="rounded-2xl border bg-gradient-to-br from-paper-100 via-feature-100 to-ochre-100 p-4 dark:from-walnut-300 dark:via-walnut-200 dark:to-walnut-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Megaphone className="size-4" />
            Escalations
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Knots and beats that require a human-owned next step.
            This queue is explicit from profile ownership and state.
          </p>
        </div>
        <Badge variant="outline" className="border-feature-400 bg-feature-100 text-feature-700 dark:border-feature-700 dark:bg-feature-700/30 dark:text-feature-100">
          {beatCount} {beatCount === 1 ? "beat" : "beats"}
        </Badge>
        {approvalCount > 0 ? (
          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
            {approvalCount} approval{approvalCount === 1 ? "" : "s"}
          </Badge>
        ) : null}
      </div>
    </section>
  );
}

function EscalationsTabs(props: {
  activeTab: EscalationsTab;
  onTabChange: (value: string) => void;
  beats: Beat[];
  approvals: ApprovalEscalation[];
  isLoading: boolean;
  showRepoColumn: boolean;
  selectionVersion: number;
  onSelectionChange: (ids: string[]) => void;
  onDismissApproval: (id: string) => void;
  onManualAction: (id: string) => void;
  onApprovalAction: (
    approval: ApprovalEscalation,
    action: ApprovalAction,
  ) => void;
}) {
  return (
    <Tabs value={props.activeTab} onValueChange={props.onTabChange}>
      <EscalationsTabList
        beatCount={props.beats.length}
        approvalCount={props.approvals.length}
      />
      <TabsContent value="notes">
        <NotesWorkTab
          beats={props.beats}
          isLoading={props.isLoading}
          showRepoColumn={props.showRepoColumn}
          selectionVersion={props.selectionVersion}
          onSelectionChange={props.onSelectionChange}
        />
      </TabsContent>
      <TabsContent value="approvals">
        <ApprovalEscalationsPanel
          approvals={props.approvals}
          onDismiss={props.onDismissApproval}
          onManualAction={props.onManualAction}
          onApprovalAction={props.onApprovalAction}
        />
      </TabsContent>
    </Tabs>
  );
}

function EscalationsTabList(props: {
  beatCount: number;
  approvalCount: number;
}) {
  return (
    <TabsList className="w-fit">
      <TabsTrigger value="notes">
        <Megaphone className="size-4" />
        Human Beats
        {props.beatCount > 0 ? (
          <Badge variant="secondary" className="ml-1">
            {props.beatCount}
          </Badge>
        ) : null}
      </TabsTrigger>
      <TabsTrigger value="approvals">
        <CheckCircle2 className="size-4" />
        Approvals
        {props.approvalCount > 0 ? (
          <Badge variant="destructive" className="ml-1">
            {props.approvalCount}
          </Badge>
        ) : null}
      </TabsTrigger>
    </TabsList>
  );
}

function NotesWorkTab(props: {
  beats: Beat[];
  isLoading: boolean;
  showRepoColumn: boolean;
  selectionVersion: number;
  onSelectionChange: (ids: string[]) => void;
}) {
  if (props.isLoading) {
    return (
      <RepoSwitchLoadingState
        data-testid="repo-switch-loading-finalcut"
        label="Loading escalations queue..."
      />
    );
  }
  return (
    <PerfProfiler
      id="final-cut-view"
      interactionLabel="escalations"
      beatCount={props.beats.length}
    >
      <BeatTable
        data={props.beats}
        showRepoColumn={props.showRepoColumn}
        onSelectionChange={props.onSelectionChange}
        selectionVersion={props.selectionVersion}
      />
    </PerfProfiler>
  );
}
