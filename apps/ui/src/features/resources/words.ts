import type { ResourceEntry } from '@/lib/types'

/** "Runs in Frankfurt, Germany" as a place alone: "Frankfurt, Germany". */
export function placeOf(resource: ResourceEntry): string {
  return resource.region.replace(/^Runs in /, '')
}

/** What a resource is, in the words of the two groups on the page. */
export function kindWords(resource: ResourceEntry): string {
  return resource.kind === 'compute' ? 'Computing power by the hour' : 'An AI model in the cloud'
}

/** The monthly spending limits offered when linking. `null` is no limit. */
export const LIMIT_CHOICES: Array<{ value: string; amount: number | null; label: string }> = [
  { value: 'none', amount: null, label: 'No limit' },
  { value: '10', amount: 10, label: '€10' },
  { value: '25', amount: 25, label: '€25' },
  { value: '50', amount: 50, label: '€50' },
]

export const DEFAULT_LIMIT = '25'
