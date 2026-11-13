import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { ArrowUp, Building2, ChevronDown, Cpu, Lock, MonitorSmartphone, Square } from 'lucide-react'
import { api } from '@/lib/api'
import { useExtras } from '@/lib/extras'
import { COMPANY_MODEL_NAME, useStore } from '@/lib/store'
import type { Conversation } from '@/lib/types'
import { cn } from '@/lib/cn'
import { modelLabel, sizeBlurb } from '@/lib/words'
import { STARTERS } from '@/data/stack'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/feedback'
import { Kbd } from '@/components/ui/layout'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui/overlays'
import { MoveToCompanyDialog } from './ChatDialogs'
import { KnowledgeButton, KnowledgeChips } from './KnowledgePicker'
import { documentNamedIn, useChosenDocuments, useKnowledgeUse } from './knowledgeUse'
import { lowerFirst } from './Starters'
import { useDictation } from '@/features/voice/useDictation'
import { AutoHeight, FromVoiceNote, MicButton, VoicePanel } from '@/features/voice/VoicePanel'

/** Text another screen handed over through router state, for example Home's ask box when a message could not be sent. */
function handedOverText(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null
  const value = (state as { draftText?: unknown }).draftText
  return typeof value === 'string' && value.trim() ? value : null
}

export function Composer({ conversation, disabled }: { conversation: Conversation; disabled?: boolean }) {
  const [text, setText] = useState('')
  const [tooLong, setTooLong] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  /** The starter whose example is in the box. The "sample text" line shows while the text is still exactly that example. */
  const [sampleId, setSampleId] = useState<string | null>(null)
  /** The words in the box came from speaking. The note above the box shows until they are sent or cleared. */
  const [fromVoice, setFromVoice] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  /** A range to select once the starter text is in the box, so typing replaces the first blank. */
  const selectAfterFill = useRef<[number, number] | null>(null)
  /** After an example is filled in, show its first line, not its last. */
  const showStartAfterFill = useRef(false)
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const draftId = params.get('draft')
  const wantsExample = params.get('example') === '1'
  const handedText = handedOverText(location.state)
  const generation = useStore((s) => s.generation)
  const installed = useStore((s) => s.installedModels)
  const companyFlag = useStore((s) => s.sim.companyFlag)
  const company = useStore((s) => s.health.company)
  const pendingText = useStore((s) => s.continueLocally?.pending_text ?? s.modelChoice?.pending_text)
  const busy = !!generation && generation.conversation_id === conversation.id
  const otherBusy = !!generation && generation.conversation_id !== conversation.id
  const isCompany = conversation.current_provider === 'company'
  const currentModel = installed.find((m) => m.id === conversation.model_id)
  const currentLabel = isCompany ? `Company server · ${COMPANY_MODEL_NAME}` : currentModel ? modelLabel(currentModel) : 'Choose an AI model'

  // Documents from My secure knowledge this conversation is using. This is kept in the interface only:
  // nothing is added to the message text. Once a message is in the conversation, the names are noted against it.
  const { chosen: chosenDocs } = useChosenDocuments(conversation.id)
  /** The message on its way out and the documents it was asked with, until it appears in the conversation. */
  const sending = useRef<{ text: string; names: string[] } | null>(null)
  const lastUserMessageId = useStore((s) => {
    for (let i = s.messages.length - 1; i >= 0; i--) {
      const m = s.messages[i]
      if (m.conversation_id === conversation.id && m.role === 'user') return m.id
    }
    return null
  })
  // This also covers a message a dialog held back and sent a moment later.
  useEffect(() => {
    const out = sending.current
    if (!out || !lastUserMessageId) return
    const message = useStore.getState().messages.find((m) => m.id === lastUserMessageId)
    if (!message || message.content !== out.text) return
    sending.current = null
    useKnowledgeUse.getState().recordSent(message.id, out.names)
  }, [lastUserMessageId, conversation.id])

  // Keep text the user tried to send if a dialog interrupted it.
  useEffect(() => {
    if (pendingText && !text) setText(pendingText)

  }, [pendingText])

  // Text arrives ready to edit in two ways, and is never sent automatically:
  //   router state { draftText } from Home's ask box, which wins when both are present;
  //   ?draft=<id> for a starter with blanks to fill, or ?draft=<id>&example=1 for its full example.
  // Either is used once, then dropped from the address so it cannot fill the box a second time.
  useEffect(() => {
    if (!draftId && !handedText) return
    if (handedText) {
      selectAfterFill.current = [handedText.length, handedText.length]
      showStartAfterFill.current = false
      setText(handedText)
      setSampleId(null)
      setTooLong(false)
      // "Ask about this document" in My secure knowledge names the document: have it chosen already.
      const named = documentNamedIn(handedText, useExtras.getState().knowledge)
      if (named) {
        const now = useKnowledgeUse.getState().chosen[conversation.id] ?? []
        if (!now.includes(named.id)) useKnowledgeUse.getState().setChosen(conversation.id, [...now, named.id])
      }
    } else {
      const starter = STARTERS.find((x) => x.id === draftId)
      if (starter && wantsExample) {
        // The whole request is there: the cursor waits at the end and Enter sends it.
        selectAfterFill.current = [starter.example.length, starter.example.length]
        showStartAfterFill.current = true
        setText(starter.example)
        setSampleId(starter.id)
        setTooLong(false)
      } else if (starter) {
        const blank = /\[[^\]]+\]/.exec(starter.prompt)
        selectAfterFill.current = blank ? [blank.index, blank.index + blank[0].length] : [starter.prompt.length, starter.prompt.length]
        showStartAfterFill.current = false
        setText(starter.prompt)
        setSampleId(null)
        setTooLong(false)
      }
    }
    ref.current?.focus()
    const next = new URLSearchParams(params)
    next.delete('draft')
    next.delete('example')
    const search = next.toString()
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true, state: null })

  }, [draftId, wantsExample, handedText])

  // Auto-grow up to ~8 lines.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 8 * 24 + 16)}px`
    const range = selectAfterFill.current
    if (range && text.length >= range[1]) {
      selectAfterFill.current = null
      el.focus()
      el.setSelectionRange(range[0], range[1])
      if (showStartAfterFill.current) {
        showStartAfterFill.current = false
        el.scrollTop = 0
      }
    }
  }, [text])

  useEffect(() => {
    ref.current?.focus()
  }, [conversation.id])

  // Speaking instead of typing. What was heard joins whatever is already in the box, and is never sent by itself.
  const textNow = useRef(text)
  useEffect(() => {
    textNow.current = text
  }, [text])
  const dictation = useDictation((heard) => {
    const before = textNow.current.replace(/\s+$/, '')
    const next = before ? `${before} ${heard}` : heard
    selectAfterFill.current = [next.length, next.length]
    showStartAfterFill.current = false
    setText(next)
    setSampleId(null)
    setTooLong(false)
    setFromVoice(true)
  })
  const speaking = dictation.phase !== 'idle'

  const send = () => {
    if (!text.trim() || busy || otherBusy || disabled) return
    const names = isCompany ? [] : chosenDocs.map((d) => d.name)
    sending.current = names.length ? { text: text.trim(), names } : null
    const result = api.conversations.send(conversation.id, text)
    if (result.ok) {
      setText('')
      setFromVoice(false)
      setSampleId(null)
      setTooLong(false)
    } else if (result.reason === 'too_large') {
      // The reason carries figures; people get the fix instead.
      sending.current = null
      setTooLong(true)
    } else if (result.reason === 'company_unreachable' || result.reason === 'model_missing') {
      // A dialog takes over; the text stays in the box, and so do the chosen documents.
      setTooLong(false)
    } else if (result.reason === 'no_model') {
      sending.current = null
      navigate('/models')
    } else {
      sending.current = null
    }
  }

  const sample = sampleId ? STARTERS.find((x) => x.id === sampleId && x.example === text) : undefined
  const canSend = !!text.trim() && !busy && !otherBusy && !disabled
  const placeholder = disabled ? 'This project is archived' : isCompany ? 'Write a message for the company server' : currentModel ? 'Ask a question, or paste text to work on' : 'Choose an AI model to start'

  return (
    // The gutter matches the scrolling thread above, so the box and the messages share one centre line.
    <div className="scroll-stable shrink-0 overflow-y-hidden border-t border-line-soft bg-white px-5 pb-4 pt-3">
      <div className="mx-auto max-w-[760px]">
        {tooLong && (
          <Callout tone="deny" compact className="mb-3" title="That message is too long.">
            Try sending it in two parts.
          </Callout>
        )}
        <div
          className={cn(
            'rounded-xl border bg-paper-raised shadow-[0_1px_2px_rgba(22,33,27,0.04)] transition-[border-color,box-shadow,background-color] duration-(--duration-micro) ease-(--ease-out)',
            disabled ? 'border-line opacity-60' : 'border-line-strong focus-within:border-green focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(30,95,70,0.12),0_1px_2px_rgba(22,33,27,0.04)]',
          )}
        >
          {sample && (
            <div className="flex items-center gap-2 border-b border-dashed border-line px-4 py-1.5 text-xs text-ink-50">
              <span className="inline-flex h-5 shrink-0 items-center rounded-sm border border-dashed border-line-strong px-1.5 text-2xs font-medium">Example</span>
              <span className="min-w-0 flex-1 truncate">
                Sample text: {lowerFirst(sample.exampleLabel)}. Edit it or replace it with your own, then press Enter.
              </span>
              <button
                type="button"
                onClick={() => {
                  setText('')
                  setSampleId(null)
                  ref.current?.focus()
                }}
                className="shrink-0 rounded-sm px-1 font-medium text-ink-soft transition-colors duration-(--duration-micro) hover:text-ink"
              >
                Clear
              </button>
            </div>
          )}
          {fromVoice && !sample && !speaking && text.trim() && (
            <FromVoiceNote
              onClear={() => {
                setText('')
                setFromVoice(false)
                ref.current?.focus()
              }}
            />
          )}
          {!isCompany && !disabled && <KnowledgeChips conversationId={conversation.id} />}
          <AutoHeight>
            {speaking && <VoicePanel dictation={dictation} className="animate-fade" />}
            <div className={speaking ? 'hidden' : undefined}>
              <textarea
                ref={ref}
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  if (tooLong) setTooLong(false)
                  if (!e.target.value.trim()) setFromVoice(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    send()
                  }
                }}
                placeholder={placeholder}
                disabled={disabled}
                rows={1}
                aria-label="Message"
                className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-md leading-6 text-ink placeholder:text-ink-50 focus:outline-none disabled:cursor-not-allowed"
              />
              <div className="flex items-center justify-between gap-2 px-2 pb-2">
                <div className="flex min-w-0 items-center gap-1">
                  {/* Documents from My secure knowledge to ask with */}
                  <KnowledgeButton conversationId={conversation.id} disabled={disabled} onCompanyServer={isCompany} />

                  <span className="h-4 w-px shrink-0 bg-line-soft" />

                  {/* AI model */}
                  <Menu>
                    <MenuTrigger asChild>
                      <button className="inline-flex h-7 min-w-0 max-w-64 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-soft transition-colors hover:bg-ink-6 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60" disabled={isCompany || busy || disabled} aria-label={`AI model for this conversation: ${currentLabel}`}>
                        <Cpu className="size-3.5 shrink-0" />
                        <span className="truncate">{currentLabel}</span>
                        {!isCompany && <ChevronDown className="size-3 shrink-0 text-ink-50" />}
                      </button>
                    </MenuTrigger>
                    <MenuContent align="start" className="w-80">
                      <MenuLabel>AI model for this conversation</MenuLabel>
                      <MenuRadioGroup value={conversation.model_id ?? ''} onValueChange={(v) => api.conversations.setModel(conversation.id, v)}>
                        {installed.map((m) => (
                          <MenuRadioItem key={m.id} value={m.id}>
                            <span className="flex flex-col gap-0.5">
                              <span>{modelLabel(m)}</span>
                              <span className="text-xs leading-4.5 text-ink-50">{sizeBlurb(m.tier)}</span>
                            </span>
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                      <p className="px-2 pb-1.5 pt-1 text-2xs leading-4 text-ink-50">Takes effect on your next message.</p>
                      <MenuSeparator />
                      <MenuItem onSelect={() => navigate('/models')}>See all AI models</MenuItem>
                    </MenuContent>
                  </Menu>

                  <span className="h-4 w-px shrink-0 bg-line-soft" />

                  {/* Where it runs. The choice exists only in lab builds; otherwise it is a statement. */}
                  {companyFlag ? (
                    <Menu>
                      <MenuTrigger asChild>
                        <button className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-soft transition-colors hover:bg-ink-6 hover:text-ink disabled:opacity-60" disabled={busy || disabled} aria-label={`Where this conversation runs: ${isCompany ? 'Company server' : 'This computer'}`}>
                          {isCompany ? <Building2 className="size-3.5" /> : <MonitorSmartphone className="size-3.5" />}
                          <span>{isCompany ? 'Company server' : 'This computer'}</span>
                          <ChevronDown className="size-3 text-ink-50" />
                        </button>
                      </MenuTrigger>
                      <MenuContent align="start" className="w-80">
                        <MenuLabel>Where this conversation runs</MenuLabel>
                        {isCompany ? (
                          <MenuItem icon={<MonitorSmartphone />} onSelect={() => api.conversations.setProvider(conversation.id, 'local', true)}>
                            <span className="flex flex-col">
                              <span>Move back to this computer</span>
                              <span className="text-xs text-ink-50">Never asks. Nothing is sent.</span>
                            </span>
                          </MenuItem>
                        ) : (
                          <MenuItem icon={<Building2 />} onSelect={() => setMoveOpen(true)} disabled={!company.reachable}>
                            <span className="flex flex-col">
                              <span>Move to the company server…</span>
                              <span className="text-xs text-ink-50">{company.reachable ? 'Asks first. The conversation so far is sent there.' : 'The company server cannot be reached right now.'}</span>
                            </span>
                          </MenuItem>
                        )}
                      </MenuContent>
                    </Menu>
                  ) : (
                    <Tooltip content="This conversation runs on this computer. Nothing leaves this computer unless you say so.">
                      <span className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap px-2 text-xs text-ink-50">
                        <Lock className="size-3 shrink-0" />
                        Stays on this computer
                      </span>
                    </Tooltip>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {!busy && <MicButton onClick={dictation.start} disabled={disabled} />}
                  {busy ? (
                    <Button size="sm" variant="secondary" leading={<Square className="size-3 fill-current" />} onClick={() => api.conversations.stop()}>
                      Stop
                    </Button>
                  ) : (
                    <Tooltip content={otherBusy ? 'Another conversation is still being answered' : 'Send (Enter)'}>
                      <button
                        onClick={send}
                        disabled={!canSend}
                        aria-label="Send message"
                        className="inline-flex size-8 items-center justify-center rounded-md bg-green text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(22,33,27,0.18)] transition-[background-color,color,box-shadow,transform] duration-(--duration-micro) ease-(--ease-out) hover:bg-green-deep active:translate-y-px active:bg-green-dark disabled:cursor-not-allowed disabled:bg-ink-6 disabled:text-ink-50 disabled:shadow-none disabled:active:translate-y-0"
                      >
                        <ArrowUp className="size-4" strokeWidth={2.5} />
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
            </div>
          </AutoHeight>
        </div>
        {/* One line under the box: what the keys do, or why sending is not possible right now. The line about documents is always there. */}
        <div className="mt-2 flex min-h-5 items-center justify-between gap-4 px-1 text-2xs text-ink-50">
          <span className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap sm:flex">
            {disabled ? (
              'Restore the project to carry on here.'
            ) : busy ? (
              'Answering. Stop ends it early and keeps what is written so far.'
            ) : otherBusy ? (
              'Another conversation is still being answered. You can send here when it finishes.'
            ) : (
              <>
                <Kbd>Enter</Kbd> to send
                <span className="mx-1" aria-hidden>
                  ·
                </span>
                <Kbd>Shift</Kbd>
                <Kbd>Enter</Kbd> for a new line
              </>
            )}
          </span>
          <span className="min-w-0 truncate sm:text-right">
            Add documents in{' '}
            <Link to="/knowledge" className="rounded-xs font-medium text-ink-soft underline decoration-line-strong underline-offset-2 transition-colors duration-(--duration-micro) hover:text-green hover:decoration-green">
              My secure knowledge
            </Link>
          </span>
        </div>
      </div>
      <MoveToCompanyDialog open={moveOpen} onOpenChange={setMoveOpen} conversation={conversation} />
    </div>
  )
}
