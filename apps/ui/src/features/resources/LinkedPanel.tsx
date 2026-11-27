import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { pluralise } from '@/lib/format'
import type { LinkedResource, ResourceEntry } from '@/lib/types'
import { formatEuro, resourceById } from '@/data/resources'
import { Button } from '@/components/ui/button'
import { SectionHeading } from '@/features/skills/shared'
import { KindTile } from './ResourceParts'

const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1]

/**
 * What is linked, and what each has cost this month against the limit set
 * when it was linked. Linking sends nothing, so a new link starts at nothing
 * spent and says it has not been used.
 */
export function LinkedPanel({ linked, onUnlink }: { linked: LinkedResource[]; onUnlink: (resource: ResourceEntry) => void }) {
  const unused = linked.every((l) => l.uses === 0)
  return (
    <section aria-labelledby="resources-linked">
      <SectionHeading id="resources-linked" title="Linked to my AI" right={`${linked.length} linked`}>
        {unused ? 'Nothing has been sent to any of these yet.' : 'Everything sent to these is listed in Activity.'} AIOS asks you each time before it uses one.
      </SectionHeading>
      <ul className="@container mt-4 overflow-hidden rounded-xl border border-line bg-white shadow-card" aria-label="Linked resources">
        <AnimatePresence initial={false}>
          {linked.map((item) => {
            const resource = resourceById(item.id)
            if (!resource) return null
            return (
              <motion.li
                key={item.id}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.28, ease: EASE }}
                className="overflow-hidden border-t border-line-soft first:border-t-0"
              >
                <div className="grid items-center gap-x-8 gap-y-3 px-5 py-4 @2xl:grid-cols-[minmax(0,1fr)_17rem_auto]">
                  <div className="flex min-w-0 items-center gap-3.5">
                    <KindTile resource={resource} />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-ink">{resource.name}</h3>
                      <p className="mt-0.5 text-xs leading-4.5 text-ink-50">
                        {resource.provider} · {resource.region}
                      </p>
                    </div>
                  </div>
                  <SpendMeter item={item} name={resource.name} />
                  <div>
                    <Button variant="ghost" size="sm" onClick={() => onUnlink(resource)} aria-label={`Unlink ${resource.name}`}>
                      Unlink
                    </Button>
                  </div>
                </div>
                {(item.models?.length ?? 0) > 1 && <ModelUsage item={item} />}
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
    </section>
  )
}

/** Spending this month against the limit. Brass once most of the limit is gone, because that needs the person. */
function SpendMeter({ item, name }: { item: LinkedResource; name: string }) {
  const limit = item.monthly_limit
  const ratio = limit ? Math.max(0, Math.min(1, item.spent / limit)) : 0
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 text-xs leading-5 text-ink-soft">
        <span>
          <span className="font-mono text-sm font-medium tabular text-ink">{formatEuro(item.spent)}</span>
          {limit !== null && (
            <>
              {' '}
              of <span className="font-mono tabular">{formatEuro(limit)}</span>
            </>
          )}{' '}
          this month
        </span>
        <span className="shrink-0 text-ink-50">{item.uses === 0 ? 'Not used yet' : item.kind === 'video' ? `${pluralise(item.uses, 'video')} made` : `Used ${pluralise(item.uses, 'time')}`}</span>
      </div>
      {limit !== null ? (
        <div role="meter" aria-label={`Spending on ${name} this month`} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={item.spent} aria-valuetext={`${formatEuro(item.spent)} of ${formatEuro(limit)}`} className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-6 shadow-[inset_0_0_0_1px_rgba(22,33,27,0.05)]">
          <span className={cn('block h-full rounded-full transition-[width] duration-500 ease-(--ease-out)', ratio >= 0.8 ? 'bg-brass' : 'bg-green')} style={{ width: `${ratio * 100}%` }} />
        </div>
      ) : (
        <p className="mt-0.5 text-xs leading-4.5 text-ink-50">No monthly limit</p>
      )}
      <p className="mt-1 font-mono text-2xs leading-4 tabular text-ink-50">
        {item.kind === 'video'
          ? `${pluralise(item.videos ?? 0, 'video')} · ${(item.video_seconds ?? 0).toLocaleString('en-GB')} seconds of video this month`
          : `${tokenWords(item.tokens_in ?? 0)} read · ${tokenWords(item.tokens_out ?? 0)} written this month`}
      </p>
    </div>
  )
}

/** A provider with several models: how many its key can use, and what each used this month. */
function ModelUsage({ item }: { item: LinkedResource }) {
  const all = item.models ?? []
  const used = all.filter((m) => m.uses > 0)
  return (
    <ul className="mx-5 mb-4 divide-y divide-line-soft rounded-lg border border-line-soft bg-paper text-xs leading-5" aria-label={`Models of ${item.name ?? item.id}`}>
      <li className="px-3 py-1.5 text-ink-50">
        {pluralise(all.length, 'model')} to pick from in a conversation{used.length ? '. Used this month:' : '. None used yet.'}
      </li>
      {used.map((m) => (
        <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-1.5">
          <span className="font-medium text-ink">{m.name}</span>
          <span className="font-mono text-2xs tabular text-ink-50">
            {m.uses === 0 ? 'Not used yet' : `${tokenWords(m.tokens_in)} read · ${tokenWords(m.tokens_out)} written`}
            {m.price_in !== null || m.price_out !== null ? ` · ${formatEuro(m.spent)}` : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** "12,400 tokens": the provider's own count, as the company is charged for it. */
function tokenWords(n: number): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? 'token' : 'tokens'}`
}
