import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { SearchHit } from '@/lib/types'

/**
 * Messages that contain `query` (GET /search), shown when the backend answers; answers to older
 * queries are dropped. `refresh` re-runs the search when it changes (the screens pass the store's
 * messages, so results follow new messages).
 */
export function useMessageSearch(query: string | null, refresh: unknown): SearchHit[] {
  const [remote, setRemote] = useState<{ query: string; hits: SearchHit[] }>({ query: '', hits: [] })

  useEffect(() => {
    if (!query) return
    let current = true
    api
      .search(query)
      .then((hits) => current && setRemote({ query, hits }))
      .catch(() => current && setRemote({ query, hits: [] }))
    return () => {
      current = false
    }
  }, [query, refresh])

  return query && remote.query === query ? remote.hits : []
}
