import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router";
import { MotionConfig } from "motion/react";
import { EASE } from "@/lib/motion";
import { TooltipProvider } from "@/components/ui/overlays";
import { AppRoutes } from "./AppRoutes";
import { ErrorBoundary } from "./ErrorBoundary";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } });

/** Hash routing: Electron loads the renderer from file://, where path routing cannot work. */
export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: EASE }}>
            <TooltipProvider>
              <AppRoutes />
            </TooltipProvider>
          </MotionConfig>
        </HashRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
