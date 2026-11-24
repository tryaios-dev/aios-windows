import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { AiosBridge } from '@aios/bridge-contract'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import type { InstalledModel } from '@/lib/types'
import { beginSetup, chooseModel, resetSetupRun, retrySetup, useSetupRun, type SetupDeps } from './setupRun'
const [LIGHT, STANDARD] = ['minicpm5-2b-q4_k_m-openbmb-gguf', 'ornith-1.5-9b-q4_k_m-ornith-gguf']

function fakeBridge({ writerAfter = 0, storeFails = false } = {}) {
  let writerAsks = 0
  let stored = false
  const calls: string[] = []
  const b = {
    settings: { network: vi.fn(async () => [{ id: 'model-mirror' }]) },
    system: {
      status: vi.fn(async () => ({ writer: { state: writerAsks++ >= writerAfter ? 'ok' : 'unavailable', pending: 0 } })),
    },
    setup: {
      status: vi.fn(async () => ({ store_created: stored })),
      createStore: vi.fn(async () => {
        if (storeFails) throw new Error('store_failed')
        calls.push('store')
        stored = true
        return { recovery_key: 'AAAA-BBBB', package_id: 'p', stream_id: 's', signing_key_id: 'k' }
      }),
      createProject: vi.fn(async () => {
        calls.push('project')
        return { default_project_id: 'proj-1' }
      }),
    },
    voice: { downloadModel: vi.fn(async () => ({})) },
    models: { startEngine: vi.fn(async () => ({ state: 'ready' })) },
  }
  return { b, calls, bridge: () => b as unknown as AiosBridge }
}

function deps(fake: ReturnType<typeof fakeBridge>, startModel = vi.fn()): SetupDeps & { startModel: ReturnType<typeof vi.fn> } {
  return { bridge: fake.bridge, startModel, pollMs: 1, writerWaitMs: 1_000 }
}

const installed = (id: string) => ({ id, name: id, source: 'download' }) as unknown as InstalledModel

beforeEach(() => {
  vi.spyOn(api.models, 'cancel').mockImplementation(() => undefined)
  vi.spyOn(api.models, 'pause').mockImplementation(() => undefined)
  vi.spyOn(api.models, 'setDefault').mockImplementation(() => undefined)
  useStore.setState({ downloads: {}, installedModels: [], recoveryKey: null })
})

afterEach(() => {
  resetSetupRun()
  vi.restoreAllMocks()
})

describe('Setting up starts on Continue and runs each part once (findings 5, 6 and 8)', () => {
  it('the AI model starts downloading at once; the other parts run beside it', async () => {
    const fake = fakeBridge()
    const d = deps(fake)
    beginSetup(LIGHT, d)
    expect(d.startModel).toHaveBeenCalledWith(LIGHT) // before Setting up opens (finding 6)
    expect(fake.b.voice.downloadModel).toHaveBeenCalledOnce()
    await waitFor(() => expect(useSetupRun.getState().steps.project.state).toBe('done'))
    const { steps } = useSetupRun.getState()
    expect([steps.rules.state, steps.activity.state, steps.storage.state]).toEqual(['done', 'done', 'done'])
    expect(fake.calls).toEqual(['store', 'project']) // the project needs the storage
    // The key waits in this window's memory for "Save your recovery key" (finding 8).
    expect(useStore.getState().recoveryKey).toBe('AAAA-BBBB')
  })

  it('going Back and Continue again starts nothing twice', async () => {
    const fake = fakeBridge()
    const d = deps(fake)
    beginSetup(LIGHT, d)
    await waitFor(() => expect(useSetupRun.getState().steps.project.state).toBe('done'))
    beginSetup(LIGHT, d)
    expect(d.startModel).toHaveBeenCalledOnce()
    expect(fake.b.setup.createStore).toHaveBeenCalledOnce()
    expect(fake.b.voice.downloadModel).toHaveBeenCalledOnce()
  })

  it('picking another AI model cancels the first download', () => {
    const fake = fakeBridge()
    const d = deps(fake)
    beginSetup(LIGHT, d)
    useStore.setState({ downloads: { [LIGHT]: { status: 'downloading' } } as never })
    beginSetup(STANDARD, d)
    expect(api.models.cancel).toHaveBeenCalledWith(LIGHT)
    expect(d.startModel).toHaveBeenLastCalledWith(STANDARD)
  })

  it('skipping the AI model pauses its download and keeps what arrived', () => {
    const fake = fakeBridge()
    beginSetup(LIGHT, deps(fake))
    useStore.setState({ downloads: { [LIGHT]: { status: 'downloading' } } as never })
    chooseModel(null)
    expect(api.models.pause).toHaveBeenCalledWith(LIGHT)
    expect(api.models.cancel).not.toHaveBeenCalled()
  })

  it('the activity log line runs until its writer answers', async () => {
    const fake = fakeBridge({ writerAfter: 3 })
    beginSetup(LIGHT, deps(fake))
    expect(useSetupRun.getState().steps.activity.state).toBe('running')
    await waitFor(() => expect(useSetupRun.getState().steps.activity.state).toBe('done'))
    expect(fake.b.system.status).toHaveBeenCalledTimes(4)
  })

  it('the engine starts once the AI model is installed, with that model chosen for chat', async () => {
    const fake = fakeBridge()
    beginSetup(LIGHT, deps(fake))
    expect(fake.b.models.startEngine).not.toHaveBeenCalled()
    useStore.setState({ installedModels: [installed(LIGHT)] })
    await waitFor(() => expect(useSetupRun.getState().steps.engine.state).toBe('done'))
    expect(api.models.setDefault).toHaveBeenCalledWith(LIGHT)
    expect(fake.b.models.startEngine).toHaveBeenCalledOnce()
    expect(fake.b.models.startEngine).toHaveBeenCalledWith(LIGHT)
  })

  it('Try again runs only the parts that failed', async () => {
    const fake = fakeBridge({ storeFails: true })
    beginSetup(LIGHT, deps(fake))
    await waitFor(() => expect(useSetupRun.getState().steps.storage.state).toBe('failed'))
    expect(useSetupRun.getState().steps.project.state).toBe('waiting')
    fake.b.setup.createStore.mockResolvedValueOnce({ recovery_key: 'CCCC-DDDD', package_id: 'p', stream_id: 's', signing_key_id: 'k' })
    retrySetup()
    await waitFor(() => expect(useSetupRun.getState().steps.project.state).toBe('done'))
    expect(fake.b.settings.network).toHaveBeenCalledOnce()
    expect(useStore.getState().recoveryKey).toBe('CCCC-DDDD')
  })
})
