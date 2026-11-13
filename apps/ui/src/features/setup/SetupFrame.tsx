import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, ChevronDown, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Wordmark } from '@/components/ui/brand'
import { Button } from '@/components/ui/button'

/**
 * Full-screen stage shared by the first-run wizard, the Restore screen and
 * the start-up screen shown when AIOS cannot open its data.
 * Warm paper with a faint grain; the wordmark alone at the top of the left
 * side with the steps under it; and a content column (max 640px) that steps
 * fill with <StepBody> and <StepFooter>. There is no header bar.
 */

export type RailState = 'done' | 'current' | 'todo' | 'skipped'

export interface RailStep {
  id: string
  label: string
  state: RailState
}

/** Height of one rail row in px; the progress line is measured against it. */
const RAIL_ROW = 44
const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1]

/** What the content column needs to know about the frame around it. */
interface Chrome {
  /** The frame draws the left side (logo, and steps or a label) on wide windows. */
  side: boolean
  progress: { current: number; total: number; label?: string } | null
  eyebrow?: React.ReactNode
}

const ChromeContext = React.createContext<Chrome>({ side: false, progress: null })

/**
 * The stage has no header bar. The logo sits at the top of the left side,
 * above the steps, and the content column scrolls the full height of the
 * window, so nothing slides under a band at the top. On narrow windows,
 * where there is no room for a left side, the logo and the step count sit
 * at the top of the content and scroll with it.
 */
export function SetupFrame({ steps, current = 0, eyebrow, rail = true, children }: { steps?: RailStep[]; current?: number; eyebrow?: React.ReactNode; /** The opening screen takes the whole stage and places the logo itself. */ rail?: boolean; children: React.ReactNode }) {
  const total = steps?.length ?? 0
  const chrome: Chrome = { side: rail, progress: steps && rail ? { current, total, label: steps[current]?.label } : null, eyebrow }

  return (
    <ChromeContext.Provider value={chrome}>
      <div className="grain flex h-full w-full bg-paper text-ink">
        {rail && (
          <aside className="hidden w-[264px] shrink-0 flex-col pl-8 pr-6 pt-7 lg:flex">
            {/* Kept in its own box so the column does not stretch the logo. */}
            <div className="flex h-[15px] items-center">
              <Wordmark height={15} />
            </div>
            {steps ? (
              <nav aria-label="Setup steps" className="mt-12">
                <div className="label-mono tabular mb-6">Step {current + 1} of {total}</div>
                <div className="relative">
                  <span aria-hidden className="absolute left-0 top-0 h-full w-px bg-line" />
                  <motion.span aria-hidden className="absolute left-0 top-0 w-px bg-green" initial={false} animate={{ height: current * RAIL_ROW + RAIL_ROW / 2 }} transition={{ duration: 0.28, ease: EASE }} />
                  <motion.span aria-hidden className="absolute -left-[2px] size-[5px] rounded-full bg-green" initial={false} animate={{ top: current * RAIL_ROW + RAIL_ROW / 2 - 2.5 }} transition={{ duration: 0.28, ease: EASE }} />
                  <ol className="flex flex-col">
                    {steps.map((s, i) => (
                      <RailRow key={s.id} step={s} index={i} />
                    ))}
                  </ol>
                </div>
              </nav>
            ) : (
              eyebrow && <div className="label-mono mt-4">{eyebrow}</div>
            )}
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </ChromeContext.Provider>
  )
}

/** The logo and where you are, at the top of the content on windows too narrow for the left side. It scrolls with the page. */
function InlineBrand() {
  const { side, progress, eyebrow } = React.useContext(ChromeContext)
  if (!side) return null
  const pct = progress ? ((progress.current + 1) / progress.total) * 100 : 0
  return (
    <div className="mb-8 lg:hidden">
      <div className="flex items-center justify-between gap-4">
        <Wordmark height={15} />
        {progress ? (
          <div className="label-mono tabular" aria-live="polite">
            Step {progress.current + 1} of {progress.total}
            {progress.label && <span className="hidden sm:inline"> · {progress.label}</span>}
          </div>
        ) : (
          eyebrow && <div className="label-mono">{eyebrow}</div>
        )}
      </div>
      {progress && (
        <div aria-hidden className="mt-4 h-px bg-line-soft">
          <div className="h-px bg-green transition-[width] duration-300 ease-(--ease-out)" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

function RailRow({ step, index }: { step: RailStep; index: number }) {
  const { state } = step
  return (
    <li aria-current={state === 'current' ? 'step' : undefined} className="flex items-center gap-3 pl-6" style={{ height: RAIL_ROW }}>
      <span className={cn('flex w-5 shrink-0 items-center font-mono text-2xs tabular', state === 'current' ? 'font-medium text-green' : state === 'done' ? 'text-green' : 'text-ink-50')}>
        {state === 'done' ? <DrawnCheck className="size-3.5" label="Done" /> : String(index + 1).padStart(2, '0')}
      </span>
      <span className={cn('truncate text-sm transition-colors duration-(--duration-micro)', state === 'current' ? 'font-medium text-ink' : state === 'done' ? 'text-ink-soft' : 'text-ink-50')}>{step.label}</span>
      {state === 'skipped' && <span className="font-mono text-2xs text-ink-50">skipped</span>}
    </li>
  )
}

/* ---------------- Marks ---------------- */

/** A check mark whose stroke is drawn in over ~280ms. Collapses to a fade under reduced motion. */
export function DrawnCheck({ className, label, strokeWidth = 2.5 }: { className?: string; label?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 12 12" className={cn('shrink-0 overflow-visible', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <motion.path d="M2.25 6.4 L4.9 9 L9.75 3.3" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ pathLength: { duration: 0.28, ease: EASE }, opacity: { duration: 0.08 } }} />
    </svg>
  )
}

/* ---------------- Content column pieces ---------------- */

export function StepBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="scroll-stable min-h-0 flex-1 overflow-y-auto">
      <div className={cn('mx-auto w-full max-w-[640px] px-6 pb-12 pt-6 sm:px-8 lg:pt-12', className)}>
        <InlineBrand />
        {children}
      </div>
    </div>
  )
}

export function StepHeading({ eyebrow, note, title, lede, rule, className }: { eyebrow?: React.ReactNode; /** A quiet sentence above the title, for example when setup was resumed. */ note?: React.ReactNode; title: React.ReactNode; lede?: React.ReactNode; rule?: boolean; className?: string }) {
  return (
    <header className={cn('mb-8', className)}>
      {eyebrow && <div className="label-mono mb-4">{eyebrow}</div>}
      {note && (
        <p className="mb-4 flex items-center gap-2 text-sm leading-5 text-ink-50" role="status">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-green" />
          {note}
        </p>
      )}
      <h1 className="font-display text-[36px] leading-[1.1] text-ink lg:text-[40px]">{title}</h1>
      {rule && <span aria-hidden className="mt-6 block h-0.5 w-10 bg-green" />}
      {lede && <p className="mt-4 max-w-[56ch] text-md leading-6 text-ink-soft">{lede}</p>}
    </header>
  )
}

/** A raised white card with a hairline border; the content block of every step. */
export function Plate({ children, className, tone = 'white', as: Tag = 'div', ...rest }: { children: React.ReactNode; className?: string; tone?: 'white' | 'paper' | 'success'; as?: 'div' | 'section'; 'aria-label'?: string; 'aria-labelledby'?: string }) {
  return (
    <Tag
      {...rest}
      className={cn(
        'rounded-lg border p-5 sm:p-6',
        tone === 'white' && 'border-line bg-white shadow-card',
        tone === 'paper' && 'border-line bg-paper-raised',
        tone === 'success' && 'border-green/25 bg-green-wash',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

export interface FooterPrimary {
  label: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  /** Hide the trailing arrow (for final actions such as "Open AIOS"). */
  arrow?: boolean
}

export function StepFooter({ onBack, backLabel = 'Back', note, secondary, primary }: { onBack?: () => void; backLabel?: string; note?: React.ReactNode; secondary?: React.ReactNode; primary?: FooterPrimary }) {
  return (
    <div className="shrink-0 border-t border-line-soft bg-paper/90 backdrop-blur-[2px]">
      <div className="mx-auto flex w-full max-w-[640px] items-center justify-between gap-3 px-6 py-4 sm:px-8">
        <div className="min-w-0">
          {onBack ? (
            <Button variant="ghost" leading={<ArrowLeft className="size-3.5" />} onClick={onBack} className="-ml-2.5">
              {backLabel}
            </Button>
          ) : (
            note && <span className="block text-xs leading-4.5 text-ink-50">{note}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {secondary}
          {primary && (
            <Button
              variant="primary"
              size="lg"
              onClick={primary.onClick}
              disabled={primary.disabled}
              loading={primary.loading}
              trailing={primary.arrow === false || primary.loading ? undefined : <ArrowRight className="size-3.5" />}
            >
              {primary.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------- Timed sequences (driven by useSequence) ---------------- */

export type RowState = 'done' | 'current' | 'todo' | 'failed'

export interface SequenceItem {
  label: React.ReactNode
  /** Shown in the mono register once the row is done. */
  detail?: React.ReactNode
  /** Set the row's state directly instead of deriving it from `done` and `failedAt`. */
  state?: RowState
}

/**
 * A ledger of timed rows: hairline-divided, a stroke-drawn check as each
 * one completes, the detail set in mono on the right. Rows reveal with a
 * 40ms stagger on first render.
 */
export function Sequence({ items, done = 0, failedAt, className, label }: { items: SequenceItem[]; done?: number; failedAt?: number | null; className?: string; label?: string }) {
  return (
    <ol className={cn('flex flex-col divide-y divide-line-soft', className)} role="status" aria-live="polite" aria-label={label}>
      {items.map((it, i) => {
        const state: RowState = it.state ?? (failedAt === i ? 'failed' : i < done ? 'done' : i === done && failedAt == null ? 'current' : 'todo')
        return (
          <motion.li key={i} className="flex items-start gap-3 py-3" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE, delay: i * 0.04 }}>
            <span
              className={cn(
                'mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors duration-(--duration-micro)',
                state === 'done' && 'border-green bg-green text-white',
                state === 'failed' && 'border-deny bg-deny text-white',
                state === 'current' && 'border-green/40 bg-white',
                state === 'todo' && 'border-line bg-paper-raised',
              )}
              aria-hidden
            >
              {state === 'done' && <DrawnCheck className="size-2.5" strokeWidth={2.75} />}
              {state === 'failed' && <X className="size-2.5 animate-in" strokeWidth={3} />}
              {state === 'current' && <Loader2 className="size-2.5 animate-spin text-green" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
              <span className={cn('text-sm leading-5 transition-colors duration-(--duration-micro)', state === 'todo' ? 'text-ink-50' : state === 'failed' ? 'font-medium text-deny' : state === 'current' ? 'font-medium text-ink' : 'text-ink')}>
                {it.label}
                <span className="sr-only">{state === 'done' ? ' (done)' : state === 'current' ? ' (in progress)' : state === 'failed' ? ' (failed)' : ''}</span>
              </span>
              <AnimatePresence initial={false}>
                {it.detail && state === 'done' && (
                  <motion.span key="detail" className="min-w-0 font-mono text-xs leading-4.5 tabular text-ink-50 sm:max-w-[52%] sm:shrink-0 sm:text-right break-all" initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: EASE }}>
                    {it.detail}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </motion.li>
        )
      })}
    </ol>
  )
}

/* ---------------- Disclosure ---------------- */

/**
 * A quiet, collapsed-by-default row that opens a panel beneath it. Used for
 * the second depth of every setup screen: "Why?", "Details", the limits.
 */
export function Disclosure({ label, hint, children, defaultOpen = false, className }: { label: React.ReactNode; /** Shown on the right while closed, in the quiet register. */ hint?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = React.useState(defaultOpen)
  const id = React.useId()
  return (
    <div className={cn('rounded-lg border border-line-soft transition-colors duration-(--duration-micro)', open && 'border-line bg-paper-raised', className)}>
      <button
        type="button"
        className={cn('flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left text-sm leading-5 transition-colors duration-(--duration-micro) hover:text-ink', open ? 'font-medium text-ink' : 'text-ink-soft hover:bg-paper-raised')}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0">{label}</span>
        <span className="flex shrink-0 items-center gap-3">
          {hint && !open && <span className="hidden text-xs text-ink-50 sm:inline">{hint}</span>}
          <ChevronDown className={cn('size-4 text-ink-50 transition-transform duration-(--duration-panel) ease-(--ease-out)', open && 'rotate-180')} aria-hidden />
        </span>
      </button>
      {open && (
        <div id={id} className="animate-rise border-t border-line-soft px-4 pb-4 pt-4">
          {children}
        </div>
      )}
    </div>
  )
}

/** The small bordered square that carries a line icon beside a name. */
export function IconTile({ children, tone = 'neutral', className }: { children: React.ReactNode; tone?: 'neutral' | 'green' | 'brass'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md border [&>svg]:size-4',
        tone === 'neutral' && 'border-line-soft bg-paper-raised text-ink-soft',
        tone === 'green' && 'border-green/20 bg-green-wash text-green',
        tone === 'brass' && 'border-brass/30 bg-brass-soft text-brass-text',
        className,
      )}
    >
      {children}
    </span>
  )
}
