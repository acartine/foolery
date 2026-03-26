"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { useUpdateUrl } from "@/hooks/use-update-url";

export function BeatTablePagination({
  manualPageIndex,
  manualPageCount,
  pageSize,
  setManualPageIndex,
  updateUrl,
}: {
  manualPageIndex: number;
  manualPageCount: number;
  pageSize: number;
  setManualPageIndex: (
    fn: (p: number) => number,
  ) => void;
  updateUrl: ReturnType<typeof useUpdateUrl>;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-sm text-muted-foreground">
        Page {manualPageIndex + 1} of{" "}
        {manualPageCount}
      </div>
      <div className="flex items-center gap-1">
        <Select
          value={String(pageSize)}
          onValueChange={(v) => {
            const size = Number(v);
            setManualPageIndex(() => 0);
            updateUrl({ pageSize: size });
          }}
        >
          <SelectTrigger className="h-8 w-[70px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[25, 50, 100].map((size) => (
              <SelectItem
                key={size}
                value={String(size)}
              >
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          title="Previous page"
          onClick={() =>
            setManualPageIndex((p) =>
              Math.max(0, p - 1),
            )
          }
          disabled={manualPageIndex === 0}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          title="Next page"
          onClick={() =>
            setManualPageIndex((p) =>
              Math.min(manualPageCount - 1, p + 1),
            )
          }
          disabled={
            manualPageIndex >= manualPageCount - 1
          }
        >
          Next
        </Button>
      </div>
    </div>
  );
}
