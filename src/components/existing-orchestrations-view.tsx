"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Clapperboard,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  ThumbsDown,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchBeads, fetchDeps, updateBead, closeBead } from "@/lib/api";
import { verifyBeadFields, rejectBeadFields } from "@/components/bead-columns";
import { restageOrchestration } from "@/lib/orchestration-api";
import {
  ORCHESTRATION_RESTAGE_DRAFT_KEY,
  type OrchestrationRestageDraft,
} from "@/lib/orchestration-restage";
import { startSession } from "@/lib/terminal-api";
import type { Bead, BeadDependency, OrchestrationPlan } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";
import { useTerminalStore } from "@/stores/terminal-store";
import {
  ORCHESTRATION_WAVE_LABEL,
  allocateWaveSlug,
  buildWaveSlugLabel,
  buildWaveTitle,
  extractWaveSlug,
  getWaveSlugLabels,
  isLegacyNumericWaveSlug,
  normalizeWaveSlugCandidate,
  rewriteWaveTitleSlug,
} from "@/lib/wave-slugs";

interface ExistingOrchestrationData {
  beads: Bead[];
  waves: Bead[];
  depsByWaveId: Record<string, BeadDependency[]>;
}

interface HierarchyNode {
  id: string;
  title: string;
  type: Bead["type"];
  status: Bead["status"];
  priority: Bead["priority"];
  children: HierarchyNode[];
}

interface WaveCard {
  id: string;
  slug: string;
  title: string;
  name: string;
  bead: Bead;
  children: HierarchyNode[];
  maxDepth: number;
  descendants: number;
}

interface OrchestrationTree {
  id: string;
  label: string;
  displayLabel: string;
  waves: WaveCard[];
  maxDepth: number;
  updatedAt: string;
}

interface ParsedOrchestration {
  trees: OrchestrationTree[];
  waves: WaveCard[];
}

interface MigrationPlan {
  waveId: string;
  newSlug: string;
  removeLabels: string[];
  newTitle: string;
}

type NavigationLevel = "tree" | "wave" | "child";

const MIN_ZOOM_DEPTH = 2;

function isWaveBead(bead: Bead): boolean {
  return bead.labels?.includes(ORCHESTRATION_WAVE_LABEL);
}

function toEpochMs(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function compareByTimestamp(a: Bead, b: Bead): number {
  const updatedDiff = toEpochMs(b.updated) - toEpochMs(a.updated);
  if (updatedDiff !== 0) return updatedDiff;
  const createdDiff = toEpochMs(b.created) - toEpochMs(a.created);
  if (createdDiff !== 0) return createdDiff;
  return a.id.localeCompare(b.id);
}

function parseWaveName(title: string): string {
  const stripped = title.replace(/^(?:wave|scene)\s+[^:]+:\s*/i, "").trim();
  return stripped || title;
}

function stripIssuePrefix(id: string): string {
  const delimiterIndex = id.indexOf("-");
  if (delimiterIndex < 0 || delimiterIndex === id.length - 1) return id;
  return id.slice(delimiterIndex + 1);
}


function parseDescriptionLine(
  description: string | undefined,
  label: string
): string | undefined {
  if (!description) return undefined;
  const pattern = new RegExp(`(?:^|\\n)${label}\\s*(.+?)(?:\\n|$)`, "i");
  const match = description.match(pattern);
  if (!match?.[1]) return undefined;
  const value = match[1].trim();
  return value || undefined;
}

function parseWaveObjective(description: string | undefined): string {
  return (
    parseDescriptionLine(description, "Objective:") ??
    "Execute assigned beats for this section."
  );
}

function parseWaveNotes(description: string | undefined): string | undefined {
  return parseDescriptionLine(description, "Notes:");
}

function countHierarchyNodes(nodes: HierarchyNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countHierarchyNodes(node.children), 0);
}

function measureDepth(nodes: HierarchyNode[], depth: number): number {
  if (nodes.length === 0) return depth;
  let maxDepth = depth;
  for (const node of nodes) {
    maxDepth = Math.max(maxDepth, measureDepth(node.children, depth + 1));
  }
  return maxDepth;
}

function buildRestagePlan(tree: OrchestrationTree): OrchestrationPlan {
  const waves = tree.waves
    .map((wave, index) => ({
      waveIndex: index + 1,
      name: wave.name,
      objective: parseWaveObjective(wave.bead.description),
      agents: [],
      beads: wave.children.map((child) => ({
        id: child.id,
        title: child.title,
      })),
      notes: parseWaveNotes(wave.bead.description),
    }))
    .filter((wave) => wave.beads.length > 0);

  return {
    summary: `Restaged ${waves.length} section${
      waves.length === 1 ? "" : "s"
    } from tree ${tree.label}.`,
    waves,
    unassignedBeadIds: [],
    assumptions: [`Restaged from existing scene tree ${tree.label}.`],
  };
}

function buildRestageWaveEdits(
  tree: OrchestrationTree
): Record<string, { name: string; slug: string }> {
  return Object.fromEntries(
    tree.waves.map((wave, index) => [
      String(index + 1),
      { name: wave.name, slug: wave.slug },
    ])
  );
}

function buildChildrenIndex(beads: Bead[]): Map<string, Bead[]> {
  const byId = new Map(beads.map((bead) => [bead.id, bead]));
  const byParent = new Map<string, Bead[]>();

  const resolveVisibleParentId = (bead: Bead): string | undefined => {
    const parentId = bead.parent;
    if (!parentId) return undefined;
    const parent = byId.get(parentId);
    if (!parent) return undefined;
    if (parent.status === "closed") return undefined;
    return parent.id;
  };

  for (const bead of beads) {
    if (bead.status === "closed") continue;
    const parentId = resolveVisibleParentId(bead);
    if (!parentId) continue;
    const list = byParent.get(parentId) ?? [];
    list.push(bead);
    byParent.set(parentId, list);
  }
  for (const [parent, list] of byParent.entries()) {
    byParent.set(
      parent,
      list.slice().sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.id.localeCompare(b.id);
      })
    );
  }
  return byParent;
}

function buildNode(
  bead: Bead,
  byParent: Map<string, Bead[]>,
  seen: Set<string>
): HierarchyNode {
  if (seen.has(bead.id)) {
    return {
      id: bead.id,
      title: bead.title,
      type: bead.type,
      status: bead.status,
      priority: bead.priority,
      children: [],
    };
  }
  seen.add(bead.id);
  const children = (byParent.get(bead.id) ?? []).map((child) =>
    buildNode(child, byParent, seen)
  );
  seen.delete(bead.id);
  return {
    id: bead.id,
    title: bead.title,
    type: bead.type,
    status: bead.status,
    priority: bead.priority,
    children,
  };
}

function parseExistingOrchestrations(data: ExistingOrchestrationData): ParsedOrchestration {
  const waves = data.waves
    .filter((wave) => wave.status !== "closed")
    .slice()
    .sort(compareByTimestamp);
  const waveIds = new Set(waves.map((wave) => wave.id));
  const byParent = buildChildrenIndex(data.beads);

  const waveCards = new Map<string, WaveCard>();
  for (const wave of waves) {
    const slug = extractWaveSlug(wave.labels) ?? wave.id.toLowerCase();
    const children = (byParent.get(wave.id) ?? []).map((child) =>
      buildNode(child, byParent, new Set([wave.id]))
    );
    waveCards.set(wave.id, {
      id: wave.id,
      slug,
      title: wave.title,
      name: parseWaveName(wave.title),
      bead: wave,
      children,
      maxDepth: measureDepth(children, 2),
      descendants: countHierarchyNodes(children),
    });
  }

  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  const undirected = new Map<string, Set<string>>();
  for (const wave of waves) {
    incoming.set(wave.id, new Set());
    outgoing.set(wave.id, new Set());
    undirected.set(wave.id, new Set());
  }

  for (const wave of waves) {
    const deps = data.depsByWaveId[wave.id] ?? [];
    for (const dep of deps) {
      if (dep.dependency_type !== "blocks") continue;
      if (!dep.id || !waveIds.has(dep.id)) continue;
      incoming.get(wave.id)?.add(dep.id);
      outgoing.get(dep.id)?.add(wave.id);
      undirected.get(wave.id)?.add(dep.id);
      undirected.get(dep.id)?.add(wave.id);
    }
  }

  const byId = new Map(waves.map((wave) => [wave.id, wave]));
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const wave of waves) {
    if (visited.has(wave.id)) continue;
    const stack = [wave.id];
    const component: string[] = [];
    visited.add(wave.id);
    while (stack.length > 0) {
      const current = stack.pop() as string;
      component.push(current);
      for (const neighbor of undirected.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
    components.push(component);
  }

  const trees: OrchestrationTree[] = components.map((component, index) => {
    const componentSet = new Set(component);
    const localIncoming = new Map<string, number>();
    for (const id of component) {
      const count = Array.from(incoming.get(id) ?? []).filter((parentId) =>
        componentSet.has(parentId)
      ).length;
      localIncoming.set(id, count);
    }

    const queue = component
      .filter((id) => (localIncoming.get(id) ?? 0) === 0)
      .sort((a, b) =>
        (byId.get(a)?.created ?? "").localeCompare(byId.get(b)?.created ?? "")
      );
    const ordered: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      ordered.push(id);
      for (const childId of outgoing.get(id) ?? []) {
        if (!componentSet.has(childId)) continue;
        const nextCount = (localIncoming.get(childId) ?? 0) - 1;
        localIncoming.set(childId, nextCount);
        if (nextCount === 0) {
          queue.push(childId);
          queue.sort((a, b) =>
            (byId.get(a)?.created ?? "").localeCompare(byId.get(b)?.created ?? "")
          );
        }
      }
    }

    if (ordered.length < component.length) {
      const remaining = component
        .filter((id) => !ordered.includes(id))
        .sort((a, b) =>
          (byId.get(a)?.created ?? "").localeCompare(byId.get(b)?.created ?? "")
        );
      ordered.push(...remaining);
    }

    const waveCardsInTree = ordered
      .map((id) => waveCards.get(id))
      .filter((wave): wave is WaveCard => Boolean(wave));
    const fallbackLabel = `tree-${index + 1}`;
    const rootWave = waveCardsInTree[0];
    const label = rootWave?.slug ?? fallbackLabel;
    const displayLabel = rootWave ? `${rootWave.id} ${rootWave.slug}` : fallbackLabel;
    const maxDepth = waveCardsInTree.reduce(
      (max, waveCard) => Math.max(max, waveCard.maxDepth),
      MIN_ZOOM_DEPTH
    );
    const updatedAt = waveCardsInTree
      .map((waveCard) => waveCard.bead.updated)
      .sort()
      .at(-1) ?? "";
    return {
      id: `${label}-${index}-${waveCardsInTree.map((waveCard) => waveCard.id).join("-")}`,
      label,
      displayLabel,
      waves: waveCardsInTree,
      maxDepth,
      updatedAt,
    };
  });

  trees.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    trees,
    waves: Array.from(waveCards.values()),
  };
}

async function loadExistingOrchestrations(
  repoPath: string
): Promise<ExistingOrchestrationData> {
  const beadsResult = await fetchBeads(undefined, repoPath);
  if (!beadsResult.ok || !beadsResult.data) {
    throw new Error(beadsResult.error ?? "Failed to load beads");
  }

  const beads = beadsResult.data;
  const waves = beads.filter(isWaveBead);
  const depResults = await Promise.all(
    waves.map(async (wave) => {
      const deps = await fetchDeps(wave.id, repoPath);
      return [wave.id, deps.ok ? deps.data ?? [] : []] as const;
    })
  );

  return {
    beads,
    waves,
    depsByWaveId: Object.fromEntries(depResults),
  };
}

function buildMigrationPlan(waves: Bead[]): MigrationPlan[] {
  const used = new Set<string>();
  const sorted = waves.slice().sort((a, b) => a.created.localeCompare(b.created));
  for (const wave of sorted) {
    const slug = extractWaveSlug(wave.labels);
    if (!slug || isLegacyNumericWaveSlug(slug)) continue;
    used.add(slug);
  }

  const updates: MigrationPlan[] = [];
  for (const wave of sorted) {
    const slug = extractWaveSlug(wave.labels);
    if (slug && !isLegacyNumericWaveSlug(slug)) continue;
    const newSlug = allocateWaveSlug(used);
    const removeLabels = getWaveSlugLabels(wave.labels ?? []);
    updates.push({
      waveId: wave.id,
      newSlug,
      removeLabels,
      newTitle: rewriteWaveTitleSlug(wave.title, newSlug),
    });
  }
  return updates;
}

function statusTone(status: Bead["status"]): string {
  if (status === "in_progress") return "bg-blue-100 text-blue-700";
  if (status === "blocked") return "bg-amber-100 text-amber-800";
  if (status === "closed") return "bg-zinc-200 text-zinc-700";
  if (status === "deferred") return "bg-violet-100 text-violet-700";
  return "bg-emerald-100 text-emerald-700";
}

function rotateIndex(current: number, size: number, direction: -1 | 1): number {
  if (size <= 1) return 0;
  return (current + direction + size) % size;
}

function HierarchyList({
  nodes,
  depth,
  zoomDepth,
  activeDepth,
  activeNodeId,
  onSelectNode,
}: {
  nodes: HierarchyNode[];
  depth: number;
  zoomDepth: number;
  activeDepth?: number;
  activeNodeId?: string | null;
  onSelectNode?: (node: HierarchyNode, depth: number, index: number) => void;
}): JSX.Element | null {
  if (nodes.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {nodes.map((node, index) => {
        const showChildren = depth < zoomDepth;
        const hiddenCount = showChildren ? 0 : countHierarchyNodes(node.children);
        const isActive = depth === activeDepth && activeNodeId === node.id;
        return (
          <li
            key={node.id}
            className={`rounded-md border bg-white/90 px-2.5 py-2 transition-colors ${
              isActive ? "border-primary/60 ring-1 ring-primary/40" : ""
            }`}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground">{node.id.replace(/^[^-]+-/, "")}</span>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                {node.type}
              </Badge>
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusTone(node.status)}`}>
                {node.status}
              </span>
              <button
                type="button"
                onClick={() => onSelectNode?.(node, depth, index)}
                className="text-left text-xs hover:text-foreground"
              >
                {node.title}
              </button>
            </div>
            {node.children.length > 0 && (
              <div className="mt-2 border-l border-dashed border-border/80 pl-2.5">
                {showChildren ? (
                  <HierarchyList
                    nodes={node.children}
                    depth={depth + 1}
                    zoomDepth={zoomDepth}
                    activeDepth={activeDepth}
                    activeNodeId={activeNodeId}
                    onSelectNode={onSelectNode}
                  />
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {hiddenCount} deeper item{hiddenCount === 1 ? "" : "s"} hidden at this
                    zoom level
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ExistingOrchestrationsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { activeRepo, registeredRepos } = useAppStore();
  const { terminals, setActiveSession, upsertTerminal } = useTerminalStore();
  const [activeTreeIndex, setActiveTreeIndex] = useState(0);
  const [zoomByTreeId, setZoomByTreeId] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<{
    waveId: string;
    name: string;
    slug: string;
  } | null>(null);
  const [savingWaveId, setSavingWaveId] = useState<string | null>(null);
  const [triggeringWaveId, setTriggeringWaveId] = useState<string | null>(null);
  const [isRestaging, setIsRestaging] = useState(false);
  const [navigationLevel, setNavigationLevel] = useState<NavigationLevel>("tree");
  const [activeWaveIndexByTreeId, setActiveWaveIndexByTreeId] = useState<
    Record<string, number>
  >({});
  const [activeChildIndexByWaveId, setActiveChildIndexByWaveId] = useState<
    Record<string, number>
  >({});
  const migrationKeyRef = useRef<string>("");

  const query = useQuery({
    queryKey: ["existing-orchestrations", activeRepo],
    queryFn: () => loadExistingOrchestrations(activeRepo as string),
    enabled: Boolean(activeRepo),
    refetchInterval: 15_000,
  });

  const parsed = useMemo(
    () => (query.data ? parseExistingOrchestrations(query.data) : { trees: [], waves: [] }),
    [query.data]
  );

  const migrationPlan = useMemo(
    () => buildMigrationPlan(query.data?.waves ?? []),
    [query.data]
  );

  const builtForReviewIds = useMemo(() => {
    const beads = query.data?.beads ?? [];
    const byParent = new Map<string, Bead[]>();
    for (const bead of beads) {
      if (!bead.parent) continue;
      const list = byParent.get(bead.parent) ?? [];
      list.push(bead);
      byParent.set(bead.parent, list);
    }
    const result = new Set<string>();
    for (const [parentId, children] of byParent) {
      const hasVerification = children.some(
        (c) => c.status === "in_progress" && c.labels?.includes("stage:verification")
      );
      if (!hasVerification) continue;
      const allSettled = children.every(
        (c) =>
          c.status === "closed" ||
          (c.status === "in_progress" && c.labels?.includes("stage:verification"))
      );
      if (allSettled) result.add(parentId);
    }
    return result;
  }, [query.data]);

  const handleApproveReview = useCallback(
    async (parentId: string) => {
      const beads = query.data?.beads ?? [];
      const children = beads.filter(
        (b) =>
          b.parent === parentId &&
          b.status === "in_progress" &&
          b.labels?.includes("stage:verification")
      );
      for (const child of children) {
        await updateBead(child.id, verifyBeadFields(), activeRepo ?? undefined);
      }
      await closeBead(parentId, {}, activeRepo ?? undefined);
      queryClient.invalidateQueries({ queryKey: ["existing-orchestrations", activeRepo] });
      queryClient.invalidateQueries({ queryKey: ["beads"] });
      toast.success("Review approved");
    },
    [query.data, activeRepo, queryClient]
  );

  const handleRejectReview = useCallback(
    async (parentId: string) => {
      const beads = query.data?.beads ?? [];
      const children = beads.filter(
        (b) =>
          b.parent === parentId &&
          b.status === "in_progress" &&
          b.labels?.includes("stage:verification")
      );
      for (const child of children) {
        await updateBead(child.id, rejectBeadFields(child), activeRepo ?? undefined);
      }
      queryClient.invalidateQueries({ queryKey: ["existing-orchestrations", activeRepo] });
      queryClient.invalidateQueries({ queryKey: ["beads"] });
      toast.success("Review rejected — beats returned to open");
    },
    [query.data, activeRepo, queryClient]
  );

  useEffect(() => {
    if (!activeRepo || migrationPlan.length === 0) return;
    const migrationKey = `${activeRepo}|${migrationPlan
      .map((item) => `${item.waveId}:${item.newSlug}`)
      .join("|")}`;
    if (!migrationKey || migrationKeyRef.current === migrationKey) return;
    migrationKeyRef.current = migrationKey;

    let cancelled = false;
    (async () => {
      let migratedCount = 0;
      for (const item of migrationPlan) {
        const result = await updateBead(
          item.waveId,
          {
            title: item.newTitle,
            removeLabels: item.removeLabels,
            labels: [buildWaveSlugLabel(item.newSlug)],
          },
          activeRepo
        );
        if (!result.ok) {
          toast.error(`Failed to migrate scene ${item.waveId}: ${result.error}`);
          continue;
        }
        migratedCount += 1;
      }
      if (cancelled || migratedCount === 0) return;
      toast.success(
        `Migrated ${migratedCount} scene slug${migratedCount === 1 ? "" : "s"}`
      );
      queryClient.invalidateQueries({
        queryKey: ["existing-orchestrations", activeRepo],
      });
      queryClient.invalidateQueries({ queryKey: ["beads"] });
    })();

    return () => {
      cancelled = true;
    };
  }, [activeRepo, migrationPlan, queryClient]);

  const trees = parsed.trees;
  const treeCount = trees.length;
  const safeTreeIndex = treeCount === 0 ? 0 : Math.min(activeTreeIndex, treeCount - 1);
  const activeTree = trees[safeTreeIndex] ?? null;
  const activeWaveIndex = activeTree
    ? Math.min(
        Math.max(activeWaveIndexByTreeId[activeTree.id] ?? 0, 0),
        Math.max(activeTree.waves.length - 1, 0)
      )
    : 0;
  const activeWave = activeTree?.waves[activeWaveIndex] ?? null;
  const treeRootWave = activeTree?.waves[0] ?? null;
  const activeChildIndex = activeWave
    ? Math.min(
        Math.max(activeChildIndexByWaveId[activeWave.id] ?? 0, 0),
        Math.max(activeWave.children.length - 1, 0)
      )
    : 0;
  const activeChild = activeWave?.children[activeChildIndex] ?? null;
  const defaultZoom = activeTree
    ? Math.min(Math.max(MIN_ZOOM_DEPTH, MIN_ZOOM_DEPTH), activeTree.maxDepth)
    : MIN_ZOOM_DEPTH;
  const zoomDepth = activeTree
    ? Math.min(
        Math.max(zoomByTreeId[activeTree.id] ?? defaultZoom, MIN_ZOOM_DEPTH),
        activeTree.maxDepth
      )
    : MIN_ZOOM_DEPTH;
  const canZoomIn = Boolean(activeTree && zoomDepth < activeTree.maxDepth);
  const canZoomOut = Boolean(activeTree && zoomDepth > MIN_ZOOM_DEPTH);
  const effectiveNavigationLevel: NavigationLevel =
    navigationLevel === "tree" && treeCount <= 1
      ? "wave"
      : navigationLevel === "child" && (!activeWave || activeWave.children.length === 0)
        ? "wave"
        : navigationLevel;
  const treeSiblingCount = treeCount;
  const waveSiblingCount = activeTree?.waves.length ?? 0;
  const childSiblingCount = activeWave?.children.length ?? 0;

  const lateralLevel: NavigationLevel =
    effectiveNavigationLevel === "child"
      ? childSiblingCount > 1
        ? "child"
        : waveSiblingCount > 1
          ? "wave"
          : treeSiblingCount > 1
            ? "tree"
            : "child"
      : effectiveNavigationLevel === "wave"
        ? waveSiblingCount > 1
          ? "wave"
          : treeSiblingCount > 1
            ? "tree"
            : "wave"
        : treeSiblingCount > 1
          ? "tree"
          : "wave";

  const moveLaterally = useCallback(
    (direction: -1 | 1) => {
      if (!activeTree) return;
      setEditing(null);
      if (lateralLevel !== effectiveNavigationLevel) {
        setNavigationLevel(lateralLevel);
      }

      if (lateralLevel === "tree") {
        if (treeCount <= 1) return;
        setActiveTreeIndex((prev) => rotateIndex(prev, treeCount, direction));
        return;
      }

      if (lateralLevel === "wave") {
        const waveCount = activeTree.waves.length;
        if (waveCount <= 1) return;
        setActiveWaveIndexByTreeId((prev) => ({
          ...prev,
          [activeTree.id]: rotateIndex(
            prev[activeTree.id] ?? 0,
            waveCount,
            direction
          ),
        }));
        return;
      }

      if (!activeWave) return;
      const childCount = activeWave.children.length;
      if (childCount <= 1) return;
      setActiveChildIndexByWaveId((prev) => ({
        ...prev,
        [activeWave.id]: rotateIndex(
          prev[activeWave.id] ?? 0,
          childCount,
          direction
        ),
      }));
    },
    [activeTree, activeWave, effectiveNavigationLevel, lateralLevel, treeCount]
  );

  const drillDown = useCallback(() => {
    if (!activeTree) return;
    if (effectiveNavigationLevel === "tree") {
      if (activeTree.waves.length > 0) setNavigationLevel("wave");
      return;
    }
    if (effectiveNavigationLevel === "wave" && activeWave?.children.length) {
      setNavigationLevel("child");
    }
  }, [activeTree, activeWave, effectiveNavigationLevel]);

  const drillUp = useCallback(() => {
    if (!activeTree) return;
    if (effectiveNavigationLevel === "child") {
      setNavigationLevel("wave");
      return;
    }
    if (effectiveNavigationLevel === "wave" && treeCount > 1) {
      setNavigationLevel("tree");
    }
  }, [activeTree, effectiveNavigationLevel, treeCount]);

  const setZoom = useCallback(
    (delta: -1 | 1) => {
      if (!activeTree) return;
      if (activeTree.maxDepth <= MIN_ZOOM_DEPTH) return;
      setZoomByTreeId((prev) => {
        const current = prev[activeTree.id] ?? Math.min(MIN_ZOOM_DEPTH, activeTree.maxDepth);
        const next = Math.min(
          Math.max(current + delta, MIN_ZOOM_DEPTH),
          activeTree.maxDepth
        );
        return { ...prev, [activeTree.id]: next };
      });
    },
    [activeTree]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "ArrowLeft" || (event.shiftKey && event.code === "BracketLeft")) {
        event.preventDefault();
        moveLaterally(-1);
        return;
      }
      if (event.key === "ArrowRight" || (event.shiftKey && event.code === "BracketRight")) {
        event.preventDefault();
        moveLaterally(1);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        drillDown();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        drillUp();
        return;
      }
      if (event.shiftKey && event.code === "Equal") {
        event.preventDefault();
        setZoom(1);
        return;
      }
      if (event.code === "Minus") {
        event.preventDefault();
        setZoom(-1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drillDown, drillUp, moveLaterally, setZoom]);

  const lateralCount =
    lateralLevel === "tree"
      ? treeCount
      : lateralLevel === "wave"
        ? activeTree?.waves.length ?? 0
        : activeWave?.children.length ?? 0;
  const canMoveLaterally = lateralCount > 1;
  const navigationSummary =
    lateralLevel === "tree"
      ? `tree ${safeTreeIndex + 1}/${Math.max(treeCount, 1)}`
      : lateralLevel === "wave"
        ? `section ${activeWaveIndex + 1}/${Math.max(activeTree?.waves.length ?? 0, 1)}`
        : `child ${activeChildIndex + 1}/${Math.max(activeWave?.children.length ?? 0, 1)}`;

  const allSlugs = useMemo(() => {
    const slugSet = new Set<string>();
    for (const wave of parsed.waves) slugSet.add(wave.slug);
    return slugSet;
  }, [parsed.waves]);

  const saveRename = useCallback(
    async (wave: WaveCard) => {
      if (!activeRepo || !editing) return;
      const name = editing.name.trim();
      if (!name) {
        toast.error("Scene name is required");
        return;
      }
      const slug = normalizeWaveSlugCandidate(editing.slug);
      if (!slug) {
        toast.error("Scene slug is required");
        return;
      }
      const slugConflict = Array.from(allSlugs).includes(slug) && slug !== wave.slug;
      if (slugConflict) {
        toast.error(`Scene slug "${slug}" is already in use`);
        return;
      }

      setSavingWaveId(wave.id);
      const removeLabels = getWaveSlugLabels(wave.bead.labels ?? []);
      const result = await updateBead(
        wave.id,
        {
          title: buildWaveTitle(slug, name),
          removeLabels,
          labels: [buildWaveSlugLabel(slug)],
        },
        activeRepo
      );
      setSavingWaveId(null);

      if (!result.ok) {
        toast.error(result.error ?? "Failed to rename scene");
        return;
      }

      setEditing(null);
      queryClient.invalidateQueries({
        queryKey: ["existing-orchestrations", activeRepo],
      });
      queryClient.invalidateQueries({ queryKey: ["beads"] });
      toast.success("Scene renamed");
    },
    [activeRepo, allSlugs, editing, queryClient]
  );

  const handleTriggerWave = useCallback(
    async (wave: WaveCard) => {
      if (!activeRepo) {
        toast.error("Select a repository first");
        return;
      }

      const existingRunning = terminals.find(
        (terminal) => terminal.beadId === wave.id && terminal.status === "running"
      );
      if (existingRunning) {
        setActiveSession(existingRunning.sessionId);
        toast.info("Opened active Action session");
        return;
      }

      setTriggeringWaveId(wave.id);
      let result;
      try {
        result = await startSession(wave.id, activeRepo);
      } catch {
        setTriggeringWaveId((current) => (current === wave.id ? null : current));
        toast.error("Failed to run Action");
        return;
      }
      setTriggeringWaveId((current) => (current === wave.id ? null : current));

      if (!result.ok || !result.data) {
        toast.error(result.error ?? "Failed to run Action");
        return;
      }

      upsertTerminal({
        sessionId: result.data.id,
        beadId: wave.id,
        beadTitle: wave.title,
        status: "running",
        startedAt: new Date().toISOString(),
      });
      toast.success(`Action fired for ${wave.name}`);
    },
    [activeRepo, setActiveSession, terminals, upsertTerminal]
  );

  const handleRewrite = useCallback(async () => {
    if (!activeRepo || !activeTree) {
      toast.error("No active tree to rewrite");
      return;
    }

    const plan = buildRestagePlan(activeTree);
    if (plan.waves.length === 0) {
      toast.error("Active tree has no sections with child tasks to restage");
      return;
    }

    setIsRestaging(true);
    let result;
    try {
      result = await restageOrchestration(
        activeRepo,
        plan,
        `Rewrite existing scene tree ${activeTree.label}`
      );
    } catch {
      setIsRestaging(false);
      toast.error("Failed to rewrite scene tree");
      return;
    }
    setIsRestaging(false);

    if (!result.ok || !result.data) {
      toast.error(result.error ?? "Failed to rewrite scene tree");
      return;
    }

    const stagedPlan = result.data.plan ?? plan;
    const draft: OrchestrationRestageDraft = {
      repoPath: activeRepo,
      session: result.data,
      plan: stagedPlan,
      waveEdits: buildRestageWaveEdits(activeTree),
      objective: `Rewrite existing scene tree ${activeTree.label}`,
      statusText: `Restaged ${stagedPlan.waves.length} section${
        stagedPlan.waves.length === 1 ? "" : "s"
      } from ${activeTree.label}.`,
    };

    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        ORCHESTRATION_RESTAGE_DRAFT_KEY,
        JSON.stringify(draft)
      );
    }

    toast.success("Restaged into Scene view");
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "orchestration");
    router.push(`/beads?${params.toString()}`);
  }, [activeRepo, activeTree, router, searchParams]);

  if (!activeRepo) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        Select a repository to browse existing scenes.
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        Loading existing scenes...
      </div>
    );
  }

  if (query.error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {(query.error as Error).message}
      </div>
    );
  }

  if (treeCount === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        No scenes found for{" "}
        <span className="font-medium text-foreground">
          {registeredRepos.find((repo) => repo.path === activeRepo)?.name ?? activeRepo}
        </span>
        .
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      <section className="rounded-2xl border bg-gradient-to-br from-slate-50 via-emerald-50 to-cyan-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Existing Scenes</h2>
            <p className="text-sm text-muted-foreground">
              Tree {safeTreeIndex + 1} of {treeCount}
              <span className="mx-1">·</span>
              <span className="font-mono text-foreground">
                {activeTree?.displayLabel ?? activeTree?.label}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void handleRewrite()}
              disabled={!activeTree || isRestaging}
              className="gap-1.5"
              title="Rewrite scene plan"
            >
              {isRestaging ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Rewrite
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                if (!treeRootWave) return;
                void handleTriggerWave(treeRootWave);
              }}
              disabled={!treeRootWave || triggeringWaveId === treeRootWave.id}
              title={
                treeRootWave
                  ? `Trigger root section ${treeRootWave.slug}`
                  : "No tree root section available"
              }
            >
              {treeRootWave && triggeringWaveId === treeRootWave.id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Clapperboard className="size-3.5" />
              )}
              Action!
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => moveLaterally(-1)}
              disabled={!canMoveLaterally}
              className="gap-1.5"
              title="Previous tree"
            >
              <ChevronLeft className="size-3.5" />
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => moveLaterally(1)}
              disabled={!canMoveLaterally}
              className="gap-1.5"
              title="Next tree"
            >
              Next
              <ChevronRight className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setZoom(-1)}
              disabled={!canZoomOut}
              className="gap-1.5"
              title="Decrease zoom level"
            >
              <ZoomOut className="size-3.5" />
              Zoom Out
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setZoom(1)}
              disabled={!canZoomIn}
              className="gap-1.5"
              title="Increase zoom level"
            >
              <ZoomIn className="size-3.5" />
              Zoom In
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="font-mono">
            ← / →
          </Badge>
          <span>move siblings ({navigationSummary})</span>
          <Badge variant="outline" className="font-mono">
            ↑ / ↓
          </Badge>
          <span>up/down level</span>
          <Badge variant="outline" className="font-mono">
            Shift++ / -
          </Badge>
          <span>
            zoom depth ({zoomDepth}/{activeTree?.maxDepth ?? MIN_ZOOM_DEPTH})
          </span>
          {migrationPlan.length > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
              migrating legacy slugs...
            </span>
          )}
        </div>
      </section>

      <section className="space-y-3">
        {activeTree?.waves.map((wave, waveIndex) => {
          const isEditing = editing?.waveId === wave.id;
          const isActiveWave =
            waveIndex === activeWaveIndex &&
            (effectiveNavigationLevel === "wave" ||
              effectiveNavigationLevel === "child");
          return (
            <div
              key={wave.id}
              className={`rounded-xl border bg-card p-3 transition-colors ${
                isActiveWave ? "border-primary/60 ring-1 ring-primary/30" : ""
              }`}
              onClick={() => {
                if (!activeTree) return;
                setActiveWaveIndexByTreeId((prev) => ({
                  ...prev,
                  [activeTree.id]: waveIndex,
                }));
                setNavigationLevel("wave");
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
                        <Input
                          value={editing.name}
                          onChange={(event) =>
                            setEditing((prev) =>
                              prev
                                ? { ...prev, name: event.target.value }
                                : prev
                            )
                          }
                          placeholder="Scene name"
                          className="h-8"
                        />
                        <Input
                          value={editing.slug}
                          onChange={(event) =>
                            setEditing((prev) =>
                              prev
                                ? { ...prev, slug: event.target.value }
                                : prev
                            )
                          }
                          placeholder="scene-slug"
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => void saveRename(wave)}
                          disabled={savingWaveId === wave.id}
                          className="gap-1.5"
                          title="Save scene name"
                        >
                          <Save className="size-3.5" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing(null)}
                          className="gap-1.5"
                          title="Cancel rename"
                        >
                          <X className="size-3.5" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">{wave.id}</span>
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {wave.slug}
                        </Badge>
                        <span className="text-sm font-semibold">{wave.name}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {wave.descendants} descendant beat
                        {wave.descendants === 1 ? "" : "s"} · depth {wave.maxDepth}
                      </p>
                      {builtForReviewIds.has(wave.id) && (
                        <div className="mt-1.5 flex items-center gap-1.5 rounded border border-orange-200 bg-orange-50 px-2 py-1">
                          <Eye className="size-3.5 text-orange-600 shrink-0" />
                          <span className="text-xs font-semibold text-orange-700">Built for Review</span>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded p-0.5 text-green-700 hover:bg-green-100"
                            title="Approve all — close children and parent"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleApproveReview(wave.id);
                            }}
                          >
                            <Check className="size-4" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded p-0.5 text-red-700 hover:bg-red-100"
                            title="Reject all — return children to open"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleRejectReview(wave.id);
                            }}
                          >
                            <ThumbsDown className="size-4" />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {!isEditing && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={() => void handleTriggerWave(wave)}
                      disabled={triggeringWaveId === wave.id}
                      title={`Trigger section ${wave.slug}`}
                    >
                      {triggeringWaveId === wave.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Clapperboard className="size-3.5" />
                      )}
                      Action!
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      title="Rename this scene"
                      onClick={() =>
                        setEditing({
                          waveId: wave.id,
                          name: wave.name,
                          slug: wave.slug,
                        })
                      }
                    >
                      <Pencil className="size-3.5" />
                      Rename
                    </Button>
                  </div>
                )}
              </div>

              <div className="mt-3">
                {wave.children.length > 0 ? (
                  <HierarchyList
                    nodes={wave.children}
                    depth={2}
                    zoomDepth={zoomDepth}
                    activeDepth={2}
                    activeNodeId={
                      effectiveNavigationLevel === "child" &&
                      waveIndex === activeWaveIndex
                        ? activeChild?.id ?? null
                        : null
                    }
                    onSelectNode={(_, depth, index) => {
                      if (!activeTree || depth !== 2) return;
                      setActiveWaveIndexByTreeId((prev) => ({
                        ...prev,
                        [activeTree.id]: waveIndex,
                      }));
                      setActiveChildIndexByWaveId((prev) => ({
                        ...prev,
                        [wave.id]: index,
                      }));
                      setNavigationLevel("child");
                    }}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No child tasks linked to this scene.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
