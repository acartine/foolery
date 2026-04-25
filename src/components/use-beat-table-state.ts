"use client";

import {
  useState,
  useCallback,
  useRef,
} from "react";
import {
  useRouter,
  useSearchParams,
} from "next/navigation";
import type { Beat } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";
import { useUpdateUrl } from "@/hooks/use-update-url";
import type {
  CascadeDescendant,
} from "@/lib/cascade-close";
import {
  getStoredExpandedIds,
  persistExpandedIds,
} from "@/components/beat-table-expand";
import {
  useUpdateBeatMutation,
  useCloseBeatMutation,
  useCascadeCloseMutation,
  useInitiateClose,
} from "@/components/beat-table-mutations";
import {
  useHierarchyData,
  useSortedData,
  usePaginatedData,
  useAllLabels,
  useChildCountMap,
  useCollapsedIds,
  useParentRollingBeatIds,
} from "@/components/beat-table-data";
import {
  useBeatTableColumns,
  buildTitleClick,
} from "@/components/beat-table-columns";
import type {
  TitleRenderOpts,
} from "@/components/beat-column-helpers";

type BeatTableInput = {
  data: Beat[];
  showRepoColumn: boolean;
  showAgentColumns: boolean;
  agentInfoByBeatId: Record<
    string,
    import("@/components/beat-columns").AgentInfo
  >;
  onSelectionChange?: (ids: string[]) => void;
  selectionVersion?: number;
  onOpenBeat?: (beat: Beat) => void;
  onShipBeat?: (beat: Beat) => void;
  shippingByBeatId: Record<string, string>;
  onAbortShipping?: (beatId: string) => void;
  sortTopLevelByPriorityUpdated: boolean;
};

// eslint-disable-next-line max-lines-per-function
export function useBeatTableState(
  input: BeatTableInput,
) {
  const {
    data,
    showRepoColumn,
    showAgentColumns,
    agentInfoByBeatId,
    selectionVersion,
    onOpenBeat,
    onShipBeat,
    shippingByBeatId,
    onAbortShipping,
    sortTopLevelByPriorityUpdated,
  } = input;

  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef =
    useRef<HTMLDivElement>(null);
  const [userSorted, setUserSorted] =
    useState(false);
  const [focusedRowId, setFocusedRowId] =
    useState<string | null>(null);
  const [notesOpen, setNotesOpen] =
    useState(false);
  const [notesBeat, setNotesBeat] =
    useState<Beat | null>(null);
  const [expandedIds, setExpandedIds] =
    useState<Set<string>>(getStoredExpandedIds);
  const [pageIdx, setPageIdx] = useState(0);
  const [cascadeOpen, setCascadeOpen] =
    useState(false);
  const [cascadeBeat, setCascadeBeat] =
    useState<Beat | null>(null);
  const [cascadeDesc, setCascadeDesc] =
    useState<CascadeDescendant[]>([]);
  const [cascadeLoading, setCascadeLoading] =
    useState(false);
  const { activeRepo, filters, pageSize } =
    useAppStore();
  const updateUrl = useUpdateUrl();
  const filtersKey = JSON.stringify(filters);

  const { mutate: doUpdate } =
    useUpdateBeatMutation(data);
  const { mutate: doClose } =
    useCloseBeatMutation(data);
  const { mutate: doCascade } =
    useCascadeCloseMutation(
      data, setCascadeOpen,
      setCascadeBeat, setCascadeDesc,
    );
  const initiateClose = useInitiateClose(
    data, doClose, setCascadeBeat,
    setCascadeLoading, setCascadeOpen,
    setCascadeDesc,
  );
  const toggleCollapse = useCallback(
    (id: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        persistExpandedIds(next);
        return next;
      });
    }, [],
  );

  const hierarchy = useHierarchyData(
    data,
    userSorted,
    sortTopLevelByPriorityUpdated,
  );
  const sorted = useSortedData(
    hierarchy, expandedIds,
  );
  const { paginatedData, manualPageCount } =
    usePaginatedData(sorted, pageSize, pageIdx);

  const sortedLen = sorted.length;

  const allLabels = useAllLabels(data);
  const childCountMap = useChildCountMap(data);
  const collapsedIds = useCollapsedIds(
    hierarchy, expandedIds,
  );
  const parentRolling = useParentRollingBeatIds(
    data, shippingByBeatId,
  );

  const columns = useBeatTableColumns({
    showRepoColumn, showAgentColumns,
    agentInfoByBeatId,
    handleUpdateBeat: doUpdate,
    onOpenBeat, searchParams, router,
    onShipBeat, shippingByBeatId,
    onAbortShipping, allLabels,
    initiateClose, collapsedIds,
    handleToggleCollapse: toggleCollapse,
    childCountMap,
    parentRollingBeatIds: parentRolling,
  });

  const onRowFocus = useCallback(
    (beat: Beat) => setFocusedRowId(beat.id), [],
  );

  const titleRenderOpts: TitleRenderOpts = {
    collapsedIds,
    onToggleCollapse: toggleCollapse,
    childCountMap,
    onTitleClick: buildTitleClick(
      onOpenBeat, searchParams, router,
    ),
    onUpdateBeat: (id, fields, repoPath) =>
      doUpdate({ id, fields, repoPath }),
    allLabels,
  };

  return {
    router, searchParams, containerRef,
    columns, paginatedData,
    focusedRowId, setFocusedRowId,
    onRowFocus, setUserSorted,
    manualPageCount, pageIdx, setPageIdx,
    pageSize, updateUrl,
    notesBeat, setNotesBeat,
    notesOpen, setNotesOpen,
    doUpdate, initiateClose,
    onShipBeat, shippingByBeatId,
    parentRolling, setExpandedIds,
    cascadeOpen, setCascadeOpen,
    cascadeBeat, setCascadeBeat,
    cascadeDesc, setCascadeDesc,
    cascadeLoading, doCascade,
    filtersKey, activeRepo, selectionVersion,
    sortedLen, titleRenderOpts,
  };
}
