import * as React from 'react'
import { motion } from 'motion/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { DownloadState } from '@/lib/types'
import { formatBytes, formatSpeed } from '@/lib/format'

/**
 * The pieces every "something is being installed" surface shares: a stage
 * track, a progress bar, and the figures beside it.
 *
 * Nothing here invents progress. Percentages, speed and time left are all
 * worked out from the bytes the backend reports having received
 * (`DownloadState.received_bytes`), sampled as they arrive. When there is
 * not yet enough to go on, the display says so instead of guessing.
 */

const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1]

/* ---------------- Figures ---------------- */

/** Time left the way a person would say it. The exact figure belongs under Details. */
export function timeLeftWords(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Working it out'
  if (seconds < 8) return 'A few seconds'
  if (seconds < 50) return 'Less than a minute'
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `About ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  const hours = Math.round(minutes / 60)
  return `About ${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

export interface TransferStats {
  /** 0 to 100, from bytes received over bytes expected. */
  pct: number
  received: number
  total: number
  /** Bytes per second over the last few seconds; null until there is enough to measure. */
  speedBps: number | null
  /** Seconds left at the measured rate; null until the rate has settled. */
  etaSeconds: number | null
}

/** How long a run of samples has to be before the rate is shown, and before time left is trusted. */
const SPEED_AFTER_MS = 700
const ETA_AFTER_MS = 2500
const WINDOW_MS = 6000

/**
 * Speed and time left, measured from the bytes that have actually arrived
 * over a sliding window, so the readout is steady and honest. Pausing, an
 * interruption or a restart clears the window.
 */
export function useTransferStats(download: DownloadState | undefined, fallbackTotal: number): TransferStats {
  const samples = React.useRef<Array<{ t: number; b: number }>>([])
  const [rate, setRate] = React.useState<{ bps: number | null; settled: boolean }>({ bps: null, settled: false })
  const received = download?.received_bytes ?? 0
  const total = download?.total_bytes ?? fallbackTotal
  const status = download?.status

  React.useEffect(() => {
    if (status !== 'downloading') {
      samples.current = []
      setRate({ bps: null, settled: false })
      return
    }
    const now = performance.now()
    const list = samples.current
    // A restart from zero is a new measurement.
    if (list.length && received < list[list.length - 1].b) list.length = 0
    list.push({ t: now, b: received })
    while (list.length > 2 && now - list[0].t > WINDOW_MS) list.shift()
    const span = now - list[0].t
    if (span >= SPEED_AFTER_MS) setRate({ bps: Math.max(0, ((received - list[0].b) / span) * 1000), settled: span >= ETA_AFTER_MS })
  }, [received, status])

  const pct = total > 0 ? Math.max(0, Math.min(100, (received / total) * 100)) : 0
  const speedBps = status === 'downloading' ? rate.bps : null
  const etaSeconds = speedBps && speedBps > 0 && rate.settled ? (total - received) / speedBps : null
  return { pct, received, total, speedBps, etaSeconds }
}

/* ---------------- Progress bar ---------------- */

export type ProgressTone = 'green' | 'brass' | 'deny'

const BAR: Record<ProgressTone, string> = { green: 'bg-green', brass: 'bg-brass', deny: 'bg-deny' }

/**
 * One continuous bar. While work is under way a soft light travels along the
 * filled part; when the amount is not known it shows a moving segment and
 * no number.
 */
export function ProgressBar({ value, tone = 'green', active, indeterminate, label, valueText, size = 'md', className }: { value?: number; tone?: ProgressTone; /** Work is under way right now. */ active?: boolean; indeterminate?: boolean; label: string; valueText?: string; size?: 'sm' | 'md'; className?: string }) {
  const pct = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      aria-valuenow={indeterminate ? undefined : Math.floor(pct)}
      aria-valuetext={valueText}
      className={cn('relative w-full overflow-hidden rounded-full bg-ink-6 shadow-[inset_0_0_0_1px_rgba(22,33,27,0.05)]', size === 'sm' ? 'h-1.5' : 'h-2.5', className)}
    >
      {indeterminate ? (
        <span className={cn('progress-indeterminate absolute inset-y-0 w-2/5 rounded-full', BAR[tone])} />
      ) : (
        <span className={cn('absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-500 ease-linear', BAR[tone], active && 'progress-sheen')} style={{ width: `${pct}%` }} />
      )}
    </div>
  )
}

/* ---------------- Stage track ---------------- */

export type StageState = 'todo' | 'current' | 'done' | 'failed' | 'paused'

export interface Stage {
  id: string
  label: string
  state: StageState
}

/** Where the installation has got to: a short row of named stages joined by a line that fills as each one finishes. */
export function StageTrack({ stages, className }: { stages: Stage[]; className?: string }) {
  return (
    <ol className={cn('flex items-center gap-3', className)} aria-label="Installation stages">
      {stages.map((s, i) => (
        <li key={s.id} className={cn('flex min-w-0 items-center gap-3', i < stages.length - 1 && 'flex-1')} aria-current={s.state === 'current' || s.state === 'paused' ? 'step' : undefined}>
          <span className="flex min-w-0 items-center gap-2.5">
            <StageNode state={s.state} index={i} />
            <span className={cn('truncate text-sm leading-5 transition-colors duration-(--duration-panel)', s.state === 'todo' ? 'text-ink-50' : s.state === 'failed' ? 'font-medium text-deny' : s.state === 'done' ? 'text-ink-soft' : 'font-medium text-ink')}>
              {s.label}
              <span className="sr-only">{s.state === 'done' ? ' (done)' : s.state === 'current' ? ' (in progress)' : s.state === 'paused' ? ' (paused)' : s.state === 'failed' ? ' (stopped)' : ''}</span>
            </span>
          </span>
          {i < stages.length - 1 && (
            <span aria-hidden className="relative h-px min-w-4 flex-1 bg-line">
              <span className="absolute inset-y-0 left-0 bg-green transition-[width] duration-700 ease-(--ease-out)" style={{ width: s.state === 'done' ? '100%' : '0%' }} />
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

function StageNode({ state, index }: { state: StageState; index: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-2xs tabular transition-[background-color,border-color,color] duration-(--duration-panel) ease-(--ease-out)',
        state === 'done' && 'border-green bg-green text-white',
        state === 'failed' && 'border-deny bg-deny text-white',
        state === 'current' && 'border-green bg-white text-green',
        state === 'paused' && 'border-brass bg-brass-soft text-brass-text',
        state === 'todo' && 'border-line bg-paper-raised text-ink-50',
      )}
    >
      {state === 'done' ? <DrawnTick className="size-3" /> : state === 'failed' ? <X className="size-3" strokeWidth={3} /> : index + 1}
      {state === 'current' && <span className="absolute -inset-[3px] animate-ping rounded-full border border-green/40 [animation-duration:1.8s]" />}
    </span>
  )
}

/** A tick whose stroke is drawn in. */
export function DrawnTick({ className, strokeWidth = 2.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 12 12" className={cn('shrink-0 overflow-visible', className)} aria-hidden>
      <motion.path d="M2.25 6.4 L4.9 9 L9.75 3.3" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ pathLength: { duration: 0.32, ease: EASE }, opacity: { duration: 0.08 } }} />
    </svg>
  )
}

/* ---------------- Compact meter (AI models list) ---------------- */

/**
 * The same honest readout in one line, for a card in a list: bar, percent,
 * amount, and speed and time left once they can be measured.
 */
export function DownloadMeter({ download, fallbackTotal, className }: { download: DownloadState | undefined; fallbackTotal: number; className?: string }) {
  const stats = useTransferStats(download, fallbackTotal)
  const status = download?.status ?? 'downloading'
  const checking = status === 'verifying'
  const paused = status === 'paused'
  const failed = status === 'failed'
  const tone: ProgressTone = failed ? 'deny' : paused ? 'brass' : 'green'
  const parts: string[] = []
  if (checking) parts.push('Checking the file is genuine and unmodified')
  else {
    parts.push(`${formatBytes(stats.received)} of ${formatBytes(stats.total)}`)
    if (paused) parts.push('paused, saved up to here')
    else if (failed) parts.push('stopped')
    else {
      if (stats.speedBps !== null) parts.push(formatSpeed(stats.speedBps))
      parts.push(stats.etaSeconds === null ? 'working out the time left' : `${timeLeftWords(stats.etaSeconds).toLowerCase()} left`)
    }
  }
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <ProgressBar size="sm" tone={tone} value={stats.pct} indeterminate={checking} active={status === 'downloading'} label="AI model download" valueText={checking ? 'Checking' : `${Math.floor(stats.pct)} percent`} />
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm leading-5 tabular text-ink-soft" aria-live="off">
        {!checking && <span className="font-mono text-xs font-medium text-ink">{Math.floor(stats.pct)}%</span>}
        <span>{parts.join(' · ')}</span>
      </p>
    </div>
  )
}
