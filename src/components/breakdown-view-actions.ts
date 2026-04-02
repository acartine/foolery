"use client";

import { useCallback } from "react";
import type { useRouter, useSearchParams } from "next/navigation";
import type { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { applyBreakdown } from "@/lib/breakdown-api";
import { invalidateBeatListQueries } from "@/lib/beat-query-cache";
import type { BreakdownPlan, BreakdownSession } from "@/lib/types";

export function useApplyBreakdown(
  session: BreakdownSession | null,
  plan: BreakdownPlan | null,
  activeRepo: string | null,
  qc: ReturnType<typeof useQueryClient>,
  sp: ReturnType<typeof useSearchParams>,
  router: ReturnType<typeof useRouter>,
  parentBeatId: string,
  setIsApplying: React.Dispatch<
    React.SetStateAction<boolean>>,
) {
  return useCallback(async () => {
    if (!session || !plan || !activeRepo) return;
    setIsApplying(true);
    const r = await applyBreakdown(
      session.id,
      activeRepo,
    );
    setIsApplying(false);
    if (!r.ok || !r.data) {
      toast.error(
        r.error ?? "Failed to apply breakdown plan",
      );
      return;
    }
    const n = r.data.createdBeatIds.length;
    toast.success(
      `Created ${n} beats`
      + ` across ${r.data.waveCount} scenes`,
    );
    void invalidateBeatListQueries(qc);
    const params = new URLSearchParams(sp.toString());
    params.delete("view");
    params.delete("parent");
    params.set("beat", parentBeatId);
    router.push(`/beats?${params.toString()}`);
  }, [
    session,
    plan,
    activeRepo,
    qc,
    sp,
    router,
    parentBeatId,
    setIsApplying,
  ]);
}

export function useBreakdownBack(
  sp: ReturnType<typeof useSearchParams>,
  router: ReturnType<typeof useRouter>,
) {
  return useCallback(() => {
    const params = new URLSearchParams(sp.toString());
    params.delete("view");
    params.delete("parent");
    router.push(`/beats?${params.toString()}`);
  }, [sp, router]);
}
