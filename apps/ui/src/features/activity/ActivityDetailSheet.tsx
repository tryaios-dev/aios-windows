import { useNavigate } from 'react-router'
import { Collapsible } from 'radix-ui'
import { ArrowUpRight, Building2, ChevronDown, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import type { InstalledModel } from '@/lib/types'
import { formatDateTime, relativeTime } from '@/lib/format'
import { ArtTile } from '@/components/ui/art'
import { Button, IconButton } from '@/components/ui/button'
import { Callout } from '@/components/ui/feedback'
import { KeyValue } from '@/components/ui/layout'
import { Sheet } from '@/components/ui/overlays'
import { eventArt, modelFact, sentence, type ActivityRow } from './activityMeta'
import { EventFields } from './verification/EventFields'
import type { ContextLookups } from './verification/eventMeta'

/**
 * One entry, read as a person would say it: the sentence, then when, where and which AI model.
 * The stored record (identity, commitments, chain, payload) sits behind "Verification details".
 * The parent keeps `row` set while the sheet animates closed, so the panel never empties mid-slide.
 */
export function ActivityDetailSheet({ row, open, onOpenChange, lookups, installed, expert }: { row: ActivityRow | null; open: boolean; onOpenChange: (open: boolean) => void; lookups: ContextLookups; installed: InstalledModel[]; /** Opened from the Verification details view: start with the stored record showing. */ expert: boolean }) {
  const navigate = useNavigate()
  const conversation = useStore((s) => s.conversations.find((c) => c.id === row?.event.conversation_id))

  if (!row) return null

  const { event, line } = row
  const title = sentence(line)
  const model = modelFact(event, installed)
  const isQuestion = event.event_type === 'request' && event.payload?.purpose !== 'summary'
  const aboutKnowledge = event.event_type === 'knowledge_added' || event.event_type === 'knowledge_removed'
  const sentToResource = event.event_type === 'disclosure'
  // For something sent to a linked resource: which resource it went through, when the record names it.
  const through = sentToResource && typeof event.payload?.resource === 'string' && event.payload.resource !== line.where ? event.payload.resource : null

  const facts = [
    {
      k: 'When',
      v: (
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span>{formatDateTime(event.ts)}</span>
          <span className="text-xs text-ink-50">{relativeTime(event.ts)}</span>
        </span>
      ),
    },
    {
      k: 'Where',
      v: line.left ? (
        <span className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{line.where}</span>
            <span className="inline-flex h-5 items-center gap-1 rounded-sm border border-brass/60 px-1.5 text-2xs font-medium leading-none whitespace-nowrap text-brass-text">
              {event.provider === 'company' ? <Building2 className="size-3" aria-hidden /> : <ArrowUpRight className="size-3" aria-hidden />}
              Left this computer
            </span>
          </span>
          {through && <span className="text-xs leading-4.5 text-ink-50">Through {through}, a resource you linked.</span>}
        </span>
      ) : (
        line.where
      ),
    },
    ...(model ? [{ k: 'AI model', v: model }] : []),
  ]

  return (
    <Sheet open={open} onOpenChange={onOpenChange} width="w-[480px]" bare title={title} description={line.about}>
      {/* Header: the sentence */}
      <div className="flex items-start gap-4 border-b border-line-soft px-6 pt-5 pb-5">
        <ArtTile src={eventArt(row)} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-6 text-ink">{title}</h2>
          {line.about && (
            <p className="mt-1 truncate text-sm text-ink-soft" title={line.about}>
              {line.about}
            </p>
          )}
        </div>
        <IconButton label="Close" size="sm" className="-mt-1 -mr-1.5" onClick={() => onOpenChange(false)}>
          <X />
        </IconButton>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {event.pending && (
          <Callout tone="caution" compact title="Not recorded yet" className="mb-5">
            Activity recording is paused. It will catch up by itself.
          </Callout>
        )}

        <KeyValue rows={facts} className="border-y border-line-soft" />

        {isQuestion && <p className="mt-5 text-sm leading-5 text-ink-soft">The question and the answer are not stored here. A fingerprint of each is, so either can be proved later.</p>}
        {event.event_type === 'refusal' && <p className="mt-5 text-sm leading-5 text-ink-soft">Nothing was sent to the AI. The message stayed in the message box, ready to be sent in two parts.</p>}
        {aboutKnowledge && <p className="mt-5 text-sm leading-5 text-ink-soft">The activity record notes that this happened. It never holds what is in a document.</p>}
        {sentToResource && <p className="mt-5 text-sm leading-5 text-ink-soft">AIOS asked first, and sent this only after you allowed it. What was sent is not stored in the activity record.</p>}

        <Collapsible.Root key={event.seq} defaultOpen={expert} className="mt-6">
          <Collapsible.Trigger asChild>
            <button type="button" className="group -ml-1.5 inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-sm font-medium text-ink-soft transition-colors duration-(--duration-micro) ease-(--ease-out) hover:bg-ink-6 hover:text-ink">
              <ChevronDown className="size-3.5 transition-transform duration-(--duration-panel) ease-(--ease-out) group-data-[state=open]:rotate-180" aria-hidden />
              Verification details
            </button>
          </Collapsible.Trigger>
          <Collapsible.Content className="animate-in pt-3">
            <EventFields event={event} lookups={lookups} />
          </Collapsible.Content>
        </Collapsible.Root>
      </div>

      {/* Footer */}
      {conversation && (
        <div className="flex items-center justify-end border-t border-line-soft px-6 py-4">
          <Button
            variant="secondary"
            size="sm"
            trailing={<ArrowUpRight className="size-3.5" aria-hidden />}
            onClick={() => {
              onOpenChange(false)
              navigate(`/projects/${conversation.project_id}/c/${conversation.id}`)
            }}
          >
            Open conversation
          </Button>
        </div>
      )}
    </Sheet>
  )
}
