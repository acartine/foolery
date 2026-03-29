"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { ClientDiagnosticsRuntime } from "@/components/client-diagnostics-runtime";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWindowFocusInvalidation } from "@/hooks/use-window-focus-invalidation";
import { initializeDiagnostics } from "@/lib/client-perf";

/** Activates global hooks that require QueryClient context. */
function GlobalQueryHooks() {
  useWindowFocusInvalidation();
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  initializeDiagnostics();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 10_000 },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ClientDiagnosticsRuntime />
      <GlobalQueryHooks />
      <TooltipProvider>
        {children}
        <Toaster richColors />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
