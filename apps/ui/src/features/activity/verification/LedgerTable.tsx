import { useMemo } from 'react'
import { motion } from 'motion/react'
import { KeyRound } from 'lucide-react'
import type { Checkpoint, EvidenceEvent } from '@/lib/types'
import { cn } from '@/lib/cn'
import { dayLabel, formatTime, relativeTime } from '@/lib/format'
import { shortHash } from '@/lib/hash'
import { ProviderBadge, StatusDot } from '@/components/ui/chips'
import { EVENT_META, eventContext, formatSeq, type ContextLookups } from './eventMeta'

type Item = { kind: 'day'; key: string; label: string } | { kind: 'checkpoint'; key: string; checkpoint: Checkpoint } | { kind: 'event'; key: string; event: EvidenceEvent }

/** Column count the day and checkpoint rows span. Provider and commitments hide below lg / xl. */
const COLUMNS = 7

const CELL = 'px-3 align-middle'
/* A 1px green ring drawn with inset shadows: table rows have no box of their own to outline. */
const RING = {
  mid: 'shadow-[inset_0_1px_0_var(--color-green),inset_0_-1px_0_var(--color-green)]',
  left: 'shadow-[inset_1px_0_0_var(--color-green),inset_0_1px_0_var(--color-green),inset_0_-1px_0_var(--color-green)]',
  right: 'shadow-[inset_-1px_0_0_var(--color-green),inset_0_1px_0_var(--color-green),inset_0_-1px_0_var(--color-green)]',
}
const HEAD = cn(CELL, 'label-mono h-9 whitespace-nowrap text-left font-normal')

/**
 * The ledger itself: one row per event, newest first, day rails between days
 * and checkpoint markers interleaved at their seq_to position.
 * `events` arrive already filtered and sorted newest first; the parent shows the empty state.
 * The page scrolls, not the table: the card clips without becoming a scroll container so the header row still sticks.
 */
export function LedgerTable({ events, checkpoints, lookups, highlightSeq, onSelect }: { events: EvidenceEvent[]; checkpoints: Checkpoint[]; lookups: ContextLookups; highlightSeq: number | null; onSelect: (event: EvidenceEvent) => void }) {
  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    const cps = [...checkpoints].sort((a, b) => b.seq_to - a.seq_to)
    let cpIdx = 0
    let lastDay = ''
    const pushDay = (iso: string) => {
      const label = dayLabel(iso)
      if (label !== lastDay) {
        out.push({ kind: 'day', key: `day-${label}`, label })
        lastDay = label
      }
    }
    for (const e of events) {
      while (cpIdx < cps.length && cps[cpIdx].seq_to >= e.seq) {
        const cp = cps[cpIdx]
        pushDay(cp.created_at)
        out.push({ kind: 'checkpoint', key: cp.id, checkpoint: cp })
        cpIdx++
      }
      pushDay(e.ts)
      out.push({ kind: 'event', key: `ev-${e.seq}`, event: e })
    }
    return out
  }, [events, checkpoints])

  let eventIndex = 0

  return (
    <div className="overflow-clip rounded-lg border border-line bg-white shadow-card">
      <div>
        <table className="w-full border-separate border-spacing-0 text-left">
          <caption className="sr-only">Evidence events, newest first</caption>
          <colgroup>
            <col className="w-[72px]" />
            <col className="w-[56px]" />
            <col className="w-[200px]" />
            <col />
            <col className="hidden w-[108px] lg:table-column" />
            <col className="hidden w-[168px] xl:table-column" />
            <col className="w-[96px]" />
          </colgroup>
          {/* Sticky header: `position: sticky` on the cells keeps the thead in document order for assistive tech. */}
          <thead>
            <tr>
              <th scope="col" className={cn(HEAD, 'sticky top-0 z-[2] border-b border-line bg-white')}>Seq</th>
              <th scope="col" className={cn(HEAD, 'sticky top-0 z-[2] border-b border-line bg-white')}>Time</th>
              <th scope="col" className={cn(HEAD, 'sticky top-0 z-[2] border-b border-line bg-white')}>Type</th>
              <th scope="col" className={cn(HEAD, 'sticky top-0 z-[2] border-b border-line bg-white')}>Context</th>
              <th scope="col" className={cn(HEAD, 'sticky top-0 z-[2] hidden border-b border-line bg-white lg:table-cell')}>Provider</th>
              <th scope="col" className={cn(HEAD, 'sticky top-0 z-[2] hidden border-b border-line bg-white xl:table-cell')}>Commitments</th>
              <th scope="col" className={cn(HEAD, 'sticky top-0 z-[2] border-b border-line bg-white')}>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              if (item.kind === 'day') return <DayRail key={item.key} label={item.label} />
              if (item.kind === 'checkpoint') return <CheckpointRow key={item.key} checkpoint={item.checkpoint} />
              // Rows that mount together stagger 20 ms apart, capped so a long list never waits (brief 6).
              const delay = Math.min(eventIndex, 12) * 0.02
              eventIndex += 1
              return <EventRow key={item.key} event={item.event} lookups={lookups} highlighted={highlightSeq === item.event.seq} delay={delay} onSelect={() => onSelect(item.event)} />
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DayRail({ label }: { label: string }) {
  return (
    <tr>
      <th scope="colgroup" colSpan={COLUMNS} className="h-8 bg-white px-3 pt-2 text-left font-normal">
        <span className="flex items-center gap-3">
          <span className="label-mono whitespace-nowrap">{label}</span>
          <span className="h-px flex-1 bg-line-soft" aria-hidden />
        </span>
      </th>
    </tr>
  )
}

function CheckpointRow({ checkpoint }: { checkpoint: Checkpoint }) {
  return (
    <tr>
      <td colSpan={COLUMNS} className="h-9 border-y border-line-soft bg-green-wash px-3 align-middle">
        <span className="flex items-center gap-2.5 font-mono text-xs text-ink-soft">
          <KeyRound className="size-3.5 shrink-0 text-green" aria-hidden />
          <span className="truncate">
            Checkpoint <span className="text-ink">{checkpoint.id}</span> · signed seq {checkpoint.seq_from}–{checkpoint.seq_to}
          </span>
          <span className="hidden text-ink-50 sm:inline">· signer {shortHash(checkpoint.signer_key_id, 6, 4)}</span>
          <span className="ml-auto shrink-0 text-2xs text-ink-50">{relativeTime(checkpoint.created_at)}</span>
        </span>
      </td>
    </tr>
  )
}

function EventRow({ event, lookups, highlighted, delay, onSelect }: { event: EvidenceEvent; lookups: ContextLookups; highlighted: boolean; delay: number; onSelect: () => void }) {
  const meta = EVENT_META[event.event_type]
  const Icon = meta.icon
  const context = eventContext(event, lookups)
  const pending = !!event.pending

  // The whole row is clickable for pointer users; the button in the first cell is the keyboard and screen-reader action.
  const cell = cn(CELL, 'h-12 border-b border-line-soft transition-colors duration-(--duration-micro) ease-(--ease-out)', highlighted ? 'bg-green-wash' : 'bg-white group-hover:bg-paper-deep')

  return (
    <motion.tr
      id={`ev-${event.seq}`}
      aria-current={highlighted ? 'true' : undefined}
      onClick={onSelect}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay, ease: [0.2, 0.7, 0.2, 1] }}
      className="group cursor-pointer"
    >
      <td className={cn(cell, highlighted && RING.left)}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onSelect()
          }}
          aria-label={`${meta.label} ${formatSeq(event.seq)}${context ? `, ${context}` : ''}. Open details`}
          className="-mx-1 rounded-xs px-1 font-mono text-xs tabular text-ink-50 hover:text-ink"
        >
          {formatSeq(event.seq)}
        </button>
      </td>
      <td className={cn(cell, highlighted && RING.mid)}>
        <span className="font-mono text-xs tabular text-ink-50">{formatTime(event.ts)}</span>
      </td>
      <td className={cn(cell, 'min-w-0', highlighted && RING.mid)}>
        <span className="flex min-w-0 items-center gap-2.5 text-sm text-ink">
          <Icon className="size-4 shrink-0 text-ink-soft" strokeWidth={1.75} aria-hidden />
          <span className="truncate">{meta.label}</span>
        </span>
      </td>
      <td className={cn(cell, 'max-w-0', highlighted && RING.mid)}>
        <span className="block truncate text-sm text-ink-soft" title={context || undefined}>
          {context || <Dash />}
        </span>
      </td>
      <td className={cn(cell, 'hidden lg:table-cell', highlighted && RING.mid)}>
        {event.provider ? <ProviderBadge provider={event.provider} /> : <Dash />}
      </td>
      <td className={cn(cell, 'hidden xl:table-cell', highlighted && RING.mid)}>
        {event.input_commitment || event.output_commitment ? (
          <span className="flex flex-col gap-0.5">
            <Commitment label="in" value={event.input_commitment} />
            <Commitment label="out" value={event.output_commitment} />
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className={cn(cell, highlighted && RING.right)}>
        {pending ? (
          <span className="flex items-center gap-2 text-xs font-medium text-brass-text">
            <StatusDot tone="brass" pulse />
            Pending
          </span>
        ) : (
          <span className="sr-only">Appended</span>
        )}
      </td>
    </motion.tr>
  )
}

function Commitment({ label, value }: { label: string; value?: string }) {
  return (
    <span className="flex items-center gap-2 leading-none">
      <span className="label-mono w-6">{label}</span>
      {value ? <span className="font-mono text-2xs leading-4 tracking-[0.02em] text-ink-50">{shortHash(value, 6, 4)}</span> : <Dash />}
    </span>
  )
}

function Dash() {
  return <span className="font-mono text-xs text-ink-30">—</span>
}
