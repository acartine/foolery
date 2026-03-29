"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  finishClientSpan,
  isDiagnosticsEnabled,
  markClientSpan,
  setDiagnosticsEnabled,
  recordClientPerfEvent,
} from "@/lib/client-perf";
import { createPerfEvent } from "@/lib/perf-events";

export function ClientPerfRouteObserver() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (searchParams.get("diagnostics") === "1" && !isDiagnosticsEnabled()) {
      setDiagnosticsEnabled(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!isDiagnosticsEnabled()) {
      return;
    }
    const search = searchParams.toString();
    const url = `${pathname}${search ? `?${search}` : ""}`;
    if (lastUrlRef.current === url) {
      return;
    }

    const span = markClientSpan(
      "view",
      lastUrlRef.current === null ? "initial-load" : "route-change",
    );
    finishClientSpan(span);
    recordClientPerfEvent(createPerfEvent({
      kind: "view_transition",
      pathname,
      search: search ? `?${search}` : "",
      navigationType: lastUrlRef.current === null ? "initial-load" : "route-change",
    }));
    lastUrlRef.current = url;
  }, [pathname, searchParams]);

  return null;
}
