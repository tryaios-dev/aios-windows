import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { SearchHit } from '@/lib/types'

export interface MessageSearch {
  hits: SearchHit[]
  /** The backend could not search: the screens say so instead of "nothing matches". */
  failed: boolean
  retry: () => void
}

/**
 * Messages that contain `query` (GET /search), shown when the backend answers; answers to older
 * queries are dropped. `refresh` re-runs the search when it changes (the screens pass the store's
 * messages, so results follow new messages).
 */
export function useMessageSearch(query: string | null, refresh: unknown): MessageSearch {
  const [remote, setRemote] = useState<{ query: string; hits: SearchHit[]; failed: boolean }>({ query: '', hits: [], failed: false })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!query) return
    let current = true
    api
      .search(query)
      .then((hits) => current && setRemote({ query, hits, failed: false }))
      .catch(() => current && setRemote({ query, hits: [], failed: true }))
    return () => {
      current = false
    }
  }, [query, refresh, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const answered = Boolean(query) && remote.query === query
  return { hits: answered ? remote.hits : [], failed: answered && remote.failed, retry }
}
