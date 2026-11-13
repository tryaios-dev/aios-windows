import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Info, ListFilter, X } from 'lucide-react'
import { ACTIVITY_KINDS, describeEvent, firstQuestions, isQuestion, type ActivityKind } from '@/lib/activity'
import { pluralise } from '@/lib/format'
import { selectProject, useStore } from '@/lib/store'
import type { EvidenceEvent } from '@/lib/types'
import { Button, IconButton } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { PageBody, PageHeader } from '@/components/ui/layout'
import { ALL_PROJECTS, type ActivityRow, type ActivityViewMode } from './activityMeta'
import { ActivitySummary } from './ActivitySummary'
import { ActivityToolbar } from './ActivityToolbar'
import { ActivityList } from './ActivityList'
import { ActivityDetailSheet } from './ActivityDetailSheet'
import { ActivityExamples, examplesHiddenThisSession, hideExamplesThisSession } from './ActivityExamples'
import { formatSeq } from './verification/eventMeta'
import { useEventLookups } from './verification/useEventLookups'
import { VerificationView } from './verification/VerificationView'
import { SaveCopyDialog } from './verification/SaveCopyDialog'

interface Notice {
  text: string
  href?: string
  hrefLabel?: string
}

/**
 * Activity: what the AI did, and when.
 * Mounted on `/activity` (the whole computer) and `/projects/:projectId/activity` (that project plus
 * the events that belong to no project). Keyed by project so filters and selection reset between projects.
 */
export function ActivityView() {
  const { projectId } = useParams()
  return <Activity key={projectId ?? 'everything'} projectId={projectId} />
}

function Activity({ projectId }: { projectId: string | undefined }) {
  const inProject = projectId !== undefined
  const project = useStore(selectProject(projectId))
  const allEvents = useStore((s) => s.events)
  const projects = useStore((s) => s.projects)
  const conversations = useStore((s) => s.conversations)
  const installed = useStore((s) => s.installedModels)
  const stream = useStore((s) => s.stream)
  const checkpoints = useStore((s) => s.checkpoints)
  const paused = useStore((s) => s.health.writer === 'unavailable')
  const lookups = useEventLookups()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [view, setView] = useState<ActivityViewMode>('plain')
  const [kinds, setKinds] = useState<Set<ActivityKind>>(() => new Set())
  const [leftOnly, setLeftOnly] = useState(false)
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  /** A row the user opened by clicking; `open` false keeps it ringed and lets the panel animate out. */
  const [manual, setManual] = useState<{ seq: number; open: boolean } | null>(null)
  /** The ?seq= value whose panel or notice the user has closed, so it does not reopen on re-render. */
  const [dismissedParam, setDismissedParam] = useState<string | null>(null)
  /** The ?seq= value written by "Go to #seq". It keeps the Verification details view; any other arrival opens Plain. */
  const [ownParam, setOwnParam] = useState<string | null>(null)
  /** The "What you will see here" guide, hidden for the rest of the session once dismissed. */
  const [examplesHidden, setExamplesHidden] = useState(examplesHiddenThisSession)

  const clearFilters = () => {
    setKinds(new Set())
    setLeftOnly(false)
    setProjectFilter(ALL_PROJECTS)
  }

  /* ----- ?seq= deep link, derived during render ----- */
  const seqParam = params.get('seq')
  const [seenParam, setSeenParam] = useState(seqParam)
  if (seenParam !== seqParam) {
    // A link from elsewhere arrived while this screen was open: show it the way a first visit would.
    setSeenParam(seqParam)
    if (seqParam !== null && seqParam !== ownParam) {
      setView('plain')
      clearFilters()
      setManual(null)
      setDismissedParam(null)
      setNotice(null)
    }
  }

  /* ----- what is in view ----- */
  // On a project route: the project's events plus those that belong to no project (install, backups, restore, closing).
  const scoped = useMemo(() => (inProject ? allEvents.filter((e) => e.project_id === projectId || e.project_id === undefined) : allEvents), [allEvents, inProject, projectId])

  // Which entries start a conversation is worked out from the whole record, not from what is in view.
  const starts = useMemo(() => firstQuestions(allEvents), [allEvents])
  // A new installation has set-up entries only. Until the first question, a guide shows what will appear.
  const hasQuestions = useMemo(() => allEvents.some(isQuestion), [allEvents])

  const rows = useMemo<ActivityRow[]>(() => {
    const source = projectFilter === ALL_PROJECTS ? scoped : scoped.filter((e) => e.project_id === projectFilter)
    const l = { projects, conversations, installed, firstQuestions: starts }
    return [...source]
      .sort((a, b) => b.seq - a.seq)
      .map((event) => {
        const line = describeEvent(event, l)
        const conversation = line.kind === 'questions' && event.conversation_id ? conversations.find((c) => c.id === event.conversation_id) : undefined
        return { event, line, conversation }
      })
  }, [scoped, projectFilter, projects, conversations, installed, starts])

  const { kindCounts, leftCount } = useMemo(() => {
    const counts = Object.fromEntries(ACTIVITY_KINDS.map((k) => [k.key, 0])) as Record<ActivityKind, number>
    let left = 0
    for (const r of rows) {
      counts[r.line.kind] += 1
      if (r.line.left) left += 1
    }
    return { kindCounts: counts, leftCount: left }
  }, [rows])

  const filteredRows = useMemo(() => rows.filter((r) => (kinds.size === 0 || kinds.has(r.line.kind)) && (!leftOnly || r.line.left)), [rows, kinds, leftOnly])
  const filteredEvents = useMemo(() => filteredRows.map((r) => r.event), [filteredRows])
  const anyFilter = kinds.size > 0 || leftOnly || projectFilter !== ALL_PROJECTS

  const lastSeq = allEvents.length ? allEvents[allEvents.length - 1].seq : 0
  const latestCheckpoint = useMemo(() => (checkpoints.length ? [...checkpoints].sort((a, b) => b.seq_to - a.seq_to)[0] : null), [checkpoints])
  // Checkpoint markers only make sense against the unfiltered chain.
  const visibleCheckpoints = useMemo(() => {
    if (anyFilter || scoped.length === 0) return []
    const minSeq = scoped.reduce((min, e) => Math.min(min, e.seq), scoped[0].seq)
    return checkpoints.filter((c) => c.seq_to >= minSeq)
  }, [checkpoints, anyFilter, scoped])

  const projectOptions = useMemo(() => projects.map((p) => ({ value: p.id, label: p.name })), [projects])

  /* ----- selection ----- */
  const paramSeq = seqParam !== null ? Number(seqParam) : null
  const paramActive = seqParam !== null && dismissedParam !== seqParam
  const paramInScope = paramSeq !== null && Number.isInteger(paramSeq) && scoped.some((e) => e.seq === paramSeq)
  const paramNotice = paramActive && paramSeq !== null && !paramInScope ? describeMissing(paramSeq, allEvents, lookups.projectName, lastSeq, view === 'plain') : null

  const detailSeq = manual ? manual.seq : paramInScope ? paramSeq : null
  const detailEvent = detailSeq === null ? undefined : scoped.find((e) => e.seq === detailSeq)
  const detailRow = useMemo<ActivityRow | null>(() => (detailEvent ? { event: detailEvent, line: describeEvent(detailEvent, { projects, conversations, installed, firstQuestions: starts }) } : null), [detailEvent, projects, conversations, installed, starts])
  const sheetOpen = manual ? manual.open : paramActive && paramInScope
  const shownNotice = notice ?? paramNotice

  // Bring the linked row into view once it is on screen, in whichever depth is showing. The DOM is the external system here.
  useEffect(() => {
    if (!paramActive || !paramInScope || paramSeq === null) return
    const id = view === 'plain' ? `act-${paramSeq}` : `ev-${paramSeq}`
    const bring = () => {
      const el = document.getElementById(id)
      if (!el) return false
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
      return true
    }
    if (bring()) return
    // The other depth is still fading out; its replacement mounts a moment later.
    const timer = window.setTimeout(bring, 160)
    return () => window.clearTimeout(timer)
  }, [paramSeq, paramActive, paramInScope, view])

  const openDetail = (seq: number) => setManual({ seq, open: true })

  const closeDetail = () => {
    if (manual) setManual({ ...manual, open: false })
    else setDismissedParam(seqParam)
  }

  const dismissNotice = () => {
    if (notice) setNotice(null)
    else setDismissedParam(seqParam)
  }

  const toggleKind = (kind: ActivityKind) => {
    setKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  /** "Go to #seq" in Verification details. Routed through the query so it behaves like a link to that entry. */
  const goTo = (text: string): boolean => {
    const raw = text.trim().replace(/^#/, '')
    const n = Number(raw)
    if (!raw || !Number.isInteger(n) || n < 1) {
      setNotice({ text: 'Enter a sequence number, for example 42.' })
      return false
    }
    if (!scoped.some((e) => e.seq === n)) {
      setNotice(describeMissing(n, allEvents, lookups.projectName, lastSeq, false))
      return false
    }
    setNotice(null)
    clearFilters()
    setManual(null)
    setDismissedParam(null)
    setOwnParam(String(n))
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('seq', String(n))
        return next
      },
      { replace: true },
    )
    return true
  }

  if (inProject && !project) return null

  const hasEvents = scoped.length > 0
  // The copy can be scoped to the project in view: the route's project, or the one chosen in the Project filter.
  const saveProject = project ?? (projectFilter !== ALL_PROJECTS ? projects.find((p) => p.id === projectFilter) : undefined)
  const saveEvents = saveProject ? allEvents.filter((e) => e.project_id === saveProject.id || e.project_id === undefined) : []

  const showExamples = view === 'plain' && !hasQuestions && !examplesHidden
  const hideExamples = () => {
    hideExamplesThisSession()
    setExamplesHidden(true)
  }

  // What the filters are hiding, in words, for the line above the list and for the empty state.
  const hiddenCount = scoped.length - filteredRows.length
  const hiddenWords = `${pluralise(hiddenCount, 'other entry', 'other entries')} ${hiddenCount === 1 ? 'is' : 'are'} hidden`
  const chosenKinds = ACTIVITY_KINDS.filter((k) => kinds.has(k.key)).map((k) => `\u201c${k.label}\u201d`)
  const chosenProject = projectFilter !== ALL_PROJECTS ? projects.find((p) => p.id === projectFilter)?.name : undefined
  const showingOnly = [chosenKinds.length ? joinWords(chosenKinds) : 'entries', chosenProject ? `in \u201c${chosenProject}\u201d` : '', leftOnly ? 'that left this computer' : ''].filter(Boolean).join(' ')

  const filteredEmpty =
    leftOnly && leftCount === 0 ? (
      <EmptyPanel
        title="Nothing has left this computer"
        description={`This filter shows only entries where something was sent outside this computer. There are none. ${capitalise(hiddenWords)} while it is on.`}
        clearLabel="Show all activity"
        onClear={clearFilters}
      />
    ) : (
      <EmptyPanel title="No entries match these filters" description={`You are showing only ${showingOnly}. ${capitalise(hiddenWords)}.`} clearLabel="Clear filters" onClear={clearFilters} />
    )

  const body = (
    <div className="flex flex-col gap-5">
      <ActivitySummary
        rows={rows}
        lastSealedAt={latestCheckpoint?.created_at ?? null}
        paused={paused}
        onShowLeft={() => {
          setView('plain')
          setLeftOnly(true)
        }}
      />

      {showExamples && <ActivityExamples onHide={hideExamples} />}

      {hasEvents ? (
        <>
          {showExamples && <h2 className="label-mono mt-2">Recorded on this computer so far</h2>}
          <ActivityToolbar
            kinds={kinds}
            kindCounts={kindCounts}
            onToggleKind={toggleKind}
            leftOnly={leftOnly}
            leftCount={leftCount}
            onToggleLeft={() => setLeftOnly((v) => !v)}
            projectOptions={inProject ? undefined : projectOptions}
            projectFilter={projectFilter}
            onProjectFilter={setProjectFilter}
            anyFilter={anyFilter}
            onClear={clearFilters}
            onAllKinds={() => {
              setKinds(new Set())
              setLeftOnly(false)
            }}
            view={view}
            onView={setView}
          />

          {shownNotice && (
            <div role="status" className="flex animate-fade items-center gap-2.5 rounded-md border border-line bg-paper-raised py-1 pr-1 pl-3 text-sm text-ink-soft">
              <Info className="size-3.5 shrink-0 text-ink-50" aria-hidden />
              <span className="min-w-0 flex-1 py-1 leading-5">{shownNotice.text}</span>
              {shownNotice.href && (
                <Button variant="link" size="sm" className="shrink-0" onClick={() => navigate(shownNotice.href!)}>
                  {shownNotice.hrefLabel ?? 'Open'}
                </Button>
              )}
              <IconButton label="Dismiss" size="sm" onClick={dismissNotice}>
                <X />
              </IconButton>
            </div>
          )}

          {view === 'plain' && anyFilter && filteredRows.length > 0 && (
            <p role="status" className="-mb-1 text-xs text-ink-50">
              Showing {filteredRows.length} of {pluralise(scoped.length, 'entry', 'entries')}. {capitalise(hiddenWords)} by your filters.
            </p>
          )}

          {/* Changing depth is an action on this page: the two views cross-fade, and nothing moves. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.16 }}>
              {view === 'plain' ? (
                filteredRows.length > 0 ? (
                  <ActivityList rows={filteredRows} highlightSeq={detailSeq} onSelect={(row) => openDetail(row.event.seq)} />
                ) : (
                  filteredEmpty
                )
              ) : (
                <VerificationView
                  events={filteredEvents}
                  scopeCount={scoped.length}
                  totalCount={allEvents.length}
                  inProject={inProject}
                  filtered={anyFilter}
                  checkpoints={visibleCheckpoints}
                  latestCheckpoint={latestCheckpoint}
                  stream={stream}
                  lookups={lookups}
                  highlightSeq={detailSeq}
                  onSelect={(event) => openDetail(event.seq)}
                  onGoTo={goTo}
                  onGoToInput={() => notice && setNotice(null)}
                  onSave={() => setSaveOpen(true)}
                  empty={filteredEmpty}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </>
      ) : (
        <section className="flex flex-col items-center rounded-lg border border-line bg-white px-6 py-20 text-center shadow-card" aria-labelledby="activity-empty-title">
          <h2 id="activity-empty-title" className="font-display text-3xl text-ink">
            Nothing recorded yet
          </h2>
          <p className="mt-4 max-w-md text-base leading-6 text-ink-soft">Your first question, document, backup or new project will appear here.</p>
        </section>
      )}
    </div>
  )

  const overlays = (
    <>
      <ActivityDetailSheet row={detailRow} open={sheetOpen && detailRow !== null} onOpenChange={(o) => !o && closeDetail()} lookups={lookups} installed={installed} expert={view === 'verify'} />
      <SaveCopyDialog open={saveOpen} onOpenChange={setSaveOpen} project={saveProject} projectEvents={saveEvents} />
    </>
  )

  if (inProject) {
    // Under the project header: no page header of its own, and it scrolls inside the tab.
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-paper">
        <div className="scroll-stable min-h-0 flex-1 overflow-y-auto">
          {/* Inside a project, content starts at the project name's left edge. */}
          <div className="animate-fade w-full max-w-[1040px] px-5 py-6">{body}</div>
        </div>
        {overlays}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Activity" description="What the AI did, and when. Your conversations are never stored here; each entry is a sealed record that something happened." />
      <PageBody>{body}</PageBody>
      {overlays}
    </div>
  )
}

function EmptyPanel({ title, description, clearLabel, onClear }: { title: string; description: string; clearLabel: string; onClear: () => void }) {
  return (
    <div className="rounded-lg border border-line bg-white shadow-card">
      <EmptyState
        icon={<ListFilter />}
        title={title}
        description={description}
        action={
          <Button size="sm" onClick={onClear}>
            {clearLabel}
          </Button>
        }
      />
    </div>
  )
}

/** "A", "A and B", "A, B and C". */
function joinWords(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Explains why a linked entry is not in view. Plain words in the Plain view;
 * sequence numbers when the request came from "Go to #seq" in Verification details.
 */
function describeMissing(n: number, allEvents: EvidenceEvent[], projectName: (id: string) => string | undefined, lastSeq: number, plain: boolean): Notice {
  const elsewhere = Number.isInteger(n) && n >= 1 ? allEvents.find((e) => e.seq === n) : undefined
  if (!elsewhere) {
    if (plain) return { text: 'That entry is not in the activity record.' }
    return { text: lastSeq ? `No event ${formatSeq(n)} in this stream. The latest is ${formatSeq(lastSeq)}.` : `No event ${formatSeq(n)} in this stream yet.` }
  }
  // Recorded, but for another project: only reachable on a project route.
  const name = elsewhere.project_id ? projectName(elsewhere.project_id) : undefined
  if (elsewhere.project_id && name) {
    return { text: plain ? `That entry belongs to another project, “${name}”.` : `${formatSeq(n)} belongs to "${name}".`, href: `/projects/${elsewhere.project_id}/activity?seq=${n}`, hrefLabel: 'Open there' }
  }
  return {
    text: plain ? 'That entry belongs to a project that is no longer on this computer.' : `${formatSeq(n)} belongs to a project that has been removed from this computer.`,
    href: `/activity?seq=${n}`,
    hrefLabel: 'Open in Activity',
  }
}
