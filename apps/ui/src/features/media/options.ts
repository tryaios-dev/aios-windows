/**
 * Pictures and videos (R-7): the choices the screen offers and the words it uses. The sizes and
 * lengths are the ones the company server accepts (services/backend/aios_backend/media).
 */
import type { MediaItem, MediaKind, MediaModel } from '@aios/bridge-contract'

export interface SizeOption {
  id: string
  label: string
  width: number
  height: number
}

export const IMAGE_SIZES: SizeOption[] = [
  { id: 'square', label: 'Square', width: 1024, height: 1024 },
  { id: 'landscape', label: 'Landscape', width: 1216, height: 832 },
  { id: 'portrait', label: 'Portrait', width: 832, height: 1216 },
  { id: 'wide', label: 'Wide', width: 1344, height: 768 },
  { id: 'tall', label: 'Tall', width: 768, height: 1344 },
]

export const VIDEO_SIZES: SizeOption[] = [
  { id: 'landscape', label: 'Landscape', width: 832, height: 480 },
  { id: 'portrait', label: 'Portrait', width: 480, height: 832 },
]

/** 16 frames a second; the server takes 4n + 1 frames. Two seconds is the default: about 1.5 minutes to make. */
export const VIDEO_LENGTHS = [
  { seconds: 2, frames: 33, note: 'about 1½ min to make' },
  { seconds: 3, frames: 49, note: 'about 2½ min' },
  { seconds: 4, frames: 65, note: 'about 3½ min' },
  { seconds: 5, frames: 81, note: 'about 5 min' },
]
export const DEFAULT_FRAMES = 33

/** FLUX is as fast as SDXL on the company server and better looking, so it is the default. */
export const DEFAULT_MODEL: Record<MediaKind, string> = { image: 'flux-schnell', video: 'wan2.1-t2v-1.3b' }

const MODEL_NAMES: Record<string, { label: string; note: string }> = {
  'flux-schnell': { label: 'FLUX.1 schnell', note: 'Best quality, about 10 s' },
  'sdxl-lightning': { label: 'SDXL Lightning', note: 'Fast, about 10 s' },
  'wan2.1-t2v-1.3b': { label: 'Wan 2.1', note: 'Short clips, 480p' },
}

export const modelLabel = (id: string) => MODEL_NAMES[id]?.label ?? id
export const modelNote = (id: string) => MODEL_NAMES[id]?.note

/** The model to start with for a kind: the default when the server has it, else its first one. */
export function pickModel(models: MediaModel[], kind: MediaKind): string | undefined {
  const ofKind = models.filter((m) => m.kind === kind)
  return ofKind.find((m) => m.id === DEFAULT_MODEL[kind])?.id ?? ofKind[0]?.id
}

export const seconds = (frames: number | null | undefined) => (frames ? Math.round(((frames - 1) / 16) * 10) / 10 : 0)

export function sizeLabel(item: Pick<MediaItem, 'kind' | 'width' | 'height'>): string {
  const list = item.kind === 'video' ? VIDEO_SIZES : IMAGE_SIZES
  const found = list.find((o) => o.width === item.width && o.height === item.height)
  return found ? `${found.label} ${item.width}×${item.height}` : `${item.width}×${item.height}`
}

export const isPending = (item: Pick<MediaItem, 'status'>) => item.status === 'queued' || item.status === 'running'

/** One short line for a job that is not finished, or that did not finish. */
export function statusLine(item: Pick<MediaItem, 'status' | 'progress' | 'position' | 'error_code' | 'kind'>): string {
  switch (item.status) {
    case 'queued':
      return item.position ? `Waiting: ${item.position} ahead on the company server` : 'Waiting for the company server'
    case 'running':
      return `Making the ${item.kind === 'video' ? 'video' : 'picture'}… ${Math.round(item.progress * 100)}%`
    case 'cancelled':
      return 'Stopped'
    case 'failed':
      return failureText(item.error_code)
    default:
      return ''
  }
}

const FAILURES: Record<string, string> = {
  media_expired: 'The company server no longer had the file. It keeps finished files for an hour; make it again.',
  timeout: 'It took too long and was stopped. Try a shorter video or try again later.',
  out_of_memory: 'The company server ran out of memory. Try again in a few minutes.',
  media_no_output: 'The company server finished without a file. Try again.',
  media_bad_answer: 'The company server sent something AIOS doesn’t accept, so it was not kept.',
  media_output_too_large: 'The finished file was too large to keep.',
}

export const failureText = (code: string | null | undefined) =>
  (code && FAILURES[code]) ?? 'It could not be made. Try again, or try a different description.'

const UNAVAILABLE: Record<string, string> = {
  company_provider_disabled: 'Pictures and videos are made on your company’s AI server, which isn’t set up on this computer.',
  media_not_offered: 'Your company’s AI server doesn’t make pictures or videos yet.',
  company_key_missing: 'The company server’s key isn’t set up on this computer.',
  company_key_rejected: 'The company server refused this computer’s key. Ask your administrator for the current key.',
  media_unreachable: 'The company server can’t be reached right now. Check the connection and try again.',
  media_unavailable: 'Pictures and videos can’t be made right now. Try again in a moment.',
}

export const unavailableText = (reason: string | null | undefined) =>
  (reason && UNAVAILABLE[reason]) ?? UNAVAILABLE.media_unavailable!

/** The SDXL licence (CreativeML Open RAIL++-M) asks that its use restrictions are passed on to users. */
export const LICENCE_NOTE =
  'The picture and video models have their own licences. SDXL Lightning is covered by the CreativeML Open RAIL++-M licence, ' +
  'which does not allow some uses, for example harming people, harassment, or misleading people with false information.'
