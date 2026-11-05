import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { ArrowUpRight, X } from "lucide-react";
import { useStore } from "@/bridge/sim/store";
import type { EvidenceEvent } from "@/lib/types";
import { formatTimestamp, relativeTime } from "@/lib/format";
import { shortHash } from "@/lib/hash";
import { Button, IconButton } from "@/components/ui/button";
import { ProviderBadge } from "@/components/ui/chips";
import { Callout } from "@/components/ui/feedback";
import { Hash, KeyValue, Mono, SectionLabel } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/overlays";
import { ACTOR_LABEL, EVENT_META, eventContext, formatSeq, payloadRows, type ContextLookups } from "./eventMeta";

/**
 * Every field of one Evidence Wire Format v1 record, plus its content-free payload,
 * laid out as a ledger page: identity, commitments, chain, payload.
 * The parent keeps `event` set while the sheet animates closed, so the panel never empties mid-slide.
 */
export function EventDetailSheet({
  event: shown,
  open,
  onOpenChange,
  lookups,
}: {
  event: EvidenceEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lookups: ContextLookups;
}) {
  const navigate = useNavigate();
  const conversation = useStore((s) => s.conversations.find((c) => c.id === shown?.conversation_id));
  const project = useStore((s) => s.projects.find((p) => p.id === shown?.project_id));

  if (!shown) return null;

  const meta = EVENT_META[shown.event_type];
  const Icon = meta.icon;
  const rows = payloadRows(shown);
  const model = lookups.modelName(
    shown.model_digest,
    typeof shown.payload?.entry_id === "string" ? shown.payload.entry_id : undefined,
  );
  const context = eventContext(shown, lookups);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width="w-[480px]"
      bare
      title={`${meta.label} ${formatSeq(shown.seq)}`}
      description={context || undefined}
    >
      {/* Header */}
      <div className="flex items-start gap-4 border-b border-line-soft px-6 pt-5 pb-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-paper-raised text-ink-soft">
          <Icon className="size-5" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="label-mono">Evidence Wire Format v1</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold leading-6 text-ink">{meta.label}</h2>
            <span className="font-mono text-base tabular text-ink-50">{formatSeq(shown.seq)}</span>
          </div>
          {context && (
            <p className="mt-1 truncate text-sm text-ink-soft" title={context}>
              {context}
            </p>
          )}
        </div>
        <IconButton label="Close" size="sm" className="-mr-1.5 -mt-1" onClick={() => onOpenChange(false)}>
          <X />
        </IconButton>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {shown.pending && (
          <Callout tone="caution" compact className="mb-6">
            Waiting for the evidence writer. The event sits in the outbox and is appended exactly once when the writer
            is back.
          </Callout>
        )}

        <Group label="Identity">
          <KeyValue
            dense
            rows={[
              {
                k: "Timestamp",
                v: (
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <Mono className="text-ink">{formatTimestamp(shown.ts)}</Mono>
                    <span className="text-xs text-ink-50">{relativeTime(shown.ts)}</span>
                  </span>
                ),
              },
              { k: "Type", v: <Mono className="text-ink">{shown.event_type}</Mono> },
              { k: "Actor", v: ACTOR_LABEL[shown.actor] },
              {
                k: "Project",
                v: shown.project_id ? (
                  project ? (
                    project.name
                  ) : (
                    <Removed id={shown.project_id} what="Project" />
                  )
                ) : (
                  <Dash />
                ),
              },
              {
                k: "Conversation",
                v: shown.conversation_id ? (
                  conversation ? (
                    <span className="truncate">{conversation.title}</span>
                  ) : (
                    <Removed id={shown.conversation_id} what="Conversation" />
                  )
                ) : (
                  <Dash />
                ),
              },
              {
                k: "Provider",
                v: shown.provider ? <ProviderBadge provider={shown.provider} model={model} /> : <Dash />,
              },
            ]}
          />
        </Group>

        <Group label="Commitments" hint="Bind the event to the exact input and output without storing either.">
          <KeyValue
            dense
            rows={[
              { k: "Model digest", v: <FullHash value={shown.model_digest} /> },
              { k: "Input", v: <FullHash value={shown.input_commitment} /> },
              { k: "Output", v: <FullHash value={shown.output_commitment} /> },
            ]}
          />
        </Group>

        <Group label="Chain">
          <KeyValue
            dense
            rows={[
              { k: "Previous hash", v: <FullHash value={shown.prev_hash} /> },
              { k: "Event hash", v: <FullHash value={shown.event_hash} /> },
              {
                k: "Stream / epoch",
                v: (
                  <Mono className="text-ink">
                    {shortHash(shown.stream_id, 8, 4)} · epoch {shown.epoch}
                  </Mono>
                ),
              },
            ]}
          />
        </Group>

        <Group
          label="Payload"
          right={rows.length ? `${rows.length} ${rows.length === 1 ? "key" : "keys"}` : undefined}
          last
        >
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

      {/* Footer */}
      <div className="flex items-center justify-between gap-4 border-t border-line-soft px-6 py-4">
        <p className="min-w-0 flex-1 text-xs leading-4.5 text-ink-50">
          Content never enters the log. The two commitments let a holder of the content prove exactly what was sent and
          received.
        </p>
        {conversation && (
          <Button
            variant="secondary"
            size="sm"
            trailing={<ArrowUpRight className="size-3.5" aria-hidden />}
            onClick={() => {
              onOpenChange(false);
              navigate(`/projects/${conversation.project_id}/c/${conversation.id}`);
            }}
          >
            Open conversation
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function Group({
  label,
  hint,
  right,
  children,
  last,
}: {
  label: string;
  hint?: string | undefined;
  right?: ReactNode | undefined;
  children: ReactNode;
  last?: boolean | undefined;
}) {
  return (
    <section className={last ? undefined : "mb-6"} aria-label={label}>
      <SectionLabel right={right}>{label}</SectionLabel>
      {hint && <p className="mt-1 text-xs leading-4.5 text-ink-50">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function FullHash({ value }: { value?: string | undefined }) {
  if (!value) return <Dash />;
  return <Hash value={value} full className="text-2xs leading-4 text-ink" />;
}

function Dash() {
  return <span className="font-mono text-xs text-ink-30">—</span>;
}

function Removed({ id, what }: { id: string; what: string }): ReactNode {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-ink-soft">{what} removed from this device</span>
      <Mono className="text-ink-50">{id.slice(0, 8)}</Mono>
    </span>
  );
}
