/**
 * The pictures and videos of a project, kept up to date while a job runs (R-7). The backend asks
 * the company server how a job is going each time the list is read, so polling the list is how a
 * job moves along; it stops when nothing is running.
 */
import { useCallback, useEffect, useState } from 'react'
import type { MediaContent, MediaItem, MediaStatus } from '@aios/bridge-contract'
import { api } from '@/lib/api'
import { isPending } from './options'

export const POLL_MS = 3000

export function useMedia(projectId: string | undefined) {
  const [status, setStatus] = useState<MediaStatus | null>(null)
  const [items, setItems] = useState<MediaItem[]>([])
  const [loaded, setLoaded] = useState(false)

  const reloadStatus = useCallback(async () => {
    try {
      setStatus(await api.media.status())
    } catch {
      setStatus({ available: false, reason: 'media_unavailable', models: [] })
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!projectId) return
    try {
      setItems(await api.media.list(projectId))
    } catch {
      // keep what is shown; the next poll or visit tries again
    } finally {
      setLoaded(true)
    }
  }, [projectId])

  useEffect(() => {
    setItems([])
    setLoaded(false)
    void reloadStatus()
    void refresh()
  }, [refresh, reloadStatus])

  const running = items.some(isPending)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [running, refresh])

  const upsert = useCallback((item: MediaItem) => {
    setItems((list) => [item, ...list.filter((i) => i.id !== item.id)].sort((a, b) => b.created_at.localeCompare(a.created_at)))
  }, [])

  const drop = useCallback((id: string) => {
    forgetMediaUrl(id)
    setItems((list) => list.filter((i) => i.id !== id))
  }, [])

  return { status, items, loaded, refresh, reloadStatus, upsert, drop }
}

/* ------------------------------------------------------------------ showing a finished file */
const urls = new Map<string, string>()

/** A picture becomes a data URL; a video a blob URL (the window's CSP allows `media-src blob:` only). */
export function toUrl(content: MediaContent): string {
  if (content.mime.startsWith('image/')) return `data:${content.mime};base64,${content.data_base64}`
  const bytes = Uint8Array.from(atob(content.data_base64), (c) => c.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: content.mime }))
}

export function forgetMediaUrl(id: string): void {
  const url = urls.get(id)
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
  urls.delete(id)
}

/** The finished file of an item, fetched once from the encrypted store and then remembered. */
export function useMediaUrl(item: Pick<MediaItem, 'id' | 'status'>): string | undefined {
  const [url, setUrl] = useState(() => urls.get(item.id))
  useEffect(() => {
    if (item.status !== 'done' || urls.has(item.id)) {
      setUrl(urls.get(item.id))
      return
    }
    let alive = true
    api.media
      .content(item.id)
      .then((content) => {
        const made = toUrl(content)
        urls.set(item.id, made)
        if (alive) setUrl(made)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [item.id, item.status])
  return url
}
