"use client";

import {
  usePathname, useRouter, useSearchParams,
} from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  CreateBeatDialog,
} from "@/components/create-beat-dialog";
import { SettingsSheet } from "@/components/settings-sheet";
import { HotkeyHelp } from "@/components/hotkey-help";
import { useAppStore } from "@/stores/app-store";
import {
  selectPendingApprovalCount,
  useApprovalEscalationStore,
} from "@/stores/approval-escalation-store";
import {
  useHumanActionCount,
} from "@/hooks/use-human-action-count";
import {
  useScopeRefinementNotifications,
} from "@/hooks/use-scope-refinement-notifications";
import { parseBeatsView } from "@/lib/beats-view";
import {
  invalidateBeatListQueries,
} from "@/lib/beat-query-cache";
import {
  useVersionBanner,
  useCreateBeatFlow,
  useSettingsSheet,
  useBeatsViewSetter,
  useCreateBeatHotkey,
  useViewCycleHotkey,
  useTerminalToggleHotkey,
  useHotkeyHelpHotkey,
  useRepoCycleHotkey,
} from "./app-header-hooks";
import {
  buildApprovalsHref,
} from "@/lib/approval-escalations";
import {
  VersionBannerBar,
  ApprovalBannerBar,
  HeaderToolbar,
  ActionButton,
  ViewSwitcher,
} from "./app-header-parts";
import {
  useVersionUpdateAction,
} from "./version-update-action";

function useAppHeaderState() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { activeRepo } = useAppStore();
  const isBeats =
    pathname === "/beats" ||
    pathname.startsWith("/beats/");
  const beatsView = parseBeatsView(
    searchParams.get("view"),
  );
  const activeBeatId = searchParams.get("beat");
  const humanCount = useHumanActionCount(
    isBeats, beatsView === "finalcut",
  );
  const approvalCount = useApprovalEscalationStore(
    selectPendingApprovalCount,
  );
  useScopeRefinementNotifications();

  const vb = useVersionBanner();
  const create = useCreateBeatFlow();
  const settings = useSettingsSheet(
    searchParams, pathname, router,
  );
  const setView = useBeatsViewSetter(
    searchParams, router,
  );

  useCreateBeatHotkey(
    isBeats, beatsView,
    create.canCreate, create.openFlow,
  );
  useViewCycleHotkey(isBeats, beatsView, setView);
  useTerminalToggleHotkey(isBeats);
  const hotkeyOpen = useHotkeyHelpHotkey(isBeats);
  useRepoCycleHotkey();

  return {
    router, searchParams, queryClient,
    activeRepo, isBeats, beatsView,
    activeBeatId, humanCount, approvalCount,
    vb, create, settings, setView, hotkeyOpen,
  };
}

type AppHeaderState = ReturnType<typeof useAppHeaderState>;

function HeaderBanners({
  state,
  updateAction,
}: {
  state: AppHeaderState;
  updateAction: ReturnType<typeof useVersionUpdateAction>;
}) {
  return (
    <>
      {state.approvalCount > 0 ? (
        <ApprovalBannerBar
          count={state.approvalCount}
          onOpenApprovals={() => {
            state.router.push(
              buildApprovalsHref(state.activeRepo ?? undefined),
            );
          }}
        />
      ) : null}
      {state.vb.banner && !state.vb.dismissed ? (
        <VersionBannerBar
          banner={state.vb.banner}
          updateStatus={updateAction.status}
          onUpdateNow={updateAction.triggerUpdate}
          onDismiss={state.vb.dismiss}
        />
      ) : null}
    </>
  );
}

export function AppHeader() {
  const s = useAppHeaderState();
  const updateAction =
    useVersionUpdateAction();
  const showAction =
    s.beatsView === "queues" ||
    s.beatsView === "active" ||
    s.beatsView === "finalcut";

  const switcher = (
    <ViewSwitcher
      beatsView={s.beatsView}
      setView={s.setView}
      humanActionCount={s.humanCount}
      canCreate={s.create.canCreate}
      showAction={showAction}
      actionButton={
        <ActionButton
          beatsView={s.beatsView}
          shouldChooseRepo={
            s.create.shouldChooseRepo
          }
          menuOpen={s.create.menuOpen}
          setMenuOpen={s.create.setMenuOpen}
          registeredRepos={
            s.create.registeredRepos
          }
          openDialog={s.create.openDialog}
          openFlow={s.create.openFlow}
        />
      }
      openSettingsToRepos={
        s.settings.openToRepos
      }
    />
  );

  return (
    <>
      <header className="border-b border-border/70 bg-background/95 supports-[backdrop-filter]:bg-background/90 supports-[backdrop-filter]:backdrop-blur">
        <div className="mx-auto max-w-[95vw] px-4 py-2">
          <HeaderBanners
            state={s}
            updateAction={updateAction}
          />
          <HeaderToolbar
            activeBeatId={s.activeBeatId}
            activeRepo={s.activeRepo}
            router={s.router}
            searchParams={s.searchParams}
            onOpenSettings={() =>
              s.settings.handleOpenChange(true)
            }
            isBeatsRoute={s.isBeats}
            viewSwitcher={switcher}
          />
        </div>
      </header>
      {s.isBeats ? (
        <CreateBeatDialog
          open={s.create.createOpen}
          onOpenChange={s.create.setCreateOpen}
          onCreated={() => {
            s.create.setCreateOpen(false);
            s.create.setSelectedRepo(null);
            void invalidateBeatListQueries(
              s.queryClient,
            );
          }}
          repo={
            s.create.selectedRepo ??
            s.activeRepo
          }
        />
      ) : null}
      <HotkeyHelp
        open={s.isBeats && s.hotkeyOpen}
      />
      <SettingsSheet
        open={s.settings.effectiveOpen}
        onOpenChange={
          s.settings.handleOpenChange
        }
        initialSection={
          s.settings.effectiveSection
        }
      />
    </>
  );
}
