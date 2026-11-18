import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { simBridge } from '@/bridge/sim'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import { VoiceSection } from './VoiceSection'

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <VoiceSection />
    </QueryClientProvider>,
  )

const setLanguages = (voice_languages: string[] | null) => useStore.setState((s) => ({ settings: { ...s.settings, voice_languages } }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  setLanguages(null)
})

describe('Settings > Voice (ADR 0016)', () => {
  it('says what happens with no languages chosen', () => {
    show()
    expect(screen.getByText(/None chosen/)).toBeTruthy()
  })

  it('lists the languages main first, and can make another one main or remove it', async () => {
    const update = vi.spyOn(api.settings, 'update').mockResolvedValue()
    setLanguages(['it', 'en'])
    show()
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toContain('Italian')
    expect(items[0]).toContain('Main')
    expect(items[1]).toContain('English')
    fireEvent.click(screen.getByRole('button', { name: /Make main/ }))
    expect(update).toHaveBeenLastCalledWith({ voice_languages: ['en', 'it'] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Italian' }))
    expect(update).toHaveBeenLastCalledWith({ voice_languages: ['en'] })
  })

  it('removing the last language clears the choice', async () => {
    const update = vi.spyOn(api.settings, 'update').mockResolvedValue()
    setLanguages(['it'])
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Italian' }))
    expect(update).toHaveBeenLastCalledWith({ voice_languages: null })
  })

  it('offers to download a missing speech model', async () => {
    vi.spyOn(simBridge.voice, 'status').mockResolvedValue({
      state: 'no_model',
      build: null,
      model: { status: 'missing', received_bytes: 0, total_bytes: 190_085_487, error: null },
    })
    const download = vi.spyOn(simBridge.voice, 'downloadModel').mockResolvedValue({
      state: 'no_model',
      build: null,
      model: { status: 'downloading', received_bytes: 1_000_000, total_bytes: 190_085_487, error: null },
    })
    show()
    fireEvent.click(await screen.findByRole('button', { name: /Download/ }))
    expect(download).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText(/Downloading:/)).toBeTruthy())
  })
})
