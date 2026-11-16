import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Check, Copy, FileText, History, MonitorSmartphone, RefreshCw, Square } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'
import type { Message, Project } from '@/lib/types'
import { Badge, ProviderBadge } from '@/components/ui/chips'
import { useCopy } from '@/components/ui/layout'
import { Button, IconButton } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui/overlays'
import { Markdown } from './Markdown'

/* A question opens a turn, so it has more room above it than the answer that follows. */

export function UserMessage({ message, highlighted, askedWith }: { message: Message; highlighted?: boolean; /** Names of the documents from My secure knowledge this question was asked with. */ askedWith?: string[] }) {
  return (
    <div className={cn('group flex flex-col items-end gap-1.5 pt-4 pb-1.5 first:pt-1', highlighted && 'rounded-lg ring-2 ring-green/40 ring-offset-4')} id={`m-${message.id}`}>
      <div className="flex w-full justify-end gap-3">
        <time dateTime={message.created_at} className="self-end pb-1 text-2xs tabular text-ink-50 opacity-0 transition-opacity duration-(--duration-micro) group-hover:opacity-100">
          {formatTime(message.created_at)}
        </time>
        <div className="max-w-[min(78%,640px)] whitespace-pre-wrap rounded-xl rounded-br-sm border border-line-soft bg-paper px-4 py-2.5 text-md leading-6 text-ink">{message.content}</div>
      </div>
      {askedWith && askedWith.length > 0 && (
        <ul className="flex max-w-[min(78%,640px)] flex-wrap items-center justify-end gap-1.5" aria-label="Documents this was asked with">
          <li className="text-2xs leading-4 text-ink-50" aria-hidden>
            Asked with:
          </li>
          {askedWith.map((name) => (
            <li key={name} className="inline-flex h-5 max-w-full items-center gap-1 rounded-sm border border-line-soft bg-paper-raised px-1.5 text-2xs leading-none text-ink-soft" title={name}>
              <FileText className="size-3 shrink-0 text-ink-50" strokeWidth={1.75} aria-hidden />
              <span className="max-w-60 truncate leading-4">{name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function AssistantMessage({ message, modelName, project, isLast, generating, onRegenerate, onContinueLocally, highlighted, phase }: { message: Message; modelName: string; project: Project; isLast: boolean; generating: boolean; onRegenerate: () => void; onContinueLocally: () => void; highlighted?: boolean; phase?: 'loading_engine' | 'preparing' | 'streaming' | null }) {
  const { copied, copy } = useCopy()
  const navigate = useNavigate()
  const [showPrevious, setShowPrevious] = useState(false)
  const streaming = message.status === 'streaming'
  const empty = message.content.length === 0
  const startingUp = phase === 'loading_engine' && empty
  const reading = !!message.preparing
  const finished = !streaming
  // An answer stopped before its first word leaves nothing worth showing as "earlier".
  const earlier = [...(message.previous_versions ?? [])].reverse().find((v) => v.trim().length > 0)

  return (
    <div className={cn('group relative pt-2 pb-1', highlighted && 'rounded-lg ring-2 ring-green/40 ring-offset-4')} id={`m-${message.id}`}>
      {/* Where it ran comes first and carries the colour; the AI model and the time follow quietly. */}
      <div className="mb-1.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-50">
        {message.provider === 'local' ? (
          <span className="inline-flex items-center gap-1.5" title="Where it ran: this computer">
            <MonitorSmartphone className="size-3.5 text-green" aria-hidden />
            <span className="font-medium text-green-dark">This computer</span>
            <span aria-hidden>·</span>
            <span>{modelName}</span>
          </span>
        ) : (
          <ProviderBadge provider={message.provider} model={modelName} />
        )}
        <span aria-hidden>·</span>
        <time dateTime={message.created_at} className="tabular">
          {formatTime(message.created_at)}
        </time>
        {message.status === 'stopped' && (
          <Badge tone="neutral" icon={<Square />}>Stopped</Badge>
        )}
        {message.status === 'partial' && (
          <Badge tone="brass">Cut off. Saved as far as it got.</Badge>
        )}
        {message.status === 'error' && <Badge tone="deny">Could not answer</Badge>}
        {message.continued_from && (
          <Tooltip content="The answer above was cut off on the company server. This one carries on from there on this computer. Nothing was sent.">
            <span><Badge tone="green">Continued on this computer</Badge></span>
          </Tooltip>
        )}
        {message.evidence_pending && (
          <Tooltip content="Activity recording is paused. This answer will be recorded when it catches up.">
            <span><Badge tone="brass">Not recorded yet</Badge></span>
          </Tooltip>
        )}
        {earlier && (
          <Popover open={showPrevious} onOpenChange={setShowPrevious}>
            <PopoverTrigger asChild>
              <button className="inline-flex h-5 items-center gap-1 rounded-sm px-1 text-2xs text-ink-50 transition-colors duration-(--duration-micro) hover:bg-ink-6 hover:text-ink">
                <History className="size-3" />Asked again · show earlier answer
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-h-80 w-[480px] overflow-y-auto">
              <div className="label-mono mb-2">Earlier answer</div>
              <Markdown content={earlier} className="text-sm" />
            </PopoverContent>
          </Popover>
        )}
        {/* Quiet by design: it appears when the answer is pointed at or focused, and always on touch screens. */}
        {!message.evidence_pending && message.evidence_seq && (
          <button
            onClick={() => navigate(`/projects/${project.id}/activity?seq=${message.evidence_seq}`)}
            className="inline-flex h-5 items-center rounded-sm px-1 text-2xs text-ink-50 opacity-0 transition-[opacity,color] duration-(--duration-micro) hover:text-ink hover:underline focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
          >
            See in Activity
          </button>
        )}
      </div>

      {/* While waiting, one line the height of a line of text holds the place, so the first words arrive without a jump. */}
      {reading || startingUp ? (
        <WaitingLine label={startingUp ? 'Starting up' : 'Reading the conversation so far'} detail={startingUp ? 'Getting the AI model ready. This happens once after AIOS opens.' : 'Long conversations take a moment before the first word.'} />
      ) : empty && streaming ? (
        <WaitingLine label="Working on an answer" />
      ) : empty ? (
        <p className="flex h-6 items-center text-sm text-ink-50">{message.status === 'stopped' ? 'Stopped before anything was written.' : 'No answer was written.'}</p>
      ) : (
        <div className={cn('max-w-[760px]', streaming && 'caret')}>
          <Markdown content={message.content} />
        </div>
      )}

      {message.status === 'partial' && message.continuation_offered && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-brass/40 bg-brass-soft px-3 py-2 text-sm text-ink">
          <span className="flex-1">The connection dropped before the answer finished. You can carry on from here on this computer.</span>
          <Button size="sm" variant="primary" onClick={onContinueLocally}>Continue on this computer</Button>
        </div>
      )}

      {/* The row keeps its height while the answer is written, so nothing shifts when the actions arrive. */}
      <div className="mt-1.5 flex h-7 items-center gap-0.5">
        {finished &&
          (isLast ? (
            // The latest answer shows its actions in words; a first-time user should not have to find them by hovering.
            <div className="-ml-2 flex animate-fade items-center gap-0.5">
              {!empty && (
                <Button size="sm" variant="ghost" leading={copied ? <Check className="size-3.5 text-green" /> : <Copy className="size-3.5" />} onClick={() => copy(message.content)}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
              <Tooltip content="Ask the same question again. The earlier answer is kept.">
                <Button size="sm" variant="ghost" leading={<RefreshCw className="size-3.5" />} onClick={onRegenerate} disabled={generating}>
                  Ask again
                </Button>
              </Tooltip>
            </div>
          ) : empty ? null : (
            <div className="-ml-1.5 flex items-center opacity-0 transition-opacity duration-(--duration-micro) group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              <Tooltip content={copied ? 'Copied' : 'Copy answer'}>
                <IconButton label="Copy answer" size="sm" onClick={() => copy(message.content)}>
                  {copied ? <Check className="text-green" /> : <Copy />}
                </IconButton>
              </Tooltip>
            </div>
          ))}
      </div>
    </div>
  )
}

/**
 * The wait before the first word: a single calm line, exactly one line of answer text tall.
 * The dot fades gently in and out; nothing moves.
 */
export function WaitingLine({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex h-6 max-w-[760px] items-center gap-2.5 text-sm" role="status">
      <span className="size-2 shrink-0 rounded-full bg-green motion-safe:animate-pulse" aria-hidden />
      <span className="shrink-0 text-ink-soft">{label}</span>
      {detail && <span className="hidden min-w-0 truncate text-ink-50 sm:inline">{detail}</span>}
    </div>
  )
}
