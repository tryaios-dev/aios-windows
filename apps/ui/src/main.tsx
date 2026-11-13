import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { MotionConfig } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/overlays'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import App from './App'
import { hydrate } from '@/bridge/live'
import './index.css'

// Fonts load lazily by default, so the first page to use the mono or display
// face would paint in a fallback and then swap. Ask for all of them up front.
for (const face of ['400 1em "Public Sans Variable"', '600 1em "Public Sans Variable"', '400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"', '400 1em "Gloock"']) {
  document.fonts?.load(face).catch(() => undefined)
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } })

// Load the data before the first render, so the start-up gate and every screen start from it.
// Desktop app: the real backend. Plain browser (`pnpm dev:ui`): the simulated backend, sample data.
// Hash routing: Electron loads the renderer from file://, where path routing cannot work.
void hydrate().finally(() =>
  createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}>
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </MotionConfig>
        </HashRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
),
)
