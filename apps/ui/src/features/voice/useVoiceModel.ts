import { useQuery } from '@tanstack/react-query'
import type { VoiceStatus } from '@aios/bridge-contract'
import { bridge } from '@/bridge'

/**
 * The speech engine and its model as the backend reports them (GET /voice/status), checked every
 * second while the model downloads and every 30 s otherwise. Setup and Settings > Voice read it.
 */
export function useVoiceStatus(): VoiceStatus | undefined {
  const q = useQuery({
    queryKey: ['voice-status'],
    queryFn: () => bridge().voice.status(),
    refetchInterval: (query) => {
      const s = query.state.data?.model.status
      return s === 'downloading' || s === 'verifying' ? 1_000 : 30_000
    },
  })
  return q.data
}
