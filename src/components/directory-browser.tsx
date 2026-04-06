"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Folder,
  FolderCheck,
  ChevronRight,
  ChevronLeft,
  Home,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { browseDirectory } from "@/lib/registry-api";
import type { DirEntry } from "@/lib/types";
import { getMemoryManagerLabel, listKnownMemoryManagers } from "@/lib/memory-managers";

interface DirectoryBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
}

const SUPPORTED_TYPES = listKnownMemoryManagers()
  .map((m) => m.type)
  .join(", ");

function filterEntries(entries: DirEntry[], search: string) {
  if (!search) return entries;
  const needle = search.toLowerCase();
  return entries.filter(
    (entry) =>
      entry.name.toLowerCase().includes(needle) ||
      entry.path.toLowerCase().includes(needle) ||
      (entry.memoryManagerType ?? "")
        .toLowerCase()
        .includes(needle),
  );
}

function BreadcrumbNav({
  pathSegments,
  onHome,
  onNavigate,
}: {
  pathSegments: string[];
  onHome: () => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-sm text-muted-foreground overflow-x-auto">
      <button
        type="button"
        onClick={onHome}
        className="hover:text-foreground"
      >
        <Home className="size-4" />
      </button>
      {pathSegments.map((segment, i) => {
        const segmentPath =
          "/" + pathSegments.slice(0, i + 1).join("/");
        return (
          <span
            key={segmentPath}
            className="flex items-center gap-1"
          >
            <ChevronRight className="size-3" />
            <button
              type="button"
              onClick={() => onNavigate(segmentPath)}
              className="hover:text-foreground hover:underline"
            >
              {segment}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function DirectoryEntryRow({
  entry,
  isSelected,
  onSelect: onEntrySelect,
  onNavigate,
}: {
  entry: DirEntry;
  isSelected: boolean;
  onSelect: (path: string) => void;
  onNavigate: (path: string) => void;
}) {
  const bgClass = isSelected ? "bg-muted" : "";
  const baseClass =
    "w-full flex items-center gap-3 px-4 py-2.5 " +
    "text-left hover:bg-muted/50 transition-colors";
  return (
    <button
      type="button"
      className={`${baseClass} ${bgClass}`}
      onClick={() => {
        if (entry.isCompatible) onEntrySelect(entry.path);
        else onNavigate(entry.path);
      }}
      onDoubleClick={() => {
        if (entry.isCompatible) onEntrySelect(entry.path);
        else onNavigate(entry.path);
      }}
    >
      {entry.isCompatible ? (
        <FolderCheck className="size-5 text-green-500 shrink-0" />
      ) : (
        <Folder className="size-5 text-muted-foreground shrink-0" />
      )}
      <span className="flex-1 truncate">{entry.name}</span>
      <MemoryManagerBadge entry={entry} />
    </button>
  );
}

function MemoryManagerBadge({ entry }: { entry: DirEntry }) {
  if (entry.isCompatible) {
    return (
      <span className="text-xs text-green-600 bg-green-50 dark:bg-green-950 dark:text-green-400 px-2 py-0.5 rounded-full">
        {getMemoryManagerLabel(entry.memoryManagerType)}
      </span>
    );
  }
  const label = entry.memoryManagerType
    ? getMemoryManagerLabel(entry.memoryManagerType)
    : "unsupported";
  return (
    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
      {label}
    </span>
  );
}

function DirectoryEntryList({
  loading,
  entries,
  selectedPath,
  onSelect: onEntrySelect,
  onNavigate,
}: {
  loading: boolean;
  entries: DirEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onNavigate: (path: string) => void;
}) {
  const placeholderClass =
    "flex items-center justify-center py-12 text-muted-foreground";
  return (
    <div className="flex-1 overflow-y-auto border rounded-md min-h-[300px]">
      {loading ? (
        <div className={placeholderClass}>Loading...</div>
      ) : entries.length === 0 ? (
        <div className={placeholderClass}>
          No matching directories found
        </div>
      ) : (
        <div className="divide-y">
          {entries.map((entry) => (
            <DirectoryEntryRow
              key={entry.path}
              entry={entry}
              isSelected={selectedPath === entry.path}
              onSelect={onEntrySelect}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DialogFooter({
  onCancel,
  onConfirm,
  disabled,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button onClick={onConfirm} disabled={disabled}>
        Select
      </Button>
    </div>
  );
}

export function DirectoryBrowser({
  open,
  onOpenChange,
  onSelect,
}: DirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPath, setSelectedPath] =
    useState<string | null>(null);
  const [search, setSearch] = useState("");

  const loadDirectory = useCallback(
    async (path?: string) => {
      setLoading(true);
      setSelectedPath(null);
      const result = await browseDirectory(path);
      if (result.ok && result.data) {
        setEntries(result.data);
        const displayPath = path || "~";
        setCurrentPath(displayPath);
        setPathInput(displayPath);
      }
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on dialog open
      void loadDirectory();
    }
  }, [open, loadDirectory]);

  const navigateTo = (path: string) => loadDirectory(path);

  const navigateUp = () =>
    loadDirectory(
      currentPath.split("/").slice(0, -1).join("/") || "/",
    );

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pathInput) void loadDirectory(pathInput);
  };

  const handleSelect = () => {
    if (selectedPath) {
      onSelect(selectedPath);
      onOpenChange(false);
    }
  };

  const pathSegments = currentPath.split("/").filter(Boolean);
  const filteredEntries = filterEntries(entries, search);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Browse for Repository</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Supported memory managers: {SUPPORTED_TYPES}
          </p>
        </DialogHeader>

        <form onSubmit={handlePathSubmit} className="flex gap-2">
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="Enter path..."
            className="flex-1"
          />
          <Button type="submit" variant="outline" size="sm">
            Go
          </Button>
        </form>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter directories or memory manager type..."
        />

        <BreadcrumbNav
          pathSegments={pathSegments}
          onHome={() => loadDirectory()}
          onNavigate={navigateTo}
        />

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={navigateUp}>
            <ChevronLeft className="size-4 mr-1" /> Up
          </Button>
        </div>

        <DirectoryEntryList
          loading={loading}
          entries={filteredEntries}
          selectedPath={selectedPath}
          onSelect={setSelectedPath}
          onNavigate={navigateTo}
        />

        <DialogFooter
          onCancel={() => onOpenChange(false)}
          onConfirm={handleSelect}
          disabled={!selectedPath}
        />
      </DialogContent>
    </Dialog>
  );
}
