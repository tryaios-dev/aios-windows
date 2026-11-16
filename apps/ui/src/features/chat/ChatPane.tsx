import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, ArrowRightLeft, Cpu, FileText, Pencil } from 'lucide-react'
import { api } from '@/lib/api'
import { STARTERS } from '@/data/stack'
import { selectCompanyModelName, useStore, useStoreShallow } from '@/lib/store'
import type { Conversation, Message, Project } from '@/lib/types'
import { cn } from '@/lib/cn'
import { dayLabel, formatTime, pluralise, relativeTime } from '@/lib/format'
import { modelLabelById } from '@/lib/words'
import { Button, IconButton } from '@/components/ui/button'
import { ClassChip } from '@/components/ui/chips'
import { Callout } from '@/components/ui/feedback'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays'
import { RenameDialog } from '@/features/projects/ProjectDialogs'
import { FallbackNotice } from '@/components/app/FallbackNotice'
import { AssistantMessage, UserMessage } from './MessageItem'
import { Composer } from './Composer'
import { StarterList } from './Starters'
import { useKnowledgeUse } from './knowledgeUse'

export function ChatPane({ conversation, project, onBack }: { conversation: Conversation; project: Project; onBack?: () => void }) {
  const messages = useStoreShallow((s) => s.messages.filter((m) => m.conversation_id === conversation.id))
  const summary = useStore((s) => s.summaries.find((x) => x.conversation_id === conversation.id))
  const installed = useStore((s) => s.installedModels)
  const generation = useStore((s) => s.generation)
  const health = useStore((s) => s.health)
  // Which documents each question was asked with, by message. The stored map is selected as it is.
  const askedWith = useKnowledgeUse((s) => s.askedWith)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [rename, setRename] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // Desktop app: this conversation's messages come from the backend when it opens (GET /conversations/{id}/messages).
  useEffect(() => {
    api.conversations.load(conversation.id)
  }, [conversation.id])
  const highlightId = params.get('m')

  const noModel = installed.length === 0
  const isCompany = conversation.current_provider === 'company'
  /** "Standard · Qwen3 8B" for an answer from this computer; the server's own name otherwise. */
  const companyModel = useStore(selectCompanyModelName)
  const modelName = (m: Message) => (m.provider === 'company' ? companyModel : modelLabelById(m.model_id, installed))

  // A starter fills the message box through the same parameters Home uses: ?draft=<id>, plus example=1 for the full example.
  const fillFrom = (id: string, withExample: boolean) => {
    // Name an untitled conversation after the task, as Home does, so the list does not show the request's first words.
    const starter = STARTERS.find((x) => x.id === id)
    if (starter && conversation.title === 'New conversation') api.conversations.rename(conversation.id, starter.conversationTitle)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('draft', id)
        if (withExample) next.set('example', '1')
        else next.delete('example')
        return next
      },
      { replace: true },
    )
  }

  // Stay pinned to the bottom while streaming unless the user scrolled up.
  const lastContentLength = messages.length ? messages[messages.length - 1].content.length : 0
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages.length, lastContentLength, generation?.phase])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Jump to a message from search.
  useEffect(() => {
    if (!highlightId) return
    const el = document.getElementById(`m-${highlightId}`)
    if (el) {
      stickToBottom.current = false
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [highlightId, conversation.id])

  // Dividers: summaries and moves between this computer and the company server are placed by position and time.
  const rendered = useMemo(() => {
    const items: Array<{ kind: 'day'; key: string; label: string } | { kind: 'summary'; key: string } | { kind: 'move'; key: string; to: 'local' | 'company'; at: string } | { kind: 'message'; key: string; message: Message }> = []
    const moves = [...(conversation.moves ?? [])].sort((a, b) => a.at.localeCompare(b.at))
    let moveIdx = 0
    let lastDay = ''
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      while (moveIdx < moves.length && moves[moveIdx].at <= m.created_at) {
        items.push({ kind: 'move', key: `move-${moveIdx}`, to: moves[moveIdx].to, at: moves[moveIdx].at })
        moveIdx++
      }
      const day = dayLabel(m.created_at)
      if (day !== lastDay) {
        items.push({ kind: 'day', key: `day-${i}`, label: day })
        lastDay = day
      }
      items.push({ kind: 'message', key: m.id, message: m })
      if (summary && summary.covers_until_message_id === m.id) items.push({ kind: 'summary', key: `summary-${m.id}` })
    }
    while (moveIdx < moves.length) {
      items.push({ kind: 'move', key: `move-${moveIdx}`, to: moves[moveIdx].to, at: moves[moveIdx].at })
      moveIdx++
    }
    return items
  }, [messages, conversation.moves, summary])

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const busy = !!generation && generation.conversation_id === conversation.id

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Conversation header */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line-soft px-5">
        <div className="group flex min-w-0 items-center gap-2">
          {onBack && (
            <IconButton label="Back to conversations" size="sm" className="-ml-2" onClick={onBack}>
              <ArrowLeft />
            </IconButton>
          )}
          <h2 className="truncate text-sm font-medium text-ink">{conversation.title}</h2>
          <IconButton label="Rename conversation" size="sm" className="-ml-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" onClick={() => setRename(true)}>
            <Pencil />
          </IconButton>
          {/* The project header already carries the label; repeat it only when this conversation differs. */}
          {conversation.classification_effective !== project.classification && <ClassChip value={conversation.classification_effective} size="xs" />}
          {conversation.classification_source === 'review' && <span className="font-mono text-2xs text-ink-50">copy</span>}
          {conversation.classification_source === 'import' && <span className="font-mono text-2xs text-ink-50">added from a file</span>}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-2xs text-ink-50">
          {summary && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="inline-flex items-center gap-1 rounded-sm px-1 transition-colors duration-(--duration-micro) hover:text-ink">
                  <FileText className="size-3" /> Earlier messages are summarised
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-96">
                <div className="label-mono mb-1.5">Summary of earlier messages</div>
                <p className="text-sm leading-5 text-ink-soft">{summary.content}</p>
                <p className="mt-2 text-2xs leading-4 text-ink-50">
                  This conversation is long, so the AI reads this summary in place of the oldest messages. Every message is still here for you to read. Written {relativeTime(summary.created_at)} {summary.provider === 'local' ? 'on this computer' : 'on the company server'}.
                </p>
              </PopoverContent>
            </Popover>
          )}
          {messages.length > 0 && <span className="tabular">{pluralise(messages.length, 'message')}</span>}
        </div>
      </div>

      {/* Notices */}
      <FallbackNotice className="mx-5 mt-3 max-w-[760px] self-center" />
      <span className="sr-only" role="status">{busy ? (generation?.phase === 'streaming' ? 'Answering' : generation?.phase === 'preparing' ? 'Reading the conversation so far' : 'Starting up') : ''}</span>
      {health.writer === 'unavailable' && (
        <div className="border-b border-line-soft bg-paper px-5 py-1.5" role="status">
          <p className="mx-auto max-w-[760px] text-xs text-ink-50">
            <span className="font-medium text-brass-text">Activity recording is paused.</span> You can keep working; it will catch up by itself.
          </p>
        </div>
      )}

      {/* Thread */}
      <div ref={scrollRef} className="scroll-stable min-h-0 flex-1 overflow-y-auto px-5">
        <div className={cn('mx-auto flex max-w-[760px] flex-col py-5', messages.length === 0 && 'min-h-full justify-center')}>
          {messages.length === 0 ? (
            noModel ? null : (
              <div className="flex flex-col items-center py-6 text-center">
                <h3 className="font-display text-2xl text-ink">{project.archived ? 'Nothing here yet' : 'Ask anything'}</h3>
                <p className="mt-1.5 max-w-md text-sm leading-5 text-ink-soft">
                  {project.archived
                    ? 'This project is archived. Restore it to carry on here.'
                    : isCompany
                      ? 'This conversation runs on the company server. What you write here is sent there and nowhere else.'
                      : 'Type in the box below, or start from one of these. Nothing leaves this computer unless you say so.'}
                </p>
                {!project.archived && (
                  <div className="mt-6 flex w-full justify-center">
                    <StarterList onPick={(starter, withExample) => fillFrom(starter.id, withExample)} knowledgeHint={!isCompany} />
                  </div>
                )}
              </div>
            )
          ) : (
            rendered.map((item) => {
              if (item.kind === 'day') return <DayDivider key={item.key} label={item.label} />
              if (item.kind === 'summary') return <SummaryDivider key={item.key} />
              if (item.kind === 'move') return <MoveDivider key={item.key} to={item.to} at={item.at} />
              const m = item.message
              if (m.role === 'user') return <UserMessage key={m.id} message={m} highlighted={highlightId === m.id} askedWith={askedWith[m.id]} />
              return (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  modelName={modelName(m)}
                  project={project}
                  isLast={lastAssistant?.id === m.id}
                  generating={busy}
                  phase={busy && generation?.message_id === m.id ? generation.phase : null}
                  onRegenerate={() => api.conversations.regenerate(conversation.id)}
                  onContinueLocally={() => api.conversations.offerContinueLocally(conversation.id, m.id)}
                  highlighted={highlightId === m.id}
                />
              )
            })
          )}
        </div>
      </div>

      {/* Composer or the no-model state */}
      {noModel ? (
        <div className="scroll-stable shrink-0 overflow-y-hidden border-t border-line-soft bg-white px-5 pb-5 pt-4">
          <div className="mx-auto max-w-[760px]">
            <Callout tone="neutral" title="No AI model installed" action={<Button variant="primary" size="sm" leading={<Cpu className="size-3.5" />} onClick={() => navigate('/models')}>Choose an AI model</Button>}>
              Chat needs one. Your projects, search and backups work without it.
            </Callout>
          </div>
        </div>
      ) : (
        <Composer conversation={conversation} disabled={project.archived} />
      )}

      <RenameDialog open={rename} onOpenChange={setRename} title="Rename conversation" label="Title" initial={conversation.title} onSubmit={(t) => api.conversations.rename(conversation.id, t)} />
    </div>
  )
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="my-3 flex items-center gap-3" role="separator">
      <span className="h-px flex-1 bg-line-soft" />
      <span className="label-mono">{label}</span>
      <span className="h-px flex-1 bg-line-soft" />
    </div>
  )
}

function SummaryDivider() {
  return (
    <div className="my-3 flex items-center gap-3" role="separator">
      <span className="h-px flex-1 border-t border-dashed border-line" />
      <span className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-paper px-2 py-0.5 text-2xs text-ink-50">
        <FileText className="size-3" />
        Messages above are summarised so the AI keeps the thread.
      </span>
      <span className="h-px flex-1 border-t border-dashed border-line" />
    </div>
  )
}

function MoveDivider({ to, at }: { to: 'local' | 'company'; at: string }) {
  return (
    <div className="my-3 flex items-center gap-3" role="separator">
      <span className={cn('h-px flex-1', to === 'company' ? 'bg-ink/30' : 'bg-green/40')} />
      <span className={cn('inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-2xs font-medium', to === 'company' ? 'border-ink/30 bg-paper-deep text-ink' : 'border-green/30 bg-green-wash text-green-dark')}>
        <ArrowRightLeft className="size-3" />
        {to === 'company' ? `Moved to the company server · ${formatTime(at)} · its history was sent` : `Moved back to this computer · ${formatTime(at)} · nothing was sent`}
      </span>
      <span className={cn('h-px flex-1', to === 'company' ? 'bg-ink/30' : 'bg-green/40')} />
    </div>
  )
}
