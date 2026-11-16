import { useMemo } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, Building2, ChevronRight, Lock } from 'lucide-react'
import { cn } from '@/lib/cn'
import { dayLabel, formatTime, pluralise } from '@/lib/format'
import { ArtTile } from '@/components/ui/art'
import { Badge } from '@/components/ui/chips'
import { dayAnchor, eventArt, sentenceParts, type ActivityRow } from './activityMeta'

interface DayGroup {
  key: string
  label: string
  date: string
  rows: ActivityRow[]
}

/*
 * Each row is its own grid with fixed tracks, so the columns line up down the list:
 * time · icon · sentence · where · arrow. The icons sit on a thin line that runs
 * through the day, so a day reads as one thread of things that happened.
 * The row button spans every track as a subgrid; a conversation link sits above it
 * under the sentence, so the link and the row stay separate controls.
 */
const TRACKS = 'grid grid-cols-[48px_36px_minmax(0,1fr)_auto_16px] gap-x-3.5'

/**
 * The plain view: what happened, as sentences, newest first and grouped by day.
 * `rows` arrive filtered and sorted. No sequence numbers, identifiers or fingerprints are shown here.
 * Rows do not animate in: the list is there when the page is, and nothing moves on arrival.
 */
export function ActivityList({ rows, highlightSeq, onSelect }: { rows: ActivityRow[]; highlightSeq: number | null; onSelect: (row: ActivityRow) => void }) {
  const groups = useMemo<DayGroup[]>(() => {
    const out: DayGroup[] = []
    for (const row of rows) {
      const key = dayAnchor(row.event.ts)
      const last = out[out.length - 1]
      if (last && last.key === key) last.rows.push(row)
      else out.push({ key, label: dayLabel(row.event.ts), date: new Date(row.event.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }), rows: [row] })
    }
    return out
  }, [rows])

  return (
    <div className="overflow-clip rounded-xl border border-line bg-white shadow-card">
      {groups.map((group, groupIndex) => {
        const named = group.label === 'Today' || group.label === 'Yesterday'
        return (
          <section key={group.key} aria-labelledby={`${group.key}-title`}>
            {/* The heading carries the id the chart scrolls to; the gap above keeps it clear of the page header. */}
            <h2 id={group.key} className={cn('sticky top-0 z-[2] flex h-10 scroll-mt-2 items-center gap-2.5 border-b border-line-soft bg-paper-raised px-5', groupIndex > 0 && 'border-t')}>
              <span id={`${group.key}-title`} className="text-sm font-semibold text-ink">
                {group.label}
              </span>
              {named && <span className="text-sm text-ink-50">{group.date}</span>}
              <span className="ml-auto font-mono text-2xs tabular text-ink-50">{pluralise(group.rows.length, 'action')}</span>
            </h2>
            <ul>
              {group.rows.map((row, i) => (
                <Row key={row.event.seq} row={row} first={i === 0} last={i === group.rows.length - 1} highlighted={highlightSeq === row.event.seq} onSelect={() => onSelect(row)} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function Row({ row, first, last, highlighted, onSelect }: { row: ActivityRow; first: boolean; last: boolean; highlighted: boolean; onSelect: () => void }) {
  const { event, line, conversation } = row
  const { who, rest } = sentenceParts(line)
  const about = line.about
  // The sentence often names the conversation already. Then the line underneath offers to open it instead of repeating it.
  const said = !!about && rest.includes(about)
  const below = conversation ? (said ? 'Open the conversation' : conversation.title) : about && !said ? about : null

  return (
    <li id={`act-${event.seq}`} className={cn(TRACKS, 'group relative px-5')}>
      <button
        type="button"
        onClick={onSelect}
        aria-haspopup="dialog"
        aria-current={highlighted ? 'true' : undefined}
        className={cn(
          'col-span-full row-start-1 -mx-5 grid grid-cols-subgrid items-start px-5 py-3 text-left transition-colors duration-(--duration-micro) ease-(--ease-out) focus-visible:-outline-offset-2',
          highlighted ? 'bg-green-wash shadow-[inset_3px_0_0_var(--color-green)]' : 'group-hover:bg-paper-raised',
        )}
      >
        <time dateTime={event.ts} className="pt-2.5 font-mono text-xs tabular text-ink-50">
          {formatTime(event.ts)}
        </time>

        {/* The icon, on the thread that runs through the day. */}
        <span className="relative flex justify-center self-stretch">
          {!first && <span aria-hidden className="absolute -top-3 left-1/2 h-3 w-px -translate-x-1/2 bg-line" />}
          {!last && <span aria-hidden className="absolute -bottom-3 left-1/2 top-9 w-px -translate-x-1/2 bg-line" />}
          <ArtTile src={eventArt(row)} className="relative transition-[border-color,box-shadow] duration-(--duration-micro) group-hover:border-line-strong" />
        </span>

        <span className="flex min-w-0 flex-col gap-0.5 pt-2">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 text-base leading-5 text-ink">
              <span className="font-semibold">{who}</span> {rest}
            </span>
            {event.pending && (
              <Badge tone="brass" className="shrink-0">
                Not recorded yet
              </Badge>
            )}
          </span>
          {/* When this is a conversation link the words are left out here and the link below fills the space. */}
          {below && <span className={cn('truncate text-sm leading-5 text-ink-50', conversation && 'invisible')}>{below}</span>}
        </span>

        <span className="flex justify-end pt-2">
          {line.left ? (
            <span className="inline-flex h-6 items-center gap-1 rounded-full border border-brass/60 bg-brass-soft px-2 text-xs font-medium leading-none whitespace-nowrap text-brass-text">
              {event.provider === 'company' ? <Building2 className="size-3 shrink-0" aria-hidden /> : <ArrowUpRight className="size-3 shrink-0" aria-hidden />}
              <span className="sr-only">Left this computer: </span>
              <span className="max-w-32 truncate" title={line.where}>
                {line.where}
              </span>
            </span>
          ) : (
            <span className="inline-flex h-6 items-center gap-1.5 text-xs whitespace-nowrap text-ink-50">
              <Lock className="size-3 shrink-0 text-green/70" strokeWidth={2.25} aria-hidden />
              <span className="hidden sm:inline">{line.where}</span>
              <span className="sr-only sm:hidden">{line.where}</span>
            </span>
          )}
        </span>

        <ChevronRight className="mt-3 size-4 text-ink-30 opacity-0 transition-[opacity,transform] duration-(--duration-micro) group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-within:opacity-100" aria-hidden />
      </button>
      {conversation && below && (
        <Link
          to={`/projects/${conversation.project_id}/c/${conversation.id}`}
          title={conversation.title}
          aria-label={`Open the conversation “${conversation.title}”`}
          className="z-[1] col-start-3 row-start-1 mb-3 inline-flex max-w-full min-w-0 items-center gap-1 self-end justify-self-start rounded-xs text-sm leading-5 text-ink-soft underline decoration-line-strong underline-offset-4 transition-colors duration-(--duration-micro) hover:text-green hover:decoration-green"
        >
          <span className="truncate">{below}</span>
          <ArrowUpRight className="size-3 shrink-0" aria-hidden />
        </Link>
      )}
    </li>
  )
}
