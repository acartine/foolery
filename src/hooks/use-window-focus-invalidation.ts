"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateBeatListQueries } from "@/lib/beat-query-cache";

/**
 * Invalidates beat-related React Query caches when the browser tab
 * becomes visible again (e.g. user switches back to the app).
 *
 * This ensures that badges and the Final Cut view show fresh data
 * immediately instead of waiting for the next polling interval.
 *
 * React Query has a built-in `refetchOnWindowFocus` option, but it
 * fires on the `focus` event which may not trigger reliably in all
 * contexts (Electron, background tabs). Listening for
 * `visibilitychange` provides a more reliable signal.
 */
export function useWindowFocusInvalidation(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        // Refresh beat list views/badges immediately when tab visibility resumes.
        void invalidateBeatListQueries(queryClient);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [queryClient]);
}
