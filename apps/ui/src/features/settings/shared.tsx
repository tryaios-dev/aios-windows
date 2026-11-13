import { useId, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { StatusDot, type DotTone } from '@/components/ui/chips'

/* ---------------- Icon tile ---------------- */

export type TileTone = 'green' | 'neutral' | 'brass' | 'deny'

const TILE_TONE: Record<TileTone, string> = {
  green: 'border-green/15 bg-green-wash text-green',
  neutral: 'border-line-soft bg-paper-raised text-ink-soft',
  brass: 'border-brass/35 bg-brass-soft text-brass-text',
  deny: 'border-deny/25 bg-deny-soft text-deny',
}

/** The AIOS soft square: one feature icon on a quiet tile. Brass only when something is waiting for the person. */
export function IconTile({ tone = 'green', size = 'md', className, children }: { tone?: TileTone; size?: 'sm' | 'md' | 'lg'; className?: string; children: ReactNode }) {
  const sizeClass = { sm: 'size-8 rounded-lg [&>svg]:size-4', md: 'size-9 rounded-[10px] [&>svg]:size-[18px]', lg: 'size-11 rounded-xl [&>svg]:size-5' }[size]
  return (
    <span className={cn('flex shrink-0 items-center justify-center border transition-colors duration-(--duration-panel) ease-(--ease-out)', sizeClass, TILE_TONE[tone], className)} aria-hidden>
      {children}
    </span>
  )
}

/* ---------------- Drawn check ---------------- */

/** A tick that draws itself once. The quiet confirmation after an action on the same page. */
export function DrawnCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('size-4 shrink-0', className)} aria-hidden>
      <motion.path
        d="M3.25 8.6 6.4 11.75 12.75 4.9"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1], delay: 0.04 }}
      />
    </svg>
  )
}

/* ---------------- Reveal ---------------- */

/**
 * Opens and closes its content with a smooth change of height, so what sits
 * below slides instead of jumping. Closed content is hidden from the keyboard
 * and from screen readers. The small gutter keeps focus rings and card
 * shadows from being clipped while it moves.
 */
export function Reveal({ open, id, className, children }: { open: boolean; id?: string; className?: string; children: ReactNode }) {
  return (
    <div
      id={id}
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'grid transition-[grid-template-rows,opacity,visibility] duration-(--duration-panel) ease-(--ease-out)',
        open ? 'visible grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="-mx-2 min-h-0 overflow-hidden px-2">
        <div className={className}>{children}</div>
      </div>
    </div>
  )
}

/* ---------------- Status row ---------------- */

const statusTone: Record<DotTone, string> = {
  green: 'text-ink-soft',
  brass: 'text-brass-text',
  deny: 'text-deny',
  neutral: 'text-ink-soft',
  ink: 'text-ink',
}

/**
 * One line of "Is everything running?": dot, name, state in plain words,
 * one line of detail, an optional action on the right.
 */
export function StatusRow({ tone, pulse, name, status, detail, action }: { tone: DotTone; pulse?: boolean; name: string; status: ReactNode; detail?: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex min-h-14 items-start gap-3.5 px-5 py-3.5">
      <StatusDot tone={tone} pulse={pulse} className="mt-1.5" />
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-[minmax(132px,30%)_1fr]">
        <span className="text-sm font-medium leading-5 text-ink">{name}</span>
        <div className="min-w-0">
          <div className={cn('text-sm leading-5', statusTone[tone])}>{status}</div>
          {detail && <div className="mt-0.5 text-xs leading-4.5 text-ink-50">{detail}</div>}
        </div>
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </li>
  )
}

/* ---------------- Advanced ---------------- */

/**
 * The third depth. Closed by default, always the last thing in a section, and
 * clearly quieter than everything above it. Engineering vocabulary is allowed
 * inside; nothing above it should need it.
 */
export function Advanced({ summary, children }: { /** What is inside, in a few words, shown next to the label. */ summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="border-t border-line-soft pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        data-state={open ? 'open' : 'closed'}
        className="group -mx-2 flex min-h-10 w-[calc(100%+1rem)] items-center gap-2.5 rounded-md px-2 text-left transition-colors duration-(--duration-micro) ease-(--ease-out) hover:bg-ink-6"
      >
        <ChevronRight className="size-3.5 shrink-0 text-ink-50 transition-transform duration-(--duration-panel) ease-(--ease-out) group-data-[state=open]:rotate-90" strokeWidth={2} aria-hidden />
        <span className="label-mono transition-colors duration-(--duration-micro) group-hover:text-ink-soft group-data-[state=open]:text-ink-soft">Advanced</span>
        <span className="min-w-0 flex-1 truncate text-xs leading-4.5 text-ink-50">{summary}</span>
        <span className="hidden shrink-0 text-xs leading-4.5 text-ink-50 sm:inline" aria-hidden>
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      <Reveal open={open} id={id} className="flex flex-col gap-7 pt-4 pb-5">
        <p className="max-w-xl px-1 text-xs leading-4.5 text-ink-50">For IT staff and anyone checking how AIOS works. Nothing here needs changing day to day.</p>
        {children}
      </Reveal>
    </div>
  )
}

/** A short list of plain statements inside a panel: a small mark, then one sentence each. */
export function StatementList({ items, mark, className }: { items: ReactNode[]; mark: ReactNode; className?: string }) {
  return (
    <ul className={cn('divide-y divide-line-soft', className)}>
      {items.map((item, i) => (
        <li key={i} className="flex min-h-11 items-start gap-3.5 px-5 py-3">
          <span className="mt-0.5 shrink-0 text-green [&>svg]:size-4" aria-hidden>
            {mark}
          </span>
          <span className="min-w-0 flex-1 text-sm leading-5 text-ink">{item}</span>
        </li>
      ))}
    </ul>
  )
}
