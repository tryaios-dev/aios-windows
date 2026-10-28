import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "./ErrorBoundary";
import { HomePage } from "../features/home/HomePage";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } });

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <HomePage />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
