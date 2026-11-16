import type { ResourceEntry } from '@/lib/types'

/**
 * What "Add resources to my AI" lists. Demonstration data only: no reseller
 * agreements exist yet, so every provider, price and saving here is an
 * example of how the list will read, not an offer.
 */
export const RESOURCES: ResourceEntry[] = [
  {
    id: 'deepseek-v4',
    kind: 'model',
    name: 'DeepSeek V4',
    provider: 'DeepSeek',
    line: 'A strong all-rounder for long documents and careful reasoning.',
    good_for: ['Long reports', 'Research', 'Code'],
    region: 'Runs in Frankfurt, Germany',
    unit: 'per million words read',
    list_price: 0.56,
    price: 0.34,
    price_out: { unit: 'per million words written', list_price: 1.68, price: 1.01 },
    popular: true,
  },
  {
    id: 'gemini-3-pro',
    kind: 'model',
    name: 'Gemini 3 Pro',
    provider: 'Google',
    line: 'Reads very large amounts at once: whole folders, long recordings.',
    good_for: ['Very large document sets', 'Video and audio', 'Research'],
    region: 'Runs in the Netherlands',
    unit: 'per million words read',
    list_price: 2.5,
    price: 1.5,
    price_out: { unit: 'per million words written', list_price: 15, price: 9 },
  },
  {
    id: 'kimi-k2',
    kind: 'model',
    name: 'Kimi K2',
    provider: 'Moonshot AI',
    line: 'Fast and inexpensive for everyday drafting at volume.',
    good_for: ['Bulk drafting', 'Translation', 'Summaries'],
    region: 'Runs in Frankfurt, Germany',
    unit: 'per million words read',
    list_price: 0.6,
    price: 0.6,
    price_out: { unit: 'per million words written', list_price: 2.5, price: 2.5 },
  },
  {
    id: 'hunyuan-video',
    kind: 'model',
    name: 'Hunyuan Video 4',
    provider: 'Tencent',
    line: 'Makes and finishes short video from a description or a rough cut.',
    good_for: ['Video', 'Images'],
    region: 'Runs in Paris, France',
    unit: 'per second of video',
    list_price: 0.12,
    price: 0.06,
    popular: true,
  },
  {
    id: 'gpu-4090',
    kind: 'compute',
    name: 'One RTX 4090',
    provider: 'NordGrid Compute',
    line: 'A large graphics card by the hour, for bigger AI models than this computer can hold.',
    good_for: ['Bigger AI models', 'Image generation'],
    region: 'Runs in Stockholm, Sweden',
    unit: 'per hour',
    list_price: 0.69,
    price: 0.49,
  },
  {
    id: 'gpu-h100',
    kind: 'compute',
    name: 'One H100',
    provider: 'NordGrid Compute',
    line: 'Top-of-the-range computing power, for video and very large jobs.',
    good_for: ['Video', 'Very large document sets', 'Bigger AI models'],
    region: 'Runs in Stockholm, Sweden',
    unit: 'per hour',
    list_price: 3.2,
    price: 2.25,
  },
]

export const resourceById = (id: string) => RESOURCES.find((r) => r.id === id)

/**
 * "What do you want to do?" The guide starts from the job, not the product.
 * `local` means this computer can do it: the honest answer is then that no
 * extra resource is needed.
 */
export interface GuideTask {
  id: string
  label: string
  /** A sentence that repeats the job back, used in the recommendation. */
  job: string
  local: boolean
  /** Resource ids to suggest, best first, when this computer is not enough. */
  suggest: string[]
  why: string
}

export const GUIDE_TASKS: GuideTask[] = [
  { id: 'write', label: 'Write, summarise or answer questions', job: 'writing, summarising and answering questions', local: true, suggest: [], why: 'Your AI model already does this well on this computer. You do not need anything extra, and nothing has to leave this computer.' },
  { id: 'documents', label: 'Work through a very large set of documents', job: 'working through a very large set of documents', local: false, suggest: ['gemini-3-pro', 'deepseek-v4'], why: 'A few hundred pages is fine here. Thousands of pages at once need an AI model that can hold far more in mind than this computer can.' },
  { id: 'video', label: 'Make or finish a video', job: 'making or finishing a video', local: false, suggest: ['hunyuan-video', 'gpu-h100'], why: 'Video needs far more computing power than a laptop or office PC has.' },
  { id: 'images', label: 'Create images', job: 'creating images', local: false, suggest: ['gpu-4090', 'hunyuan-video'], why: 'Image generation runs best on a large graphics card. You can rent one by the hour.' },
  { id: 'research', label: 'Write a long, careful research report', job: 'writing a long, careful research report', local: false, suggest: ['deepseek-v4', 'gemini-3-pro'], why: 'Your AI model can draft this, but a larger one reasons through long material more reliably.' },
  { id: 'code', label: 'Write or review a lot of code', job: 'writing or reviewing a lot of code', local: false, suggest: ['deepseek-v4', 'kimi-k2'], why: 'Short scripts are fine here. Large codebases go better with a bigger AI model.' },
]

export function formatEuro(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

/** Whole-number percentage saved against the provider's usual price, or 0. */
export function saving(list: number, price: number): number {
  return list > price ? Math.round((1 - price / list) * 100) : 0
}
