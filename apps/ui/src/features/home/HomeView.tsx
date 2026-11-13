import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, ArrowUp, ChevronRight, DatabaseBackup, FilePlus2, Lock } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import { knowledgeTotals, useExtras } from '@/lib/extras'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'
import { FILES_HINT, PROMISE, backupStatus, modelLabelById, speedWords } from '@/lib/words'
import { STARTERS, type Starter } from '@/data/stack'
import { ART, STARTER_ART, modelLogo } from '@/assets/icons'
import { ArtTile } from '@/components/ui/art'
import { Button } from '@/components/ui/button'
import { StatusDot, type DotTone } from '@/components/ui/chips'
import { Callout } from '@/components/ui/feedback'
import { PAGE_COLUMN, SectionLabel, useScrollMemory } from '@/components/ui/layout'
import { Tooltip } from '@/components/ui/overlays'
import { Vignette } from '@/components/app/Vignettes'
import { useEngineStatus } from '@/app/useEngineStatus'
import { useDictation } from '@/features/voice/useDictation'
import { AutoHeight, MicButton, VoicePanel } from '@/features/voice/VoicePanel'

function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning.'
  if (h < 18) return 'Good afternoon.'
  return 'Good evening.'
}

/**
 * Home answers three questions in order: what can I do right now (ask, or
 * start from a ready-made request), where was I (recent conversations), and
 * is everything all right (the six things in the menu, each with its live
 * state). Until the first document is in, it also invites you to add some.
 */
export function HomeView() {
  const navigate = useNavigate()
  const scrollRef = useScrollMemory<HTMLDivElement>()
  const projects = useStore((s) => s.projects)
  const conversations = useStore((s) => s.conversations)
  const lastProjectId = useStore((s) => s.ui.lastProjectId)
  const settings = useStore((s) => s.settings)
  const installed = useStore((s) => s.installedModels)
  const eventCount = useStore((s) => s.events.length)
  const lastEventAt = useStore((s) => (s.events.length ? s.events[s.events.length - 1].ts : null))
  const writerPaused = useStore((s) => s.health.writer === 'unavailable')
  const benchmark = useStore((s) => s.hardware.benchmark)
  const updateNotice = useStore((s) => s.updateNotice)
  const answering = useStore((s) => !!s.generation)
  const knowledge = useExtras((s) => s.knowledge)
  const installedSkills = useExtras((s) => s.installedSkills)
  const linked = useExtras((s) => s.linkedResources)
  const engine = useEngineStatus()
  const backup = backupStatus(settings)
  const hasModel = installed.length > 0

  const recent = useMemo(() => [...conversations].filter((c) => !c.archived).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5), [conversations])

  /** The project new work goes into: the one last used, else the first, else a new "My workspace". */
  const workProject = () => {
    const open = projects.filter((p) => !p.archived)
    return open.find((p) => p.id === lastProjectId) ?? open[0] ?? api.projects.create({ name: 'My workspace', classification: 'restricted' })
  }

  const start = (starter: Starter, withExample = false) => {
    const project = workProject()
    const conv = api.conversations.create(project.id, starter.conversationTitle)
    navigate(`/projects/${project.id}/c/${conv.id}?draft=${starter.id}${withExample ? '&example=1' : ''}`)
  }

  const speed = speedWords(benchmark)
  const totals = useMemo(() => knowledgeTotals(knowledge), [knowledge])
  const skillsOn = installedSkills.filter((x) => x.enabled).length

  /** The same six things, in the same order, as the menu: so Home teaches where everything is. */
  const parts: Array<{ id: string; name: string; icon: string; line: string; to: string; tone: DotTone; state: string }> = [
    {
      id: 'knowledge',
      name: 'My secure knowledge',
      icon: ART.knowledge,
      line: totals.ready ? `${totals.ready} ${totals.ready === 1 ? 'document' : 'documents'} your AI can use. Encrypted on this computer.` : 'No documents yet. Add the files you want your AI to know about.',
      to: '/knowledge',
      tone: totals.ready ? 'green' : 'neutral',
      state: totals.working ? 'Adding' : totals.ready ? 'Ready' : 'Empty',
    },
    hasModel
      ? { id: 'model', name: 'AI model', icon: modelLogo(modelLabelById(settings.default_model_id, installed)), line: `${modelLabelById(settings.default_model_id, installed)}. ${speed.headline === 'Not measured yet' ? engine.label : speed.line}`, to: '/models', tone: 'green', state: 'Ready' }
      : { id: 'model', name: 'AI model', icon: ART.model, line: 'None installed yet. Chat needs one.', to: '/models', tone: 'brass', state: 'Needs you' },
    { id: 'skills', name: 'Skills', icon: ART.skills, line: skillsOn ? `${skillsOn} added, on top of what comes with AIOS.` : 'Your AI has what comes with AIOS. Add more when you need them.', to: '/skills', tone: 'green', state: skillsOn ? `${skillsOn} added` : 'Built in' },
    { id: 'resources', name: 'Resources', icon: ART.resources, line: linked.length ? `${linked.length} linked. AIOS asks before anything is sent.` : 'None linked. Everything runs on this computer.', to: '/resources', tone: linked.length ? 'green' : 'neutral', state: linked.length ? `${linked.length} linked` : 'This computer' },
    { id: 'protection', name: 'Backup', icon: backup.tone === 'none' ? ART.backupMissing : ART.backup, line: `Everything is encrypted on this computer. ${backup.label}.`, to: '/settings/backup', tone: backup.tone === 'ok' ? 'green' : 'brass', state: backup.tone === 'ok' ? 'Protected' : 'Needs you' },
    writerPaused
      ? { id: 'activity', name: 'Activity', icon: ART.activity, line: 'Recording is paused. It will catch up by itself.', to: '/activity', tone: 'brass', state: 'Paused' }
      : { id: 'activity', name: 'Activity', icon: ART.activity, line: eventCount ? `${eventCount} actions recorded. Last ${lastEventAt ? relativeTime(lastEventAt) : 'just now'}.` : 'Nothing recorded yet.', to: '/activity', tone: 'green', state: 'Recording' },
  ]

  const needsAttention = backup.tone !== 'ok' || !hasModel || !!settings.update_available || !!updateNotice || writerPaused

  return (
    <div ref={scrollRef} className="scroll-stable min-h-0 flex-1 overflow-y-auto">
      <div className={cn(PAGE_COLUMN, 'flex flex-col gap-9 pb-12 pt-10')}>
        {/* Greeting */}
        <header>
          <h1 className="font-display text-[40px] leading-[1.1] text-ink">{greeting()}</h1>
          <p className="mt-2.5 flex items-center gap-2 text-md leading-6 text-ink-soft">
            <Lock className="size-3.5 shrink-0 text-green" strokeWidth={2} aria-hidden />
            {PROMISE}
          </p>
        </header>

        <div className="animate-fade flex flex-col gap-9">
          {/* What needs attention */}
          {needsAttention && (
            <section className="flex flex-col gap-2" aria-label="Needs your attention">
              {!hasModel && (
                <Callout tone="caution" title="No AI model installed" action={<Button size="sm" variant="primary" onClick={() => navigate('/models')}>Choose an AI model</Button>}>
                  Chat needs one. Your projects, search and backups work without it.
                </Callout>
              )}
              {backup.tone === 'none' && (
                <Callout tone="caution" title="Your work is not backed up" action={<Button size="sm" variant="primary" leading={<DatabaseBackup className="size-3.5" />} onClick={() => navigate('/settings/backup')}>Set up backup</Button>}>
                  If this computer fails and you have no backup, your conversations are gone. AIOS has no copy.
                </Callout>
              )}
              {backup.tone === 'due' && (
                <Callout tone="caution" title={backup.label} action={<Button size="sm" onClick={() => navigate('/settings/backup')}>Back up now</Button>}>
                  Work since then is not protected.
                </Callout>
              )}
              {updateNotice?.kind === 'failed' && (
                <Callout tone="deny" title="The update did not complete" action={<Button size="sm" variant="ghost" onClick={() => api.settings.dismissUpdateNotice()}>Dismiss</Button>}>
                  Your data was put back as it was. AIOS will try again next time it starts.
                </Callout>
              )}
              {updateNotice?.kind === 'installed' && (
                <Callout tone="success" title={`AIOS is now version ${updateNotice.version}`} action={<Button size="sm" variant="ghost" onClick={() => api.settings.dismissUpdateNotice()}>Dismiss</Button>} />
              )}
              {settings.update_available && !updateNotice && (
                <Callout tone="info" title={`AIOS ${settings.update_available.version} is ready`} action={<Button size="sm" onClick={() => navigate('/settings/general')}>See the update</Button>}>
                  It installs when you close AIOS.
                </Callout>
              )}
              {writerPaused && (
                <Callout tone="caution" title="Activity recording is paused" compact>
                  You can keep working. It will catch up by itself.
                </Callout>
              )}
            </section>
          )}

          {/* The first thing to do after setup: give the AI something of yours to work from. */}
          {totals.ready + totals.working === 0 && (
            <section aria-labelledby="home-knowledge" className="group/vg flex flex-col overflow-hidden rounded-2xl border border-green/25 bg-white shadow-card sm:flex-row">
              <div className="relative hidden w-[220px] shrink-0 border-r border-line-soft bg-[linear-gradient(180deg,#eef3ee_0%,#f8f8f4_100%)] sm:block">
                <div aria-hidden className="dot-grid absolute inset-0 opacity-70 [mask-image:radial-gradient(70%_85%_at_50%_50%,black,transparent)]" />
                <div className="absolute inset-0 flex items-center px-2">
                  <Vignette kind="knowledge" />
                </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-4 px-5 py-5 sm:px-6">
                <div className="min-w-[min(100%,18rem)] flex-1">
                  <p className="label-mono text-green">My secure knowledge</p>
                  <h2 id="home-knowledge" className="mt-1 text-lg font-semibold leading-6 text-ink">Give your AI your documents</h2>
                  <p className="mt-1 max-w-[52ch] text-sm leading-5 text-ink-soft">Add the PDFs and files you work with. AIOS keeps an encrypted copy on this computer, your originals stay where they are, and your AI can answer from them.</p>
                </div>
                <Button variant="primary" leading={<FilePlus2 className="size-4" />} onClick={() => navigate('/knowledge')} className="shrink-0">
                  Add documents
                </Button>
              </div>
            </section>
          )}

          {/* Ask, or start from a ready-made request */}
          <section className="flex flex-col gap-4" aria-label="Start something">
            <QuickAsk
              disabled={!hasModel}
              busy={answering}
              modelLabel={hasModel ? modelLabelById(settings.default_model_id, installed) : null}
              onAsk={(text) => {
                const project = workProject()
                const conv = api.conversations.create(project.id)
                const sent = api.conversations.send(conv.id, text)
                // If it could not be sent, the words go with you into the conversation's message box.
                navigate(`/projects/${project.id}/c/${conv.id}`, sent.ok ? undefined : { state: { draftText: text } })
              }}
            />

            <div>
              <SectionLabel>Or start from one of these</SectionLabel>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <li key={s.id} className="group relative flex items-start gap-3.5 rounded-xl border border-line bg-white p-4 shadow-card transition-[border-color,box-shadow,transform] duration-(--duration-panel) ease-(--ease-out) focus-within:border-green/50 hover:-translate-y-px hover:border-green/40 hover:shadow-lift">
                    <ArtTile src={STARTER_ART[s.id] ?? ART.conversation} size="lg" />
                    <span className="min-w-0 flex-1">
                      {/* The whole card starts the request; the example link sits above that click area. */}
                      <button type="button" onClick={() => start(s)} className="flex w-full items-center justify-between gap-2 rounded-sm text-left text-base font-semibold text-ink outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-green/40">
                        {s.title}
                        <ArrowRight className="size-4 shrink-0 text-ink-30 transition-[transform,color] duration-(--duration-panel) ease-(--ease-out) group-hover:translate-x-0.5 group-hover:text-green" aria-hidden />
                      </button>
                      <span className="mt-0.5 block text-sm leading-5 text-ink-soft">{s.line}</span>
                      {'example' in s && s.example ? (
                        <button type="button" onClick={() => start(s, true)} className="relative z-10 mt-2 inline-flex items-center gap-1 rounded-sm text-sm font-medium text-green underline-offset-4 hover:underline">
                          Try it with an example
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <div className="grid items-start gap-x-8 gap-y-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
            {/* Carry on */}
            <section className="flex min-w-0 flex-col gap-3" aria-labelledby="home-recent">
              <SectionLabel>
                <span id="home-recent">Carry on</span>
              </SectionLabel>
              {recent.length > 0 ? (
                <ul className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
                  {recent.map((c) => {
                    const project = projects.find((p) => p.id === c.project_id)
                    return (
                      <li key={c.id} className="border-b border-line-soft last:border-b-0">
                        <button onClick={() => navigate(`/projects/${c.project_id}/c/${c.id}`)} className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-(--duration-micro) hover:bg-paper-raised">
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <span className="truncate text-base font-medium text-ink">{c.title}</span>
                              <span className="shrink-0 font-mono text-2xs text-ink-50">{relativeTime(c.updated_at)}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-sm text-ink-50">
                              {project && <span className="text-ink-soft">{project.name}</span>}
                              {project && c.last_message_preview ? ' · ' : ''}
                              {c.last_message_preview}
                            </span>
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-ink-30 transition-[transform,color] duration-(--duration-micro) group-hover:translate-x-0.5 group-hover:text-ink-soft" aria-hidden />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <div className="rounded-xl border border-dashed border-line-strong bg-paper-raised/60 px-5 py-6">
                  <p className="text-base font-medium text-ink">Your conversations will collect here</p>
                  <p className="mt-1 max-w-[48ch] text-sm leading-5 text-ink-soft">Ask something above, or start from one of the ready-made requests. Each one opens with the words written for you, ready to edit.</p>
                </div>
              )}
            </section>

            {/* Your AIOS */}
            <section className="flex min-w-0 flex-col gap-3" aria-labelledby="home-aios">
              <SectionLabel>
                <span id="home-aios">Your AIOS</span>
              </SectionLabel>
              <div className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
                <ul>
                  {parts.map((p) => (
                    <li key={p.id} className="border-b border-line-soft last:border-b-0">
                      <button onClick={() => navigate(p.to)} className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-(--duration-micro) hover:bg-paper-raised">
                        <ArtTile src={p.icon} className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-base font-semibold text-ink">{p.name}</span>
                            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-ink-soft">
                              <StatusDot tone={p.tone} />
                              {p.state}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-sm leading-5 text-ink-soft">{p.line}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The shortest path to a first answer: type, press Enter, and the
 * conversation opens with the answer already arriving.
 */
function QuickAsk({ disabled, busy, modelLabel, onAsk }: { disabled: boolean; busy: boolean; modelLabel: string | null; onAsk: (text: string) => void }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const clean = text.trim()
  const canSend = !disabled && !busy && clean.length > 0

  const submit = () => {
    if (canSend) onAsk(clean)
  }

  // Speaking instead of typing: what was heard lands in the box, ready to check and send.
  const textNow = useRef(text)
  useEffect(() => {
    textNow.current = text
  }, [text])
  const dictation = useDictation((heard) => {
    const before = textNow.current.replace(/\s+$/, '')
    setText(before ? `${before} ${heard}` : heard)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  })
  const speaking = dictation.phase !== 'idle'

  return (
    <div>
      <div
        className={cn(
          'rounded-2xl border bg-white shadow-card transition-[border-color,box-shadow] duration-(--duration-panel) ease-(--ease-out)',
          disabled ? 'border-line' : 'border-line-strong focus-within:border-green focus-within:shadow-[0_0_0_4px_rgba(30,95,70,0.1),var(--shadow-card)]',
        )}
        onClick={() => ref.current?.focus()}
      >
        <AutoHeight className="rounded-2xl">
          {speaking && <VoicePanel dictation={dictation} className="animate-fade px-5 pt-4" />}
          <div className={speaking ? 'hidden' : undefined}>
            <label htmlFor="home-ask" className="sr-only">
              Ask your AI
            </label>
            <textarea
              id="home-ask"
              ref={ref}
              rows={2}
              value={text}
              disabled={disabled}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder={disabled ? 'Install an AI model to start asking' : 'Ask your AI anything'}
              className="block max-h-40 min-h-[64px] w-full resize-none rounded-t-2xl bg-transparent px-5 pt-4 text-md leading-6 text-ink outline-none placeholder:text-ink-50 disabled:cursor-not-allowed"
            />
            <div className="flex items-center justify-between gap-3 px-3 pb-3 pl-5">
              <p className="flex min-w-0 items-center gap-2 text-xs leading-4.5 text-ink-50">
                <Lock className="size-3 shrink-0 text-green" strokeWidth={2.25} aria-hidden />
                <span className="truncate">{modelLabel ? `Stays on this computer · ${modelLabel}` : 'Stays on this computer'}</span>
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <MicButton round onClick={dictation.start} disabled={disabled} />
                <Tooltip content={busy ? 'Another conversation is still being answered' : 'Send (Enter)'}>
                  <span>
                    <button
                      type="button"
                      aria-label="Send"
                      disabled={!canSend}
                      onClick={(e) => {
                        e.stopPropagation()
                        submit()
                      }}
                      className="flex size-9 items-center justify-center rounded-full bg-green text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(22,33,27,0.18)] transition-[background-color,transform,opacity] duration-(--duration-micro) ease-(--ease-out) hover:bg-green-deep active:scale-95 disabled:bg-ink-12 disabled:text-ink-50 disabled:shadow-none disabled:active:scale-100"
                    >
                      <ArrowUp className="size-4" strokeWidth={2.25} />
                    </button>
                  </span>
                </Tooltip>
              </div>
            </div>
          </div>
        </AutoHeight>
      </div>
      <p className="mt-2 px-1 text-xs leading-4.5 text-ink-50">{FILES_HINT}</p>
    </div>
  )
}
