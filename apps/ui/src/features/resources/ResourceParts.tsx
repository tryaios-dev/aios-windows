import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { RESOURCE_KIND_ICON, RESOURCE_LOGO } from '@/assets/icons'
import type { ResourceEntry } from '@/lib/types'
import { formatEuro, saving } from '@/data/resources'
import { Badge } from '@/components/ui/chips'
import { DrawnCheck } from '@/features/settings/shared'

/* ---------------- Kind tile ---------------- */

/** The logo of the product behind a resource, on a white soft square. */
export function KindTile({ resource, size = 'md', className }: { resource: ResourceEntry; size?: 'sm' | 'md'; className?: string }) {
  const src = RESOURCE_LOGO[resource.id] ?? RESOURCE_KIND_ICON[resource.kind]
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center border border-line bg-white shadow-[0_1px_2px_rgba(22,33,27,0.06)]', size === 'sm' ? 'size-10 rounded-[11px]' : 'size-12 rounded-[13px]', className)}
    >
      <img src={src} alt="" draggable={false} className={size === 'sm' ? 'size-6' : 'size-7'} />
    </span>
  )
}

/* ---------------- Prices ---------------- */

/**
 * The price of a resource, one line per thing you pay for. Where AIOS is
 * cheaper, the provider's usual price is crossed out beside the AIOS price,
 * with the saving. Where it is the same, there is one price and nothing else.
 */
export function PriceLines({ resource, aligned, className }: { resource: ResourceEntry; /** Keep the column for the usual price even when it is empty, so prices line up down a list. */ aligned?: boolean; className?: string }) {
  const lines = [{ unit: resource.unit, list: resource.list_price, price: resource.price }]
  if (resource.price_out) lines.push({ unit: resource.price_out.unit, list: resource.price_out.list_price, price: resource.price_out.price })
  const usualColumn = aligned || lines.some((l) => saving(l.list, l.price) > 0)
  return (
    <ul className={cn('flex flex-col gap-1.5', className)} aria-label={`Prices for ${resource.name}`}>
      {lines.map((line) => {
        const pct = saving(line.list, line.price)
        return (
          <li key={line.unit} className={cn('grid items-baseline gap-x-2', usualColumn ? 'grid-cols-[3.25rem_3.5rem_minmax(0,1fr)_auto]' : 'grid-cols-[auto_minmax(0,1fr)]')}>
            {usualColumn && (
              <span className="text-right font-mono text-xs tabular text-ink-50">
                {pct > 0 && (
                  <s>
                    <span className="sr-only">Usual price </span>
                    {formatEuro(line.list)}
                  </s>
                )}
              </span>
            )}
            <span className={cn('font-mono text-base font-medium tabular text-ink', usualColumn && 'text-right')}>
              <span className="sr-only">{pct > 0 ? 'AIOS price ' : 'Price '}</span>
              {formatEuro(line.price)}
            </span>
            <span className="text-xs leading-5 text-ink-soft">{line.unit}</span>
            {usualColumn && (
              <span className="flex min-w-[4.25rem] justify-end">
                {pct > 0 && (
                  <Badge tone="green" className="tabular">
                    Save {pct}%
                  </Badge>
                )}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ---------------- Linked mark ---------------- */

/** "Linked", with a tick that draws itself only when the link was made on this visit. */
export function LinkedMark({ drawn, className }: { drawn: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex h-7 items-center gap-1.5 text-sm font-medium leading-5 text-green', className)}>
      {drawn ? <DrawnCheck /> : <Check className="size-4 shrink-0" strokeWidth={2} aria-hidden />}
      Linked
    </span>
  )
}
