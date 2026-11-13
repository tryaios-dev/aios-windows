import { useMemo, type ReactNode } from 'react'
import { ArrowUpRight, Info, Lock } from 'lucide-react'
import { ART } from '@/assets/icons'
import { cn } from '@/lib/cn'
import { pluralise, relativeTime } from '@/lib/format'
import { ArtTile } from '@/components/ui/art'
import { StatusDot } from '@/components/ui/chips'
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui/overlays'
import { dayAnchor, type ActivityRow } from './activityMeta'

const DAYS = 14

/**
 * The top of Activity. One card that answers, before any reading: how much is
 * recorded, is recording running, did anything leave this computer, and when
 * was it busy. Words and counts only; the stream, epoch and checkpoint figures
 * live in Verification details.
 */
export function ActivitySummary({ rows, lastSealedAt, paused, onShowLeft, className }: { /** Every entry in view, before the kind filters. */ rows: ActivityRow[]; lastSealedAt: string | null; paused: boolean; /** Narrow the list to what left this computer. */ onShowLeft?: () => void; className?: string }) {
  const count = rows.length
  const left = useMemo(() => rows.reduce((n, r) => n + (r.line.left ? 1 : 0), 0), [rows])
  const asked = useMemo(() => rows.reduce((n, r) => n + (r.event.event_type === 'request' && r.event.payload?.purpose !== 'summary' ? 1 : 0), 0), [rows])
  const stayed = count - left

  return (
    <section aria-labelledby="activity-summary" className={cn('@container overflow-hidden rounded-xl border border-line bg-white shadow-card', className)}>
      <div className="flex flex-col @3xl:flex-row">
        <div className="flex min-w-0 flex-1 items-start gap-4 p-5 @3xl:p-6">
          <ArtTile src={ART.activity} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="label-mono">Your activity record</div>
            <h2 id="activity-summary" className="mt-1 text-2xl font-semibold leading-8 tracking-[-0.01em] tabular text-ink">
              {count === 0 ? 'Nothing recorded yet' : `${pluralise(count, 'action')} recorded`}
            </h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-5 text-ink-soft">
              {paused ? (
                <span className="inline-flex items-center gap-2 text-brass-text">
                  <StatusDot tone="brass" pulse />
                  Recording is paused. It will catch up by itself.
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 font-medium text-ink">
                  <StatusDot tone="green" pulse />
                  Recording
                </span>
              )}
              <span aria-hidden className="h-3 w-px bg-line" />
              <span>{lastSealedAt ? <>Last sealed {relativeTime(lastSealedAt)}</> : 'Not sealed yet'}</span>
            </p>
            <div className="mt-3">
              <WhatThisProves />
            </div>
          </div>
        </div>

        <DayChart rows={rows} className="border-t border-line-soft @3xl:w-[23rem] @3xl:shrink-0 @3xl:border-l @3xl:border-t-0" />
      </div>

      {/* The promise, counted. */}
      <dl className="grid grid-cols-1 border-t border-line-soft bg-paper-raised @xl:grid-cols-3">
        <Fact label="Stayed on this computer" icon={<Lock className="size-3.5 text-green" strokeWidth={2.25} aria-hidden />}>
          {count === 0 ? 'Everything' : left === 0 ? `All ${pluralise(count, 'action')}` : `${stayed} of ${pluralise(count, 'action')}`}
        </Fact>
        <Fact label="Left this computer" icon={left > 0 ? <ArrowUpRight className="size-3.5 text-brass-text" strokeWidth={2.25} aria-hidden /> : undefined} className="@xl:border-l">
          {left === 0 ? (
            'Nothing'
          ) : onShowLeft ? (
            <button type="button" onClick={onShowLeft} className="rounded-xs font-medium text-brass-text underline decoration-brass/50 underline-offset-4 transition-colors duration-(--duration-micro) hover:decoration-brass">
              {pluralise(left, 'action')}. Show {left === 1 ? 'it' : 'them'}
            </button>
          ) : (
            pluralise(left, 'action')
          )}
        </Fact>
        <Fact label="Questions asked" className="@xl:border-l">
          {asked === 0 ? 'None yet' : `${asked}. The words are not kept here`}
        </Fact>
      </dl>
      <p className="border-t border-line-soft bg-paper-raised px-5 py-2.5 text-xs leading-4.5 text-ink-50 @3xl:px-6">Kept only on this computer. Not independently certified.</p>
    </section>
  )
}

function Fact({ label, icon, className, children }: { label: string; icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cn('border-line-soft px-5 py-3.5 not-first:border-t @xl:not-first:border-t-0 @3xl:px-6', className)}>
      <dt className="label-mono">{label}</dt>
      <dd className="mt-1 flex items-center gap-1.5 text-sm font-medium leading-5 tabular text-ink">
        {icon}
        <span className="min-w-0">{children}</span>
      </dd>
    </div>
  )
}

/* ---------------- The last 14 days ---------------- */

interface Day {
  date: Date
  key: string
  count: number
  today: boolean
}

function lastDays(rows: ActivityRow[], now = new Date()): Day[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const key = dayAnchor(r.event.ts)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const days: Day[] = []
  for (let i = DAYS - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = dayAnchor(date)
    days.push({ date, key, count: counts.get(key) ?? 0, today: i === 0 })
  }
  return days
}

const dayWords = (d: Day) => (d.today ? 'Today' : d.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))
const shortDate = (date: Date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/**
 * How busy each of the last 14 days was. One series, one colour. Each bar says
 * its day and count on hover or focus, and takes you to that day in the list.
 * The list below is the same information in full.
 */
function DayChart({ rows, className }: { rows: ActivityRow[]; className?: string }) {
  const days = useMemo(() => lastDays(rows), [rows])
  const max = Math.max(1, ...days.map((d) => d.count))
  const total = days.reduce((n, d) => n + d.count, 0)

  const goTo = (key: string) => {
    const el = document.getElementById(key)
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <div className={cn('flex flex-col px-5 pb-4 pt-5 @3xl:px-6', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="label-mono">Last {DAYS} days</h3>
        <span className="text-xs tabular text-ink-50">{pluralise(total, 'action')}</span>
      </div>
      <ul aria-label={`Actions per day over the last ${DAYS} days`} className="mt-3 flex h-16 flex-1 items-stretch gap-0.5">
        {days.map((d) => {
          const label = `${dayWords(d)}: ${d.count === 0 ? 'nothing recorded' : pluralise(d.count, 'action')}`
          return (
            <li key={d.key} className="flex min-w-0 flex-1">
              <Tooltip content={label}>
                <button
                  type="button"
                  aria-label={d.count > 0 ? `${label}. Go to that day` : label}
                  disabled={d.count === 0}
                  onClick={() => goTo(d.key)}
                  className="group/bar flex h-full w-full items-end justify-center rounded-sm px-px outline-offset-1 transition-colors duration-(--duration-micro) enabled:hover:bg-green-wash disabled:cursor-default"
                >
                  {d.count > 0 ? (
                    <span
                      className="w-full max-w-3.5 rounded-t-[4px] bg-green/75 transition-colors duration-(--duration-micro) group-hover/bar:bg-green group-focus-visible/bar:bg-green"
                      style={{ height: `${Math.max(8, (d.count / max) * 100)}%` }}
                    />
                  ) : (
                    <span className="h-0.5 w-full max-w-3.5 rounded-full bg-line" />
                  )}
                </button>
              </Tooltip>
            </li>
          )
        })}
      </ul>
      <div className="mt-1.5 flex justify-between border-t border-line-soft pt-1.5 font-mono text-2xs text-ink-50" aria-hidden>
        <span>{shortDate(days[0].date)}</span>
        <span>Today</span>
      </div>
    </div>
  )
}

/* ---------------- What this proves ---------------- */

function WhatThisProves() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="-ml-2 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2 text-sm font-medium text-green transition-colors duration-(--duration-micro) ease-(--ease-out) hover:bg-green-wash">
          <Info className="size-3.5" aria-hidden />
          What this proves
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] p-4">
        <h3 className="text-sm font-semibold text-ink">What this proves</h3>
        <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-sm leading-5 text-ink-soft marker:text-ink-30">
          <li>Every entry is in the order it happened, and none has been changed or removed since.</li>
          <li>If AIOS is restored from a backup, the record shows where it carried on. Nothing is hidden.</li>
        </ul>
        <h3 className="mt-4 text-sm font-semibold text-ink">What it does not prove</h3>
        <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-sm leading-5 text-ink-soft marker:text-ink-30">
          <li>Who was sitting at the computer.</li>
          <li>Anything that happened outside this computer. The record is kept only here and is not independently certified in this version.</li>
        </ul>
        <p className="mt-4 border-t border-line-soft pt-3 text-xs leading-4.5 text-ink-50">
          Your conversations are never stored here. For each question and answer the record keeps a fingerprint, so either can be proved later without keeping the words.
        </p>
      </PopoverContent>
    </Popover>
  )
}
