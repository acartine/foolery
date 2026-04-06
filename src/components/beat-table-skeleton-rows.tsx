"use client";

import {
  TableRow, TableCell,
} from "@/components/ui/table";

interface BeatTableSkeletonRowsProps {
  /** Number of visible columns in the table. */
  columnCount: number;
  /** Number of placeholder rows to show. */
  rowCount?: number;
}

/**
 * Shimmer placeholder rows rendered at the bottom of
 * the beat table while more repos are still loading.
 */
export function BeatTableSkeletonRows({
  columnCount,
  rowCount = 3,
}: BeatTableSkeletonRowsProps) {
  return (
    <>
      {Array.from({ length: rowCount }, (_, i) => (
        <TableRow
          key={`skeleton-${i}`}
          data-testid="skeleton-row"
          className="border-b-0"
        >
          <TableCell
            colSpan={columnCount}
            className="py-2"
          >
            <div
              className={
                "h-4 rounded bg-muted/60"
                + " animate-pulse"
                + " motion-reduce:animate-none"
              }
              style={{
                width: `${75 - i * 10}%`,
              }}
            />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
