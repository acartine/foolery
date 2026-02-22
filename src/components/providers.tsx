"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWindowFocusInvalidation } from "@/hooks/use-window-focus-invalidation";

/** Activates global hooks that require QueryClient context. */
function GlobalQueryHooks() {
  useWindowFocusInvalidation();
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 0 },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <GlobalQueryHooks />
      <TooltipProvider>
        {children}
        <Toaster richColors />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
