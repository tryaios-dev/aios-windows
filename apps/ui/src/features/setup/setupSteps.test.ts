import { describe, expect, it } from 'vitest'
import type { RunStep, RunStepId } from './setupRun'
import { ORDER, progress, type Facts } from './setupSteps'

const run = (state: RunStep['state'], over: Partial<Record<RunStepId, RunStep>> = {}): Record<RunStepId, RunStep> => ({
  rules: { state },
  activity: { state },
  storage: { state },
  knowledge: { state },
  engine: { state },
  ...over,
})

const facts = (over: Partial<Facts> = {}): Facts => ({
  run: run('waiting'),
  model: 'adding',
  modelDetail: 'Starting',
  modelFraction: 0,
  voice: { state: 'waiting', fraction: 0 },
  ...over,
})

const VOICE_READY = { state: 'ready', fraction: 1 } as const
const ids = (f: Facts) => progress(f).lines.map((l) => l.id)

describe('Setting up shows the real state of every part (test findings 4 and 5)', () => {
  it("has the design's eight parts, in the design's order", () => {
    expect(ORDER).toEqual(['storage', 'documents', 'knowledge', 'voice', 'memory', 'rules', 'activity', 'model'])
  })

  it('at the start only the AI model shows, and nothing is ticked', () => {
    const p = progress(facts())
    expect(p.lines.map((l) => l.id)).toEqual(['model'])
    expect([p.ready, p.total, p.percent, p.finished]).toEqual([0, 8, 0, false])
  })

  it('a part shows once it has started, in the design order, with the AI model last', () => {
    expect(ids(facts({ run: run('waiting', { storage: { state: 'running' }, rules: { state: 'done' } }) }))).toEqual(['storage', 'rules', 'model'])
    expect(ids(facts({ run: run('done', { knowledge: { state: 'running' } }), voice: { state: 'downloading', fraction: 0.2 } }))).toEqual(ORDER)
  })

  it('document reading and memory are ready once the storage is, and not before', () => {
    const before = progress(facts({ run: run('waiting', { storage: { state: 'running' } }) }))
    expect(before.lines.map((l) => l.id)).not.toContain('documents')
    const after = progress(facts({ run: run('waiting', { storage: { state: 'done' } }) }))
    expect(after.lines.filter((l) => l.state === 'done').map((l) => l.id)).toEqual(['storage', 'documents', 'memory'])
  })

  it('the title names a part that is running, before the long download', () => {
    const p = progress(facts({ run: run('done', { activity: { state: 'running' } }), voice: VOICE_READY, modelFraction: 0.3 }))
    expect(p.featured).toBe('activity')
    const later = progress(facts({ run: run('done'), voice: VOICE_READY, modelFraction: 0.3 }))
    expect(later.featured).toBe('model')
  })

  it('the counter counts the ticked lines', () => {
    const p = progress(facts({ run: run('done'), voice: VOICE_READY }))
    expect(p.ready).toBe(p.lines.filter((l) => l.state === 'done').length)
    expect([p.ready, p.total]).toEqual([7, 8])
  })

  it('the percentage covers every part, not only the AI model download', () => {
    const quick = progress(facts({ run: run('done') }))
    expect(quick.percent).toBeGreaterThan(0)
    const half = progress(facts({ run: run('done'), voice: VOICE_READY, modelFraction: 0.5 }))
    expect(half.percent).toBeGreaterThan(quick.percent)
    const checking = progress(facts({ run: run('done'), voice: VOICE_READY, model: 'checking', modelFraction: 1 }))
    expect(checking.percent).toBeGreaterThan(half.percent)
    expect(checking.percent).toBeLessThan(100)
  })

  it('the AI model is one line: downloading, then checking, then downloaded and checked', () => {
    const line = (f: Partial<Facts>) => progress(facts(f)).lines.find((l) => l.id === 'model')
    expect(line({ modelFraction: 0.4 })).toMatchObject({ state: 'current', title: 'Downloading your AI model' })
    expect(line({ model: 'checking', modelFraction: 1 })).toMatchObject({ state: 'current', title: 'Checking your AI model' })
    expect(line({ model: 'ready', modelDetail: 'Standard · Qwen3 8B, 4.9 GB' })).toMatchObject({ state: 'done', title: 'Your AI model is downloaded and checked', detail: 'Standard · Qwen3 8B, 4.9 GB' })
    expect(line({ model: 'damaged' })?.state).toBe('failed')
  })

  it('100% means everything is done; the engine starting does not hold it up', () => {
    const done = progress(facts({ run: run('done', { engine: { state: 'running' } }), voice: VOICE_READY, model: 'ready', modelFraction: 1 }))
    expect([done.percent, done.finished, done.ready, done.total]).toEqual([100, true, 8, 8])
  })

  it('with the AI model skipped, its line says so and setup can finish without it', () => {
    const p = progress(facts({ run: run('done'), voice: VOICE_READY, model: 'skipped' }))
    expect(p.lines.filter((l) => l.state === 'skipped').map((l) => l.id)).toEqual(['model'])
    expect([p.finished, p.ready, p.total]).toEqual([true, 7, 7])
  })

  it('Voice failing does not hold setup up; the storage or knowledge base failing does', () => {
    expect(progress(facts({ run: run('done'), voice: { state: 'failed', fraction: 1 }, model: 'ready' })).finished).toBe(true)
    const storage = progress(facts({ run: run('done', { storage: { state: 'failed' } }), voice: VOICE_READY, model: 'ready' }))
    expect([storage.finished, storage.featured]).toEqual([false, 'storage'])
    const knowledge = progress(facts({ run: run('done', { knowledge: { state: 'failed' } }), voice: VOICE_READY, model: 'ready' }))
    expect([knowledge.finished, knowledge.featured]).toEqual([false, 'knowledge'])
  })

  it('a paused download is what the title names when nothing else runs', () => {
    const p = progress(facts({ run: run('done'), voice: VOICE_READY, model: 'paused', modelFraction: 0.4 }))
    expect(p.featured).toBe('model')
    expect(p.lines.find((l) => l.id === 'model')).toMatchObject({ state: 'paused', title: 'Download paused' })
  })

  it('a build without Voice has no Voice line and counts seven', () => {
    const p = progress(facts({ voice: null, run: run('done') }))
    expect(p.lines.map((l) => l.id)).not.toContain('voice')
    expect(p.total).toBe(7)
  })
})
