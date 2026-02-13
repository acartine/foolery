"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Save,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchBeads, fetchDeps, updateBead } from "@/lib/api";
import type { Bead, BeadDependency } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";
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
  const stripped = title.replace(/^wave\s+[^:]+:\s*/i, "").trim();
  return stripped || title;
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

function buildChildrenIndex(beads: Bead[]): Map<string, Bead[]> {
  const byParent = new Map<string, Bead[]>();
  for (const bead of beads) {
    if (!bead.parent) continue;
    const list = byParent.get(bead.parent) ?? [];
    list.push(bead);
    byParent.set(bead.parent, list);
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
  const waves = data.waves.slice().sort(compareByTimestamp);
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
    const label = waveCardsInTree[0]?.slug ?? fallbackLabel;
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

function HierarchyList({
  nodes,
  depth,
  zoomDepth,
}: {
  nodes: HierarchyNode[];
  depth: number;
  zoomDepth: number;
}): JSX.Element | null {
  if (nodes.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {nodes.map((node) => {
        const showChildren = depth < zoomDepth;
        const hiddenCount = showChildren ? 0 : countHierarchyNodes(node.children);
        return (
          <li key={node.id} className="rounded-md border bg-white/90 px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground">{node.id}</span>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                {node.type}
              </Badge>
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusTone(node.status)}`}>
                {node.status}
              </span>
              <span className="text-xs">{node.title}</span>
            </div>
            {node.children.length > 0 && (
              <div className="mt-2 border-l border-dashed border-border/80 pl-2.5">
                {showChildren ? (
                  <HierarchyList
                    nodes={node.children}
                    depth={depth + 1}
                    zoomDepth={zoomDepth}
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
  const queryClient = useQueryClient();
  const { activeRepo, registeredRepos } = useAppStore();
  const [activeTreeIndex, setActiveTreeIndex] = useState(0);
  const [zoomByTreeId, setZoomByTreeId] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<{
    waveId: string;
    name: string;
    slug: string;
  } | null>(null);
  const [savingWaveId, setSavingWaveId] = useState<string | null>(null);
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
          toast.error(`Failed to migrate wave ${item.waveId}: ${result.error}`);
          continue;
        }
        migratedCount += 1;
      }
      if (cancelled || migratedCount === 0) return;
      toast.success(
        `Migrated ${migratedCount} wave slug${migratedCount === 1 ? "" : "s"}`
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

  const cycleTree = useCallback(
    (direction: -1 | 1) => {
      if (treeCount <= 1) return;
      setActiveTreeIndex((prev) => (prev + direction + treeCount) % treeCount);
      setEditing(null);
    },
    [treeCount]
  );

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
      if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
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

      if (event.code === "BracketLeft") {
        event.preventDefault();
        cycleTree(-1);
        return;
      }
      if (event.code === "BracketRight") {
        event.preventDefault();
        cycleTree(1);
        return;
      }
      if (event.code === "Equal") {
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
  }, [cycleTree, setZoom]);

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
        toast.error("Wave name is required");
        return;
      }
      const slug = normalizeWaveSlugCandidate(editing.slug);
      if (!slug) {
        toast.error("Wave slug is required");
        return;
      }
      const slugConflict = Array.from(allSlugs).includes(slug) && slug !== wave.slug;
      if (slugConflict) {
        toast.error(`Wave slug "${slug}" is already in use`);
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
        toast.error(result.error ?? "Failed to rename wave");
        return;
      }

      setEditing(null);
      queryClient.invalidateQueries({
        queryKey: ["existing-orchestrations", activeRepo],
      });
      queryClient.invalidateQueries({ queryKey: ["beads"] });
      toast.success("Wave renamed");
    },
    [activeRepo, allSlugs, editing, queryClient]
  );

  if (!activeRepo) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        Select a repository to browse existing orchestration trees.
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        Loading existing orchestrations...
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
        No existing orchestration waves found for{" "}
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
            <h2 className="text-base font-semibold tracking-tight">Existing Orchestrations</h2>
            <p className="text-sm text-muted-foreground">
              Tree {safeTreeIndex + 1} of {treeCount}
              <span className="mx-1">·</span>
              <span className="font-mono text-foreground">{activeTree?.label}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => cycleTree(-1)}
              disabled={treeCount <= 1}
              className="gap-1.5"
            >
              <ChevronLeft className="size-3.5" />
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => cycleTree(1)}
              disabled={treeCount <= 1}
              className="gap-1.5"
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
            >
              <ZoomIn className="size-3.5" />
              Zoom In
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="font-mono">
            Shift+[ / Shift+]
          </Badge>
          <span>cycle trees</span>
          <Badge variant="outline" className="font-mono">
            Shift++ / Shift+-
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
        {activeTree?.waves.map((wave) => {
          const isEditing = editing?.waveId === wave.id;
          return (
            <div key={wave.id} className="rounded-xl border bg-card p-3">
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
                          placeholder="Wave name"
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
                          placeholder="wave-slug"
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => void saveRename(wave)}
                          disabled={savingWaveId === wave.id}
                          className="gap-1.5"
                        >
                          <Save className="size-3.5" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing(null)}
                          className="gap-1.5"
                        >
                          <X className="size-3.5" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {wave.slug}
                        </Badge>
                        <span className="text-sm font-semibold">{wave.title}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {wave.descendants} descendant bead
                        {wave.descendants === 1 ? "" : "s"} · depth {wave.maxDepth}
                      </p>
                    </>
                  )}
                </div>
                {!isEditing && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
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
                )}
              </div>

              <div className="mt-3">
                {wave.children.length > 0 ? (
                  <HierarchyList nodes={wave.children} depth={2} zoomDepth={zoomDepth} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No child tasks linked to this wave.
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
