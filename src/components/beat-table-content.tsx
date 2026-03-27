"use client";

import { Fragment } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useReactTable,
  flexRender,
} from "@tanstack/react-table";
import type { Beat } from "@/lib/types";
import { getBeatColumns } from "@/components/beat-columns";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  renderedHandoffCapsules,
} from "@/components/beat-table-metadata";
import { InlineSummary } from "@/components/beat-table-summary";
import type {
  TitleRenderOpts,
} from "@/components/beat-column-helpers";
import {
  InlineTitleContent,
} from "@/components/beat-column-helpers";

export type ColumnMetaSizing = {
  widthPercent?: string;
  minWidthPx?: number;
};

export function BeatTableContent({
  table,
  columns,
  focusedRowId,
  handleRowFocus,
  searchQuery,
  searchParams,
  router,
  titleRenderOpts,
}: {
  table: ReturnType<typeof useReactTable<Beat>>;
  columns: ReturnType<typeof getBeatColumns>;
  focusedRowId: string | null;
  handleRowFocus: (beat: Beat) => void;
  searchQuery?: string;
  searchParams: ReturnType<typeof useSearchParams>;
  router: ReturnType<typeof useRouter>;
  titleRenderOpts: TitleRenderOpts;
}) {
  return (
    <Table className="table-auto">
      <BeatTableHeader table={table} />
      <BeatTableBody
        table={table}
        columns={columns}
        focusedRowId={focusedRowId}
        handleRowFocus={handleRowFocus}
        searchQuery={searchQuery}
        searchParams={searchParams}
        router={router}
        titleRenderOpts={titleRenderOpts}
      />
    </Table>
  );
}

function BeatTableHeader({
  table,
}: {
  table: ReturnType<typeof useReactTable<Beat>>;
}) {
  return (
    <TableHeader>
      {table.getHeaderGroups().map((hg) => (
        <TableRow key={hg.id}>
          {hg.headers.map((header) => {
            const meta = header.column.columnDef
              .meta as ColumnMetaSizing | undefined;
            const maxSize =
              header.column.columnDef.maxSize!;
            const widthVal =
              meta?.widthPercent ??
              (maxSize < Number.MAX_SAFE_INTEGER
                ? header.getSize()
                : undefined);
            return (
              <TableHead
                key={header.id}
                style={{
                  width: widthVal,
                  minWidth: meta?.minWidthPx,
                }}
              >
                {header.isPlaceholder
                  ? null
                  : header.column.getCanSort()
                    ? (
                      <button
                        type="button"
                        title="Sort column"
                        className="flex items-center gap-1"
                        onClick={
                          header.column
                            .getToggleSortingHandler()
                        }
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        <ArrowUpDown className="size-3" />
                      </button>
                    )
                    : flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
              </TableHead>
            );
          })}
        </TableRow>
      ))}
    </TableHeader>
  );
}

function BeatTableBody({
  table,
  columns,
  focusedRowId,
  handleRowFocus,
  searchQuery,
  searchParams,
  router,
  titleRenderOpts,
}: {
  table: ReturnType<typeof useReactTable<Beat>>;
  columns: ReturnType<typeof getBeatColumns>;
  focusedRowId: string | null;
  handleRowFocus: (beat: Beat) => void;
  searchQuery?: string;
  searchParams: ReturnType<typeof useSearchParams>;
  router: ReturnType<typeof useRouter>;
  titleRenderOpts: TitleRenderOpts;
}) {
  const rows = table.getRowModel().rows;

  return (
    <TableBody>
      {rows.length ? (
        rows.map((row) => (
          <BeatTableRow
            key={row.id}
            row={row}
            focusedRowId={focusedRowId}
            handleRowFocus={handleRowFocus}
            titleRenderOpts={titleRenderOpts}
          />
        ))
      ) : (
        <EmptyRow
          columns={columns}
          searchQuery={searchQuery}
          searchParams={searchParams}
          router={router}
        />
      )}
    </TableBody>
  );
}

function BeatTableRow({
  row,
  focusedRowId,
  handleRowFocus,
  titleRenderOpts,
}: {
  row: ReturnType<
    ReturnType<
      typeof useReactTable<Beat>
    >["getRowModel"]
  >["rows"][number];
  focusedRowId: string | null;
  handleRowFocus: (beat: Beat) => void;
  titleRenderOpts: TitleRenderOpts;
}) {
  const cells = row.getVisibleCells();
  const totalCols = cells.length;
  const isFocused = focusedRowId === row.original.id;
  const depth = (
    row.original as unknown as { _depth?: number }
  )._depth ?? 0;
  const indent = `${depth * 16 + 16}px`;
  const capsules = renderedHandoffCapsules(
    row.original,
  );
  const showSummary =
    isFocused &&
    Boolean(
      row.original.description ||
        row.original.notes ||
        capsules.length > 0,
    );

  return (
    <Fragment>
      <TableRow
        className={cn(
          "border-b-0",
          isFocused && "bg-muted/50",
        )}
        onClick={() => handleRowFocus(row.original)}
      >
        {cells.map((cell) => {
          const meta = cell.column.columnDef
            .meta as ColumnMetaSizing | undefined;
          const maxSize =
            cell.column.columnDef.maxSize!;
          return (
            <TableCell
              key={cell.id}
              className={cellClassName(
                meta, maxSize,
              )}
            >
              {flexRender(
                cell.column.columnDef.cell,
                cell.getContext(),
              )}
            </TableCell>
          );
        })}
      </TableRow>
      <TableRow
        className={cn(
          isFocused && "bg-muted/50",
        )}
        onClick={() => handleRowFocus(row.original)}
      >
        <TableCell
          colSpan={totalCols}
          className="pt-0 pb-1 truncate"
        >
          <InlineTitleContent
            beat={row.original}
            opts={titleRenderOpts}
          />
        </TableCell>
      </TableRow>
      {showSummary && (
        <TableRow className="bg-muted/30">
          <TableCell
            colSpan={totalCols}
            className="whitespace-normal pt-0"
          >
            <div
              className="min-w-0"
              style={{ paddingLeft: indent }}
            >
              <InlineSummary
                beat={row.original}
                capsules={capsules}
              />
            </div>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

function cellClassName(
  meta: ColumnMetaSizing | undefined,
  maxSize: number,
): string | undefined {
  if (meta?.widthPercent || meta?.minWidthPx) {
    return "whitespace-nowrap";
  }
  if (maxSize < Number.MAX_SAFE_INTEGER) {
    return undefined;
  }
  return cn("whitespace-normal", "overflow-hidden");
}

function EmptyRow({
  columns,
  searchQuery,
  searchParams,
  router,
}: {
  columns: ReturnType<typeof getBeatColumns>;
  searchQuery?: string;
  searchParams: ReturnType<typeof useSearchParams>;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <TableRow>
      <TableCell
        colSpan={columns.length}
        className="h-10 text-center"
      >
        {searchQuery ? (
          <div className="flex items-center justify-center gap-2">
            <span>
              No results for &ldquo;{searchQuery}&rdquo;
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              title="Clear search query"
              onClick={() => {
                const params = new URLSearchParams(
                  searchParams.toString(),
                );
                params.delete("q");
                const qs = params.toString();
                router.push(
                  `/beats${qs ? `?${qs}` : ""}`,
                );
              }}
            >
              <XCircle className="size-3.5" />
              Clear search
            </Button>
          </div>
        ) : (
          "No beats found."
        )}
      </TableCell>
    </TableRow>
  );
}
