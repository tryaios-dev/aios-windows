import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '@aios/bridge-contract'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import type { Project } from '@/lib/types'
import { MediaView } from './MediaView'

const PROJECT: Project = {
  id: 'p1',
  name: 'Campaign',
  classification: 'internal',
  classification_source: 'project',
  company_ai_enabled: false,
  archived: false,
  created_at: '2026-11-19T10:00:00Z',
  updated_at: '2026-11-19T10:00:00Z',
}

const ITEM: MediaItem = {
  id: 'm1',
  project_id: 'p1',
  kind: 'image',
  model: 'flux-schnell',
  prompt: 'A lighthouse at sunset',
  negative_prompt: null,
  width: 1024,
  height: 1024,
  frames: null,
  seed: 7,
  status: 'running',
  progress: 0.5,
  position: null,
  error_code: null,
  mime: null,
  size_bytes: null,
  created_at: '2026-11-19T10:00:00Z',
  finished_at: null,
}

const AVAILABLE = {
  available: true,
  reason: null,
  models: [
    { id: 'flux-schnell', kind: 'image' as const },
    { id: 'sdxl-lightning', kind: 'image' as const },
    { id: 'wan2.1-t2v-1.3b', kind: 'video' as const },
  ],
}

const show = () =>
  render(
    <MemoryRouter initialEntries={['/projects/p1/media']}>
      <Routes>
        <Route path="/projects/:projectId/media" element={<MediaView />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  useStore.setState({ projects: [PROJECT] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('r-7 Images & video', () => {
  it('says why nothing can be made when the company server is not set up', async () => {
    vi.spyOn(api.media, 'status').mockResolvedValue({ available: false, reason: 'company_provider_disabled', models: [] })
    vi.spyOn(api.media, 'list').mockResolvedValue([])
    show()
    expect(await screen.findByText(/isn’t set up on this computer/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Make picture/ })).toBeNull()
  })

  it('asks before the description leaves the computer, then makes the picture', async () => {
    vi.spyOn(api.media, 'status').mockResolvedValue(AVAILABLE)
    vi.spyOn(api.media, 'list').mockResolvedValue([])
    const create = vi
      .spyOn(api.media, 'create')
      .mockResolvedValueOnce({ ok: false, code: 'confirmation_required' })
      .mockResolvedValueOnce({ ok: true, item: ITEM })
    show()
    const prompt = await screen.findByLabelText('Describe what to make')
    fireEvent.change(prompt, { target: { value: 'A lighthouse at sunset' } })
    fireEvent.click(screen.getByRole('button', { name: /Make picture/ }))
    expect(await screen.findByText('Send this description to the company server?')).toBeTruthy()
    expect(create).toHaveBeenLastCalledWith('p1', expect.objectContaining({ confirmed: false, model: 'flux-schnell', width: 1024, height: 1024 }))
    fireEvent.click(screen.getByRole('button', { name: /Send and make the picture/ }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create).toHaveBeenLastCalledWith('p1', expect.objectContaining({ confirmed: true, prompt: 'A lighthouse at sunset', frames: null }))
    expect(await screen.findByText('Making the picture… 50%')).toBeTruthy()
  })

  it('a video sends its length, two seconds by default', async () => {
    vi.spyOn(api.media, 'status').mockResolvedValue(AVAILABLE)
    vi.spyOn(api.media, 'list').mockResolvedValue([])
    const create = vi.spyOn(api.media, 'create').mockResolvedValue({ ok: true, item: { ...ITEM, kind: 'video', frames: 33, width: 832, height: 480 } })
    show()
    fireEvent.click(await screen.findByRole('radio', { name: /Video/ }))
    fireEvent.change(screen.getByLabelText('Describe what to make'), { target: { value: 'A paper boat' } })
    fireEvent.click(screen.getByRole('button', { name: /Make video/ }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create).toHaveBeenLastCalledWith('p1', expect.objectContaining({ kind: 'video', model: 'wan2.1-t2v-1.3b', width: 832, height: 480, frames: 33 }))
  })

  it('a running job can be stopped', async () => {
    vi.spyOn(api.media, 'status').mockResolvedValue(AVAILABLE)
    vi.spyOn(api.media, 'list').mockResolvedValue([ITEM])
    const cancel = vi.spyOn(api.media, 'cancel').mockResolvedValue({ ...ITEM, status: 'cancelled' })
    show()
    fireEvent.click(await screen.findByRole('button', { name: /Stop/ }))
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('m1'))
    expect(await screen.findByText('Stopped')).toBeTruthy()
  })
})
