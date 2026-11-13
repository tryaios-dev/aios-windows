import type { ReactNode } from 'react'
import { useStore } from '@/lib/store'
import type { EvidenceEvent } from '@/lib/types'
import { formatTimestamp, relativeTime } from '@/lib/format'
import { shortHash } from '@/lib/hash'
import { ProviderBadge } from '@/components/ui/chips'
import { Hash, KeyValue, Mono, SectionLabel } from '@/components/ui/layout'
import { ACTOR_LABEL, EVENT_META, formatSeq, payloadRows, type ContextLookups } from './eventMeta'

/**
 * Every field of one Evidence Wire Format v1 record, plus its content-free payload,
 * laid out as a ledger page: identity, commitments, chain, payload.
 * Shown inside the "Verification details" disclosure of the detail panel.
 */
export function EventFields({ event, lookups }: { event: EvidenceEvent; lookups: ContextLookups }) {
  const conversation = useStore((s) => s.conversations.find((c) => c.id === event.conversation_id))
  const project = useStore((s) => s.projects.find((p) => p.id === event.project_id))
  const rows = payloadRows(event)
  const model = lookups.modelName(event.model_digest, typeof event.payload?.entry_id === 'string' ? event.payload.entry_id : undefined)

  return (
    <div>
      <div className="mb-5 flex items-baseline justify-between gap-3 rounded-md border border-line bg-paper-raised px-3 py-2">
        <span className="label-mono">Evidence Wire Format v1</span>
        <span className="flex items-baseline gap-2">
          <span className="text-sm text-ink">{EVENT_META[event.event_type].label}</span>
          <span className="font-mono text-sm tabular text-ink-50">{formatSeq(event.seq)}</span>
        </span>
      </div>

      <Group label="Identity">
        <KeyValue
          dense
          rows={[
            {
              k: 'Timestamp',
              v: (
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <Mono className="text-ink">{formatTimestamp(event.ts)}</Mono>
                  <span className="text-xs text-ink-50">{relativeTime(event.ts)}</span>
                </span>
              ),
            },
            { k: 'Type', v: <Mono className="text-ink">{event.event_type}</Mono> },
            { k: 'Actor', v: ACTOR_LABEL[event.actor] },
            {
              k: 'Project',
              v: event.project_id ? project ? project.name : <Removed id={event.project_id} what="Project" /> : <Dash />,
            },
            {
              k: 'Conversation',
              v: event.conversation_id ? conversation ? <span className="truncate">{conversation.title}</span> : <Removed id={event.conversation_id} what="Conversation" /> : <Dash />,
            },
            { k: 'Provider', v: event.provider ? <ProviderBadge provider={event.provider} model={model} /> : <Dash /> },
          ]}
        />
      </Group>

      <Group label="Commitments" hint="Bind the event to the exact input and output without storing either.">
        <KeyValue
          dense
          rows={[
            { k: 'Model digest', v: <FullHash value={event.model_digest} /> },
            { k: 'Input', v: <FullHash value={event.input_commitment} /> },
            { k: 'Output', v: <FullHash value={event.output_commitment} /> },
          ]}
        />
      </Group>

      <Group label="Chain">
        <KeyValue
          dense
          rows={[
            { k: 'Previous hash', v: <FullHash value={event.prev_hash} /> },
            { k: 'Event hash', v: <FullHash value={event.event_hash} /> },
            {
              k: 'Stream / epoch',
              v: (
                <Mono className="text-ink">
                  {shortHash(event.stream_id, 8, 4)} · epoch {event.epoch}
                </Mono>
              ),
            },
          ]}
        />
      </Group>

      <Group label="Payload" right={rows.length ? `${rows.length} ${rows.length === 1 ? 'key' : 'keys'}` : undefined} last>
        {rows.length ? (
          <dl className="divide-y divide-line-soft rounded-md border border-line bg-paper-raised">
            {rows.map((r) => (
              <div key={r.key} className="grid grid-cols-[minmax(96px,38%)_1fr] gap-3 px-3 py-2 font-mono text-xs">
                <dt className="truncate text-ink-50">{r.key}</dt>
                <dd className="break-all text-ink">{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs leading-4.5 text-ink-50">No payload for this event type.</p>
        )}
      </Group>
    </div>
  )
}

function Group({ label, hint, right, children, last }: { label: string; hint?: string; right?: ReactNode; children: ReactNode; last?: boolean }) {
  return (
    <section className={last ? undefined : 'mb-6'} aria-label={label}>
      <SectionLabel right={right}>{label}</SectionLabel>
      {hint && <p className="mt-1 text-xs leading-4.5 text-ink-50">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

function FullHash({ value }: { value?: string }) {
  if (!value) return <Dash />
  return <Hash value={value} full className="text-2xs leading-4 text-ink" />
}

function Dash() {
  return <span className="font-mono text-xs text-ink-30">—</span>
}

function Removed({ id, what }: { id: string; what: string }): ReactNode {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-ink-soft">{what} removed from this computer</span>
      <Mono className="text-ink-50">{id.slice(0, 8)}</Mono>
    </span>
  )
}
