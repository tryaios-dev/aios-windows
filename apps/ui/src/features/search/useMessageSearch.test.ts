import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { SearchHit } from '@/lib/types'
import { useMessageSearch } from './useMessageSearch'

const HIT = { message_id: 'm1', conversation_id: 'c1', project_id: 'p1', role: 'user', snippet: 'invoice', created_at: '2026-11-11T10:00:00Z' } as unknown as SearchHit

afterEach(() => vi.restoreAllMocks())

describe('message search (K-07)', () => {
  it('returns the hits the backend found', async () => {
    vi.spyOn(api, 'search').mockResolvedValue([HIT])
    const { result } = renderHook(() => useMessageSearch('invoice', null))
    await waitFor(() => expect(result.current.hits).toEqual([HIT]))
    expect(result.current.failed).toBe(false)
  })

  it('says the search failed instead of showing "no results", and can try again', async () => {
    const search = vi.spyOn(api, 'search').mockRejectedValueOnce(new Error('backend_unavailable'))
    const { result } = renderHook(() => useMessageSearch('invoice', null))
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.hits).toEqual([])

    search.mockResolvedValueOnce([HIT])
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.hits).toEqual([HIT]))
    expect(result.current.failed).toBe(false)
  })
})
