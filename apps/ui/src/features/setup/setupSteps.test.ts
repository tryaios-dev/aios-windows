import { describe, expect, it } from 'vitest'
import type { RunStep, RunStepId } from './setupRun'
import { ORDER, progress, type Facts } from './setupSteps'

const run = (state: RunStep['state'], over: Partial<Record<RunStepId, RunStep>> = {}): Record<RunStepId, RunStep> => ({
  rules: { state },
  activity: { state },
  storage: { state },
  project: { state },
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

describe('Setting up shows the real state of every part (test findings 4 and 5)', () => {
  it('every line is there from the start, in order, and nothing is ticked', () => {
    const p = progress(facts())
    expect(p.lines.map((l) => l.id)).toEqual(ORDER)
    expect(ORDER).toHaveLength(8)
    expect(p.lines.filter((l) => l.id !== 'download').every((l) => l.state === 'waiting')).toBe(true)
    expect([p.ready, p.total, p.percent, p.finished]).toEqual([0, 8, 0, false])
  })

  it('the title names a part that is running right now', () => {
    const p = progress(facts({ run: run('done', { engine: { state: 'waiting' } }), voice: { state: 'ready', fraction: 1 }, modelFraction: 0.3 }))
    expect(p.featured).toBe('download')
    expect(p.lines.find((l) => l.id === p.featured)?.state).toBe('current')
  })

  it('the counter counts the ticked lines', () => {
    const p = progress(facts({ run: run('done', { engine: { state: 'waiting' } }), voice: { state: 'ready', fraction: 1 } }))
    expect(p.ready).toBe(p.lines.filter((l) => l.state === 'done').length)
    expect(p.ready).toBe(5) // storage, rules, activity, voice, project
  })

  it('the percentage covers every part, not only the AI model download', () => {
    const quick = progress(facts({ run: run('done', { engine: { state: 'waiting' } }) }))
    expect(quick.percent).toBeGreaterThan(0)
    const half = progress(facts({ run: run('done', { engine: { state: 'waiting' } }), voice: { state: 'ready', fraction: 1 }, modelFraction: 0.5 }))
    expect(half.percent).toBeGreaterThan(quick.percent)
    expect(half.percent).toBeLessThan(100)
  })

  it('100% means everything is done', () => {
    const almost = progress(facts({ run: run('done', { engine: { state: 'running' } }), voice: { state: 'ready', fraction: 1 }, model: 'ready', modelFraction: 1 }))
    expect([almost.percent < 100, almost.finished, almost.featured]).toEqual([true, false, 'engine'])
    const done = progress(facts({ run: run('done'), voice: { state: 'ready', fraction: 1 }, model: 'ready', modelFraction: 1 }))
    expect([done.percent, done.finished, done.ready, done.total]).toEqual([100, true, 8, 8])
  })

  it('while the model is checked, the download is ticked and the check runs', () => {
    const p = progress(facts({ model: 'checking', modelFraction: 1 }))
    expect(p.lines.find((l) => l.id === 'download')?.state).toBe('done')
    expect(p.lines.find((l) => l.id === 'check')?.state).toBe('current')
  })

  it('with the AI model skipped, its lines say so and setup can finish without them', () => {
    const p = progress(facts({ run: run('done', { engine: { state: 'waiting' } }), voice: { state: 'ready', fraction: 1 }, model: 'skipped' }))
    expect(p.lines.filter((l) => l.state === 'skipped').map((l) => l.id)).toEqual(['download', 'check', 'engine'])
    expect([p.finished, p.ready, p.total]).toEqual([true, 5, 5])
  })

  it('Voice or the engine failing does not hold setup up; the storage failing does', () => {
    const optional = progress(facts({ run: run('done', { engine: { state: 'failed' } }), voice: { state: 'failed', fraction: 1 }, model: 'ready' }))
    expect(optional.finished).toBe(true)
    const storage = progress(facts({ run: run('done', { storage: { state: 'failed' } }), voice: { state: 'ready', fraction: 1 }, model: 'ready' }))
    expect([storage.finished, storage.featured]).toEqual([false, 'storage'])
  })

  it('a paused download is what the title names when nothing else runs', () => {
    const p = progress(facts({ run: run('done', { engine: { state: 'waiting' } }), voice: { state: 'ready', fraction: 1 }, model: 'paused', modelFraction: 0.4 }))
    expect(p.featured).toBe('download')
    expect(p.lines.find((l) => l.id === 'download')?.state).toBe('paused')
  })

  it('a build without Voice has no Voice line', () => {
    expect(progress(facts({ voice: null })).lines.map((l) => l.id)).not.toContain('voice')
  })
})
