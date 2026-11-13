import { useState, type ReactNode } from 'react'
import { FileDown } from 'lucide-react'
import type { Checkpoint, EvidenceEvent, EvidenceStream } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/fields'
import type { ContextLookups } from './eventMeta'
import { LedgerTable } from './LedgerTable'
import { StreamPlate } from './StreamPlate'

interface VerificationViewProps {
  /** Filtered by the shared toolbar, newest first. */
  events: EvidenceEvent[]
  /** Events in view before the toolbar filters. */
  scopeCount: number
  /** Events in the whole stream. */
  totalCount: number
  /** True on a project route, where the plate shows "this project / stream total". */
  inProject: boolean
  filtered: boolean
  checkpoints: Checkpoint[]
  latestCheckpoint: Checkpoint | null
  stream: EvidenceStream
  lookups: ContextLookups
  highlightSeq: number | null
  onSelect: (event: EvidenceEvent) => void
  /** Returns true when the sequence number was found, so the box can clear. */
  onGoTo: (raw: string) => boolean
  onGoToInput: () => void
  onSave: () => void
  /** Shown in place of the ledger when the filters leave nothing. */
  empty: ReactNode
}

/**
 * The expert depth of Activity: the record as stored. Stream plate, ledger table with checkpoint rows,
 * "Go to #seq" and the verifiable copy. Engineering vocabulary is deliberate here.
 */
export function VerificationView({ events, scopeCount, totalCount, inProject, filtered, checkpoints, latestCheckpoint, stream, lookups, highlightSeq, onSelect, onGoTo, onGoToInput, onSave, empty }: VerificationViewProps) {
  const [gotoText, setGotoText] = useState('')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm leading-5 text-ink-soft">The same record, as stored. For auditors and anyone who wants to check it.</p>
        <div className="flex shrink-0 items-center gap-2">
          <form
            className="flex items-center"
            onSubmit={(e) => {
              e.preventDefault()
              if (onGoTo(gotoText)) setGotoText('')
            }}
          >
            <label htmlFor="activity-goto" className="sr-only">
              Go to sequence number
            </label>
            <Input
              id="activity-goto"
              mono
              inputMode="numeric"
              autoComplete="off"
              value={gotoText}
              onChange={(e) => {
                setGotoText(e.target.value)
                onGoToInput()
              }}
              placeholder="Go to #seq"
              className="h-8 w-32 text-xs"
            />
          </form>
          <Button variant="secondary" size="sm" className="h-8" leading={<FileDown className="size-3.5" aria-hidden />} onClick={onSave}>
            Save a verifiable copy
          </Button>
        </div>
      </div>

      <StreamPlate stream={stream} scopeCount={inProject ? scopeCount : undefined} totalCount={totalCount} latestCheckpoint={latestCheckpoint} />

      <div className="label-mono tabular pt-1">
        {filtered ? `${events.length} of ${scopeCount}` : scopeCount} {scopeCount === 1 && !filtered ? 'event' : 'events'} · newest first
      </div>

      {events.length > 0 ? <LedgerTable events={events} checkpoints={checkpoints} lookups={lookups} highlightSeq={highlightSeq} onSelect={onSelect} /> : empty}
    </div>
  )
}
