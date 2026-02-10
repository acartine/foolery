"use client";

import { use } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { fetchBead, fetchDeps, updateBead } from "@/lib/api";
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
    refetchInterval: 10_000,
  });

  const { data: depsData } = useQuery({
    queryKey: ["bead-deps", id, repo],
    queryFn: () => fetchDeps(id, repo),
    refetchInterval: 10_000,
  });

  const queryClient = useQueryClient();

  const { mutateAsync: handleUpdate } = useMutation({
    mutationFn: async (fields: UpdateBeadInput) => {
      const result = await updateBead(id, fields, repo);
      if (!result.ok) throw new Error(result.error ?? "Failed to update bead");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bead", id, repo] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const bead = data?.ok ? data.data : undefined;
  const deps = depsData?.ok ? (depsData.data ?? []) : [];

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
        <div className="flex gap-2" />
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
