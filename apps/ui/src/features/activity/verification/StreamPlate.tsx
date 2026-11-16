import type { ReactNode } from 'react'
import { useStore } from '@/lib/store'
import type { Checkpoint, EvidenceStream } from '@/lib/types'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'
import { shortHash } from '@/lib/hash'
import { StatusDot } from '@/components/ui/chips'
import { Card, Hash } from '@/components/ui/layout'

/**
 * The stream plate: one raised card that states the ledger's identity.
 * Top tier: stream id and epoch set large, a hairline, then the running figures.
 * Bottom tier: the custody statement in its engineering form.
 * Verification details only; the plain summary above the toolbar says the same in everyday words.
 */
export function StreamPlate({ stream, scopeCount, totalCount, latestCheckpoint }: { stream: EvidenceStream; /** Events in the current project view; omit on the whole-computer route. */ scopeCount?: number; totalCount: number; latestCheckpoint: Checkpoint | null }) {
  const writerDown = useStore((s) => s.health.writer === 'unavailable')
  const pending = useStore((s) => s.health.evidence_pending)

  return (
    <Card raised padded={false} className="overflow-hidden">
      {/* Tier one: identity and figures */}
      <div className="flex flex-col gap-6 px-6 pt-5 pb-5 md:flex-row md:items-stretch md:gap-0">
        {/* Identity */}
        <div className="flex min-w-0 items-start gap-8 md:pr-8">
          <Figure caption="Stream" sub={`device ${stream.device_id}`}>
            <Hash value={stream.stream_id} head={8} tail={6} className="text-xl leading-7 tracking-[0.01em] text-ink" />
          </Figure>
          <Figure caption="Epoch" sub={stream.prior_tip_hash ? `continued from ${shortHash(stream.prior_tip_hash, 6, 4)}` : `signer ${shortHash(stream.signer_key_id, 6, 4)}`}>
            <span className="font-mono text-3xl leading-7 tabular text-ink">{stream.epoch}</span>
          </Figure>
        </div>

        {/* Hairline between identity and figures */}
        <div className="hidden w-px shrink-0 self-stretch bg-line-soft md:block" aria-hidden />
        <div className="h-px w-full bg-line-soft md:hidden" aria-hidden />

        {/* Figures */}
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3 md:pl-8">
          {scopeCount === undefined ? (
            <Figure caption="Events" sub="stream total">
              <span className="font-mono text-xl leading-7 tabular text-ink">{totalCount}</span>
            </Figure>
          ) : (
            <Figure caption="Events" sub="this project / stream total">
              <span className="font-mono text-xl leading-7 tabular text-ink">{scopeCount}</span>
              <span className="font-mono text-base leading-7 text-ink-30">/</span>
              <span className="font-mono text-base leading-7 tabular text-ink-50">{totalCount}</span>
            </Figure>
          )}

          <Figure caption="Latest checkpoint" sub={latestCheckpoint ? `seq ${latestCheckpoint.seq_from}–${latestCheckpoint.seq_to} · ${relativeTime(latestCheckpoint.created_at)}` : 'Signed at each clean shutdown'}>
            {latestCheckpoint ? <span className="font-mono text-xl leading-7 tabular text-ink">{latestCheckpoint.id}</span> : <span className="font-mono text-xl leading-7 text-ink-50">none yet</span>}
          </Figure>

          <Figure
            caption="Writer"
            sub={writerDown ? (pending ? `${pending} event${pending === 1 ? '' : 's'} waiting in the outbox` : 'Events will queue in the outbox') : 'Every request is appended to the chain'}
          >
            <StatusDot tone={writerDown ? 'brass' : 'green'} pulse={writerDown} className="mt-2.5" />
            <span className="truncate text-base leading-7 font-medium text-ink">{writerDown ? 'Evidence writer unavailable' : 'Evidence recording'}</span>
          </Figure>
        </div>
      </div>

      {/* Tier two: custody statement */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-soft bg-paper-raised px-6 py-3">
        <span className="label-mono shrink-0">Custody</span>
        <span className="label-mono text-brass-text">Self-custodied Local · no anchor</span>
      </div>
    </Card>
  )
}

function Figure({ caption, sub, children, className }: { caption: string; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <div className="label-mono">{caption}</div>
      <div className="mt-2 flex min-h-7 min-w-0 items-baseline gap-1.5">{children}</div>
      {sub && <div className="mt-1 truncate font-mono text-2xs leading-4 text-ink-50">{sub}</div>}
    </div>
  )
}
