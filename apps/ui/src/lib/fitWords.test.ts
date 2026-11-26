import { describe, expect, it } from 'vitest'
import type { CatalogueEntry, Hardware, ModelFit } from './types'
import { fitOnThisComputer } from './words'

const entry = { entry_id: 'm', tier: 'medium', size_bytes: 5e9 } as CatalogueEntry
const base: Hardware = { cpu: '', cores: 8, ram_gb: 16, free_disk_gb: 100, os: '', recommended_tier: null }
const hw = (f: Partial<ModelFit>): Hardware => ({
  ...base,
  models: [{ entry_id: 'm', fit: 'well', runs_on: 'card', reason: null, tokens_per_second: 40, first_word_s: 1, measured: false, ...f }],
})

describe('how a model runs here: the backend decides, the app words it', () => {
  it('runs well, with its speed in words a second', () => {
    expect(fitOnThisComputer(entry, hw({}))).toEqual({ fit: 'well', line: 'Runs well on this computer, about 30 words a second' })
  })
  it('runs slowly, with its speed', () => {
    expect(fitOnThisComputer(entry, hw({ fit: 'slowly', runs_on: 'processor', reason: 'slow', tokens_per_second: 6 })).line).toBe(
      'Runs on this computer, slowly: about 5 words a second',
    )
  })
  it('says when answers are slow to start', () => {
    expect(fitOnThisComputer(entry, hw({ fit: 'slowly', reason: 'first_word', first_word_s: 24.9 })).line).toBe(
      'Runs on this computer, but answers take about 25 seconds to start',
    )
  })
  it('does not fit: drive or memory', () => {
    expect(fitOnThisComputer(entry, hw({ fit: 'no', runs_on: null, reason: 'disk' }))).toEqual({ fit: 'no', line: 'Not enough free space on this computer' })
    expect(fitOnThisComputer(entry, hw({ fit: 'no', runs_on: null, reason: 'memory' })).line).toBe('Not enough memory on this computer')
  })
  it('a model the backend did not report is not offered', () => {
    expect(fitOnThisComputer(entry, base).fit).toBe('no')
  })
})
