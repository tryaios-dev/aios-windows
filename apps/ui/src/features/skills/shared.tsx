import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/* ---------------- Smooth height ---------------- */

/**
 * Follows the height of whatever is inside it, so content that arrives or is
 * swapped after an action opens smoothly and what sits below slides instead
 * of jumping. The first measurement is applied before paint, so nothing moves
 * when the page or dialog opens.
 */
export function SmoothHeight({ className, gutter, children }: { className?: string; /** Leave room at the sides for focus rings. */ gutter?: boolean; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const measure = () => setHeight(el.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className={cn('overflow-hidden transition-[height] duration-(--duration-view) ease-(--ease-out) motion-reduce:transition-none', gutter && '-mx-2 px-2', className)} style={{ height }}>
      <div ref={inner} className="flow-root">
        {children}
      </div>
    </div>
  )
}

/* ---------------- Section heading ---------------- */

/** A section of a page: what it is, one sentence about it, and a quiet count on the right. */
export function SectionHeading({ id, title, right, children }: { id: string; title: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1.5">
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-semibold leading-6 text-ink">
          {title}
        </h2>
        {children && <p className="mt-1 max-w-2xl text-sm leading-5 text-ink-soft">{children}</p>}
      </div>
      {right && <div className="label-mono shrink-0 pb-0.5 tabular">{right}</div>}
    </div>
  )
}

/* ---------------- Numbered steps ---------------- */

/** A short numbered list of plain statements. */
export function Steps({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ol className={cn('flex flex-col gap-3', className)}>
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3">
          <span aria-hidden className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-green/20 bg-green-wash font-mono text-2xs font-medium tabular text-green">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 text-sm leading-5 text-ink">{item}</span>
        </li>
      ))}
    </ol>
  )
}
