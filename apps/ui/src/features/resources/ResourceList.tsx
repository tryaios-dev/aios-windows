import { MapPin } from 'lucide-react'
import type { ResourceEntry } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/chips'
import { KindTile, LinkedMark, PriceLines } from './ResourceParts'

/**
 * One group of "Everything you can add", read like a price list: what it is
 * and who runs it on the left, what it costs in the middle, one action on the
 * right. Below a comfortable width each entry stacks in the same order.
 */
export function ResourceGroup({ id, title, description, resources, linkedIds, linkedHere, onLink }: { id: string; title: string; description: string; resources: ResourceEntry[]; linkedIds: ReadonlySet<string>; /** Linked on this visit: the tick draws itself. */ linkedHere: ReadonlySet<string>; onLink: (resource: ResourceEntry) => void }) {
  return (
    <section aria-labelledby={id} className="@container overflow-hidden rounded-xl border border-line bg-white shadow-card">
      <div className="border-b border-line-soft bg-paper-raised px-5 py-3.5">
        <h3 id={id} className="text-base font-semibold text-ink">
          {title}
        </h3>
        <p className="mt-0.5 max-w-2xl text-sm leading-5 text-ink-soft">{description}</p>
      </div>
      <ul>
        {resources.map((resource) => (
          <li key={resource.id} className="border-b border-line-soft last:border-b-0">
            <ResourceRow resource={resource} linked={linkedIds.has(resource.id)} drawn={linkedHere.has(resource.id)} onLink={() => onLink(resource)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ResourceRow({ resource, linked, drawn, onLink }: { resource: ResourceEntry; linked: boolean; drawn: boolean; onLink: () => void }) {
  return (
    <div className="grid gap-x-8 gap-y-4 px-5 py-5 @3xl:grid-cols-[minmax(0,1fr)_21.5rem_5.5rem] @3xl:items-center">
      <div className="flex min-w-0 items-start gap-3.5">
        <KindTile resource={resource} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h4 className="text-md font-semibold text-ink">{resource.name}</h4>
            <span className="text-sm leading-5 text-ink-50">{resource.provider}</span>
            {resource.popular && <Badge tone="green">Popular</Badge>}
          </div>
          <p className="mt-0.5 text-sm leading-5 text-ink-soft">{resource.line}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="sr-only">Good for</span>
            {resource.good_for.map((use) => (
              <Badge key={use}>{use}</Badge>
            ))}
            <span className="ml-1 inline-flex items-center gap-1 text-xs leading-4.5 text-ink-50">
              <MapPin className="size-3 shrink-0" strokeWidth={2} aria-hidden />
              {resource.region}
            </span>
          </div>
        </div>
      </div>

      <PriceLines resource={resource} aligned className="max-w-[21.5rem] @3xl:max-w-none" />

      <div className="flex @3xl:justify-end">
        {linked ? (
          <LinkedMark drawn={drawn} />
        ) : (
          <Button size="sm" className="min-w-[5.5rem]" onClick={onLink} aria-label={`Link ${resource.name}`}>
            Link
          </Button>
        )}
      </div>
    </div>
  )
}
