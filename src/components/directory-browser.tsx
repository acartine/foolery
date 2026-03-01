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

export function DirectoryBrowser({
  open,
  onOpenChange,
  onSelect,
}: DirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const loadDirectory = useCallback(async (path?: string) => {
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
  }, []);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on dialog open
      loadDirectory();
    }
  }, [open, loadDirectory]);

  function navigateTo(path: string) {
    loadDirectory(path);
  }

  function navigateUp() {
    const parent =
      currentPath.split("/").slice(0, -1).join("/") || "/";
    loadDirectory(parent);
  }

  function handlePathSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pathInput) loadDirectory(pathInput);
  }

  function handleSelect() {
    if (selectedPath) {
      onSelect(selectedPath);
      onOpenChange(false);
    }
  }

  const pathSegments = currentPath.split("/").filter(Boolean);
  const supported = listKnownMemoryManagers()
    .map((memoryManager) => memoryManager.type)
    .join(", ");
  const filteredEntries = entries.filter((entry) => {
    if (!search) return true;
    const needle = search.toLowerCase();
    return (
      entry.name.toLowerCase().includes(needle) ||
      entry.path.toLowerCase().includes(needle) ||
      (entry.memoryManagerType ?? "").toLowerCase().includes(needle)
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Browse for Repository</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Supported memory manager implementations: {supported}
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

        <div className="flex items-center gap-1 text-sm text-muted-foreground overflow-x-auto">
          <button
            type="button"
            onClick={() => loadDirectory()}
            className="hover:text-foreground"
          >
            <Home className="size-4" />
          </button>
          {pathSegments.map((segment, i) => {
            const segmentPath =
              "/" + pathSegments.slice(0, i + 1).join("/");
            return (
              <span key={segmentPath} className="flex items-center gap-1">
                <ChevronRight className="size-3" />
                <button
                  type="button"
                  onClick={() => navigateTo(segmentPath)}
                  className="hover:text-foreground hover:underline"
                >
                  {segment}
                </button>
              </span>
            );
          })}
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={navigateUp}>
            <ChevronLeft className="size-4 mr-1" /> Up
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto border rounded-md min-h-[300px]">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Loading...
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              No matching directories found
            </div>
          ) : (
            <div className="divide-y">
              {filteredEntries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors ${
                    selectedPath === entry.path ? "bg-muted" : ""
                  }`}
                  onClick={() => {
                    if (entry.isCompatible) {
                      setSelectedPath(entry.path);
                    } else {
                      navigateTo(entry.path);
                    }
                  }}
                  onDoubleClick={() => {
                    if (entry.isCompatible) setSelectedPath(entry.path);
                    else navigateTo(entry.path);
                  }}
                >
                  {entry.isCompatible ? (
                    <FolderCheck className="size-5 text-green-500 shrink-0" />
                  ) : (
                    <Folder className="size-5 text-muted-foreground shrink-0" />
                  )}
                  <span className="flex-1 truncate">{entry.name}</span>
                  {entry.isCompatible ? (
                    <span className="text-xs text-green-600 bg-green-50 dark:bg-green-950 dark:text-green-400 px-2 py-0.5 rounded-full">
                      {getMemoryManagerLabel(entry.memoryManagerType)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {entry.memoryManagerType
                        ? getMemoryManagerLabel(entry.memoryManagerType)
                        : "unsupported"}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSelect} disabled={!selectedPath}>
            Select
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
