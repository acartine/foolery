"use client";

import { use } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { fetchBead, deleteBead, closeBead, fetchDeps, updateBead } from "@/lib/api";
import type { UpdateBeadInput } from "@/lib/schemas";
import { BeadDetail } from "@/components/bead-detail";
import { DepTree } from "@/components/dep-tree";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export default function BeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const repo = searchParams.get("repo") || undefined;

  const { data, isLoading } = useQuery({
    queryKey: ["bead", id, repo],
    queryFn: () => fetchBead(id, repo),
  });

  const { data: depsData } = useQuery({
    queryKey: ["bead-deps", id, repo],
    queryFn: () => fetchDeps(id, repo),
  });

  const queryClient = useQueryClient();

  const { mutateAsync: handleUpdate } = useMutation({
    mutationFn: (fields: UpdateBeadInput) => updateBead(id, fields, repo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bead", id, repo] });
    },
  });

  const bead = data?.ok ? data.data : undefined;
  const deps = depsData?.ok ? (depsData.data ?? []) : [];

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this bead?")) return;
    const result = await deleteBead(id, repo);
    if (result.ok) {
      toast.success("Bead deleted");
      router.push("/beads");
    } else {
      toast.error(result.error ?? "Failed to delete bead");
    }
  }

  async function handleClose() {
    const reason = prompt("Close reason (optional):");
    const result = await closeBead(id, { reason: reason ?? undefined }, repo);
    if (result.ok) {
      toast.success("Bead closed");
      router.refresh();
    } else {
      toast.error(result.error ?? "Failed to close bead");
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          Loading bead...
        </div>
      </div>
    );
  }

  if (!bead) {
    return (
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Bead not found</p>
          <Button variant="ghost" className="mt-4" onClick={() => router.push("/beads")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Beads
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" onClick={() => router.push("/beads")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex gap-2">
          {bead.status !== "closed" && (
            <Button variant="outline" onClick={handleClose}>
              <XCircle className="mr-2 h-4 w-4" />
              Close
            </Button>
          )}
          <Button variant="destructive" onClick={handleDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <BeadDetail bead={bead} onUpdate={async (fields) => { await handleUpdate(fields); }} />

      {deps.length > 0 && (
        <>
          <Separator className="my-6" />
          <h2 className="text-lg font-semibold mb-4">Dependencies</h2>
          <DepTree deps={deps} beadId={id} />
        </>
      )}
    </div>
  );
}
