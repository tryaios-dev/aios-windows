import { describe, expect, it } from 'vitest'
import { DEFAULT_FRAMES, IMAGE_SIZES, VIDEO_LENGTHS, VIDEO_SIZES, failureText, isPending, pickModel, seconds, sizeLabel, statusLine, unavailableText } from './options'

const MODELS = [
  { id: 'sdxl-lightning', kind: 'image' as const },
  { id: 'flux-schnell', kind: 'image' as const },
  { id: 'wan2.1-t2v-1.3b', kind: 'video' as const },
]

describe('r-7 picture and video choices', () => {
  it('starts with FLUX for pictures and Wan for videos, or the first model the server has', () => {
    expect(pickModel(MODELS, 'image')).toBe('flux-schnell')
    expect(pickModel(MODELS, 'video')).toBe('wan2.1-t2v-1.3b')
    expect(pickModel([MODELS[0]!], 'image')).toBe('sdxl-lightning')
    expect(pickModel([MODELS[0]!], 'video')).toBeUndefined()
  })

  it('offers only the sizes and lengths the company server accepts', () => {
    // services/backend/aios_backend/media: IMAGE_SIZES, VIDEO_SIZES, frames 17-81 as 4n + 1
    const server = new Set(['1024x1024', '1152x896', '896x1152', '1216x832', '832x1216', '1344x768', '768x1344', '512x512'])
    for (const s of IMAGE_SIZES) expect(server.has(`${s.width}x${s.height}`)).toBe(true)
    expect(VIDEO_SIZES.map((s) => `${s.width}x${s.height}`)).toEqual(['832x480', '480x832'])
    for (const l of VIDEO_LENGTHS) {
      expect((l.frames - 1) % 4).toBe(0)
      expect(l.frames).toBeGreaterThanOrEqual(17)
      expect(l.frames).toBeLessThanOrEqual(81)
      expect(seconds(l.frames)).toBe(l.seconds)
    }
    expect(DEFAULT_FRAMES).toBe(33) // two seconds by default
  })

  it('says how a job is going in plain words', () => {
    expect(statusLine({ status: 'queued', progress: 0, position: 2, error_code: null, kind: 'image' })).toMatch(/2 ahead/)
    expect(statusLine({ status: 'running', progress: 0.42, position: null, error_code: null, kind: 'video' })).toBe('Making the video… 42%')
    expect(statusLine({ status: 'failed', progress: 0, position: null, error_code: 'media_expired', kind: 'image' })).toMatch(/an hour/)
    expect(failureText('something_new')).toMatch(/could not be made/)
    expect(isPending({ status: 'running' })).toBe(true)
    expect(isPending({ status: 'done' })).toBe(false)
  })

  it('names sizes and explains why nothing can be made', () => {
    expect(sizeLabel({ kind: 'image', width: 1216, height: 832 })).toBe('Landscape 1216×832')
    expect(unavailableText('company_provider_disabled')).toMatch(/isn’t set up/)
    expect(unavailableText('anything_else')).toMatch(/can’t be made right now/)
  })
})
