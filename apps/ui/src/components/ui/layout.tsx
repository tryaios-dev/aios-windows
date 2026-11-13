import * as React from 'react'
import { useLocation } from 'react-router'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'
import { shortHash } from '@/lib/hash'
import { Tooltip } from './overlays'

/* ---------------- Card ---------------- */

export function Card({ className, children, padded = true, raised }: { className?: string; children: React.ReactNode; padded?: boolean; raised?: boolean }) {
  return <div className={cn('rounded-lg border border-line bg-paper-raised', raised && 'bg-white shadow-card', padded && 'p-4', className)}>{children}</div>
}

/* ---------------- Section label ---------------- */

export function SectionLabel({ children, className, right }: { children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <span className="label-mono">{children}</span>
      {right && <span className="label-mono">{right}</span>}
    </div>
  )
}

/* ---------------- Kbd ---------------- */

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-paper px-1 font-mono text-2xs text-ink-50 shadow-[0_1px_0_var(--color-line)]', className)}>{children}</kbd>
}

/* ---------------- Mono / hash ---------------- */

export function useCopy(timeout = 1600) {
  const [copied, setCopied] = React.useState(false)
  const copy = React.useCallback(
    (text: string) => {
      navigator.clipboard?.writeText(text).catch(() => undefined)
      setCopied(true)
      window.setTimeout(() => setCopied(false), timeout)
    },
    [timeout],
  )
  return { copied, copy }
}

export function Hash({ value, head = 8, tail = 6, className, copyable = true, full }: { value: string; head?: number; tail?: number; className?: string; copyable?: boolean; full?: boolean }) {
  const { copied, copy } = useCopy()
  const shown = full ? value : shortHash(value, head, tail)
  const inner = <span className={cn('font-mono text-xs tracking-[0.02em] text-ink-soft', full && 'break-all', className)}>{shown}</span>
  if (!copyable) return inner
  return (
    <Tooltip content={copied ? 'Copied' : 'Copy full value'}>
      <button
        type="button"
        onClick={() => copy(value)}
        className="group inline-flex max-w-full items-center gap-1.5 rounded-xs text-left hover:text-ink"
        aria-label="Copy full value"
      >
        {inner}
        {copied ? <Check className="size-3 shrink-0 text-green" /> : <Copy className="size-3 shrink-0 text-ink-50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />}
      </button>
    </Tooltip>
  )
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('font-mono text-xs tracking-[0.02em] text-ink-soft', className)}>{children}</span>
}

/* ---------------- Key / value rows ---------------- */

export function KeyValue({ rows, className, dense }: { rows: Array<{ k: React.ReactNode; v: React.ReactNode; hint?: React.ReactNode }>; className?: string; dense?: boolean }) {
  return (
    <dl className={cn('divide-y divide-line-soft', className)}>
      {rows.map((r, i) => (
        <div key={i} className={cn('grid grid-cols-[minmax(120px,36%)_1fr] gap-4', dense ? 'py-1.5' : 'py-2.5')}>
          <dt className="text-sm text-ink-50">
            {r.k}
            {r.hint && <div className="text-xs text-ink-50">{r.hint}</div>}
          </dt>
          <dd className="min-w-0 text-sm text-ink">{r.v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Link-style tab row for route-driven tabs. */
export function RouteTabs({ items, className }: { items: Array<{ label: string; active: boolean; onSelect: () => void; count?: number }>; className?: string }) {
  return (
    <nav aria-label="Sections" className={cn('flex items-center gap-1', className)}>
      {items.map((it) => (
        <button
          key={it.label}
          aria-current={it.active ? 'page' : undefined}
          onClick={it.onSelect}
          className={cn(
            'relative inline-flex h-9 items-center gap-1.5 rounded-sm px-2 text-sm font-medium transition-colors duration-(--duration-micro) hover:text-ink',
            it.active ? 'text-ink' : 'text-ink-50',
            'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-green after:opacity-0 after:transition-opacity after:duration-(--duration-micro)',
            it.active && 'after:opacity-100',
          )}
        >
          {it.label}
          {typeof it.count === 'number' && <span className="rounded-sm bg-ink-6 px-1 font-mono text-2xs leading-4 text-ink-50">{it.count}</span>}
        </button>
      ))}
    </nav>
  )
}

/* ---------------- Page scaffolding for global screens ---------------- */

/**
 * Every top-level page (Home, Activity, AI models, Search, Settings) sits in
 * the same column, so titles and content start at the same left edge and
 * nothing appears to jump when you move between pages.
 */
export const PAGE_COLUMN = 'mx-auto w-full max-w-[1040px] px-6 lg:px-10'

/** Remembers how far each page was scrolled, and puts it back before paint when you return. */
const scrollMemory = new Map<string, number>()

export function useScrollMemory<T extends HTMLElement>(): React.RefObject<T> {
  const ref = React.useRef<T>(null)
  const { pathname } = useLocation()
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = scrollMemory.get(pathname) ?? 0
    const onScroll = () => scrollMemory.set(pathname, el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [pathname])
  return ref
}

export function PageHeader({ title, description, actions, eyebrow, className, children }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    // The hidden overflow with a stable gutter keeps this column in line with the scrolling body below it.
    <div className="scroll-stable shrink-0 overflow-y-hidden border-b border-line-soft bg-paper">
      <div className={cn(PAGE_COLUMN, 'flex flex-col gap-3 pt-7 pb-0', className)}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {eyebrow && <div className="label-mono mb-1">{eyebrow}</div>}
            <h1 className="text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">{title}</h1>
            {description && <p className="mt-1 max-w-2xl text-base leading-[1.375rem] text-ink-soft">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {children ? <div className="-mb-px">{children}</div> : <div className="h-3" />}
      </div>
    </div>
  )
}

/**
 * The scrolling body of a page. `width` narrows the content inside the shared
 * column (it stays left-aligned with the title). Content fades in on arrival;
 * it never moves.
 */
export function PageBody({ children, className, width }: { children: React.ReactNode; className?: string; width?: string }) {
  const ref = useScrollMemory<HTMLDivElement>()
  return (
    <div ref={ref} className="scroll-stable min-h-0 flex-1 overflow-y-auto">
      <div className={cn(PAGE_COLUMN, 'animate-fade py-7')}>
        <div className={cn(width, className)}>{children}</div>
      </div>
    </div>
  )
}
