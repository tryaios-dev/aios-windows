import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, MapPin, MessageSquareText, MoreHorizontal, Search, SearchX, Trash2, X } from 'lucide-react'
import { ART } from '@/assets/icons'
import { Art, ArtTile } from '@/components/ui/art'
import { cn } from '@/lib/cn'
import { knowledgeTotals } from '@/lib/extras'
import type { KnowledgeDoc } from '@/lib/types'
import { READABLE_KINDS } from '@/data/knowledge'
import { formatDateTime, pluralise, relativeTime } from '@/lib/format'
import { Button, IconButton } from '@/components/ui/button'
import { Input } from '@/components/ui/fields'
import { EmptyState } from '@/components/ui/feedback'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/overlays'
import { ProgressBar } from '@/components/app/InstallProgress'
import { Highlight } from '@/features/search/highlight'
import { DrawnCheck, Reveal } from '@/features/settings/shared'
import { FileTile } from './KnowledgeArt'
import { DROPPED, LOOSE, isFresh, isPath, isWorking, pagesWords, sizeWords, type AddingRun } from './helpers'

/** Everything, one kind of document, or the ones AIOS could not read. */
export type LibraryFilter = 'all' | 'failed' | `kind:${string}`

export interface LibraryProps {
  docs: KnowledgeDoc[]
  query: string
  onQuery: (query: string) => void
  filter: LibraryFilter
  onFilter: (filter: LibraryFilter) => void
  run: AddingRun | null
  /** Documents on their way out: their rows close before they are removed. */
  leaving: ReadonlySet<string>
  onAddFiles: () => void
  onAsk: (doc: KnowledgeDoc) => void
  onOriginal: (doc: KnowledgeDoc) => void
  /** Ask first, then remove. */
  onRemove: (doc: KnowledgeDoc) => void
  /** Remove straight away: for a document AIOS could not read, where there is nothing to lose. */
  onRemoveNow: (doc: KnowledgeDoc) => void
  onRetry: (doc: KnowledgeDoc) => void
}

interface Group {
  name: string
  all: KnowledgeDoc[]
  shown: KnowledgeDoc[]
  newest: string
  /** Where the originals are, when they all came from one place. */
  origin: string | null
}

const sum = (docs: KnowledgeDoc[]) => docs.reduce((n, d) => n + d.size_bytes, 0)

/**
 * Everything the person has added: a summary, the addition under way, a
 * search box, and the documents grouped by the folder they came in with.
 */
export function Library({ docs, query, onQuery, filter, onFilter, run, leaving, onAddFiles, onAsk, onOriginal, onRemove, onRemoveNow, onRetry }: LibraryProps) {
  const totals = useMemo(() => knowledgeTotals(docs), [docs])
  const kinds = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of docs) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [docs])

  // A filter whose documents have all gone falls back to everything.
  const active: LibraryFilter = filter === 'failed' ? (totals.failed ? filter : 'all') : kinds.some(([kind]) => `kind:${kind}` === filter) ? filter : 'all'
  const q = query.trim().toLowerCase()

  const groups = useMemo<Group[]>(() => {
    const byName = new Map<string, KnowledgeDoc[]>()
    for (const d of docs) {
      const list = byName.get(d.collection)
      if (list) list.push(d)
      else byName.set(d.collection, [d])
    }
    const matches = (d: KnowledgeDoc) => (!q || d.name.toLowerCase().includes(q)) && (active === 'all' || (active === 'failed' ? d.status === 'failed' : `kind:${d.kind}` === active))
    return [...byName.entries()]
      .map(([name, all]) => {
        const sorted = [...all].sort((a, b) => b.added_at.localeCompare(a.added_at))
        const origins = new Set(all.map((d) => d.origin))
        return { name, all, shown: sorted.filter(matches), newest: sorted[0].added_at, origin: origins.size === 1 ? all[0].origin : null }
      })
      .sort((a, b) => b.newest.localeCompare(a.newest))
  }, [docs, q, active])

  const shown = groups.reduce((n, g) => n + g.shown.length, 0)
  const narrowed = !!q || active !== 'all'
  const activeLabel = active === 'failed' ? 'documents AIOS could not read' : active.startsWith('kind:') ? `${active.slice(5)} documents` : ''

  return (
    <div className="@container flex flex-col gap-7">
      <Summary totals={totals} run={run} onAddFiles={onAddFiles} onShowFailed={() => onFilter('failed')} />

      <section aria-label="Your documents" className="flex flex-col gap-4">
        {/* Search and filter */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <div className="relative min-w-[min(100%,15rem)] flex-1 @3xl:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-50" aria-hidden />
            <Input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.stopPropagation()
                  onQuery('')
                }
              }}
              role="searchbox"
              aria-label="Search your documents by name"
              placeholder="Search by name"
              autoComplete="off"
              spellCheck={false}
              className="pl-9 pr-9"
            />
            {query && (
              <IconButton label="Clear search" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => onQuery('')}>
                <X />
              </IconButton>
            )}
          </div>

          {(kinds.length > 1 || totals.failed > 0) && (
            <div role="group" aria-label="Show" className="flex flex-wrap items-center gap-1.5">
              <FilterChip selected={active === 'all'} count={docs.length} onClick={() => onFilter('all')}>
                All
              </FilterChip>
              {kinds.length > 1 &&
                kinds.map(([kind, count]) => (
                  <FilterChip key={kind} selected={active === `kind:${kind}`} count={count} onClick={() => onFilter(`kind:${kind}`)}>
                    {kind}
                  </FilterChip>
                ))}
              {totals.failed > 0 && (
                <FilterChip selected={active === 'failed'} count={totals.failed} onClick={() => onFilter('failed')}>
                  Couldn&rsquo;t read
                </FilterChip>
              )}
            </div>
          )}

          <p className="ml-auto text-sm leading-5 tabular text-ink-50" aria-live="polite">
            {narrowed ? `${shown} of ${pluralise(docs.length, 'document')}` : pluralise(docs.length, 'document')}
          </p>
        </div>

        {shown === 0 ? (
          <div className="rounded-xl border border-line bg-white">
            <EmptyState
              compact
              icon={<SearchX />}
              title={q ? `No document has “${query.trim()}” in its name` : 'Nothing to show here'}
              description={
                q
                  ? `${activeLabel ? `Only ${activeLabel} are showing. ` : ''}Search looks at file names. To find something written inside a document, ask your AI about it.`
                  : 'No documents match what is selected.'
              }
              action={
                <>
                  {q && (
                    <Button size="sm" onClick={() => onQuery('')}>
                      Clear search
                    </Button>
                  )}
                  {active !== 'all' && (
                    <Button size="sm" variant={q ? 'ghost' : 'secondary'} onClick={() => onFilter('all')}>
                      Show all documents
                    </Button>
                  )}
                </>
              }
            />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {groups
              .filter((g) => g.shown.length)
              .map((group, i) => (
                <GroupBlock key={group.name} group={group} heads={i === 0} narrowed={narrowed} query={query} leaving={leaving} onAsk={onAsk} onOriginal={onOriginal} onRemove={onRemove} onRemoveNow={onRemoveNow} onRetry={onRetry} />
              ))}
          </div>
        )}
      </section>

      <p className="text-xs leading-4.5 text-ink-50">AIOS can read {READABLE_KINDS}. Scanned pages and pictures cannot be read in this version.</p>
    </div>
  )
}

/* ---------------- Summary, and the addition under way ---------------- */

function Summary({ totals, run, onAddFiles, onShowFailed }: { totals: ReturnType<typeof knowledgeTotals>; run: AddingRun | null; onAddFiles: () => void; onShowFailed: () => void }) {
  const headline = totals.ready ? `${pluralise(totals.ready, 'document')} ready` : totals.working ? 'Nothing ready yet' : 'No documents ready'
  // The last run stays in place while its panel closes, so the panel does not empty before it has shut.
  const [lastRun, setLastRun] = useState(run)
  if (run && run !== lastRun) setLastRun(run)
  const shownRun = run ?? lastRun
  return (
    <section aria-labelledby="knowledge-summary" className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-5 p-5 @3xl:p-6">
        <div className="flex min-w-[min(100%,17rem)] flex-1 items-start gap-4">
          <ArtTile src={ART.encrypted} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="label-mono">Your secure knowledge</div>
            <h2 id="knowledge-summary" className="mt-1 text-2xl font-semibold leading-8 tracking-[-0.01em] tabular text-ink">
              {headline}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm leading-5 tabular text-ink-soft">
              {totals.ready > 0 && (
                <>
                  <span>{sizeWords(totals.size)}</span>
                  <span aria-hidden className="text-ink-50">
                    ·
                  </span>
                </>
              )}
              <span>{totals.ready > 0 ? 'all encrypted on this computer' : 'Copies are encrypted on this computer'}</span>
              {totals.failed > 0 && (
                <>
                  <span aria-hidden className="text-ink-50">
                    ·
                  </span>
                  <button type="button" onClick={onShowFailed} className="inline-flex items-center gap-1 rounded-xs font-medium text-brass-text underline-offset-4 hover:underline">
                    <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                    {totals.failed} could not be read
                  </button>
                </>
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onAddFiles}
          className="flex min-w-[min(100%,17rem)] flex-1 items-center gap-3.5 rounded-xl border-[1.5px] border-dashed border-line-strong bg-paper-raised/70 px-4 py-3 text-left transition-colors duration-(--duration-micro) ease-(--ease-out) hover:border-green/60 hover:bg-green-wash @3xl:max-w-[22rem]"
        >
          <ArtTile src={ART.addDocument} />
          <span className="min-w-0">
            <span className="block text-sm font-medium leading-5 text-ink">Drag in more at any time</span>
            <span className="mt-0.5 block text-xs leading-4.5 text-ink-50">Drop files or a folder anywhere on this page, or click here to choose files.</span>
          </span>
        </button>
      </div>

      <Reveal open={!!run}>{shownRun && <RunProgress run={shownRun} />}</Reveal>

      <dl className="grid grid-cols-1 divide-y divide-line-soft border-t border-line-soft bg-paper-raised @2xl:grid-cols-3 @2xl:divide-x @2xl:divide-y-0">
        <Fact label="The copies">Encrypted, on this computer</Fact>
        <Fact label="Your originals">Still where they were, unchanged</Fact>
        <Fact label="Your AI uses them">Only when you ask</Fact>
      </dl>
    </section>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-5 py-3 @3xl:px-6">
      <dt className="label-mono">{label}</dt>
      <dd className="mt-1 text-sm leading-5 text-ink">{children}</dd>
    </div>
  )
}

function RunProgress({ run }: { run: AddingRun }) {
  const ok = run.total - run.failed
  const it = run.total === 1
  const title = run.again ? `Trying ${pluralise(run.total, 'document')} again` : `Adding ${pluralise(run.total, 'document')}`
  const result =
    run.failed === 0
      ? `${pluralise(run.total, 'document')} added.`
      : ok === 0
        ? `${it ? 'That document' : 'Those documents'} could not be read.`
        : `${pluralise(ok, 'document')} added. ${run.failed} could not be read.`
  const after = run.failed === 0 ? `Your AI can use ${it ? 'it' : 'them'} now.` : `The reason is shown beside ${run.failed === 1 ? 'it' : 'each one'} below.`

  return (
    <div className="border-t border-line-soft px-5 py-4 @3xl:px-6">
      <p className="sr-only" role="status">
        {run.running ? title : `${result} ${after}`}
      </p>
      {run.running ? (
        <div>
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-sm font-medium leading-5 text-ink">{title}</p>
            <p className="shrink-0 text-sm leading-5 tabular text-ink-soft">
              {run.done} of {run.total} done
            </p>
          </div>
          <ProgressBar size="sm" className="mt-2.5" value={run.percent} active label={title} valueText={`${run.done} of ${run.total} done`} />
          <p className="mt-2.5 text-xs leading-4.5 text-ink-50">AIOS copies each file, then reads the copy so your AI can use it. Your originals are not touched.</p>
        </div>
      ) : (
        <div className="flex animate-fade items-start gap-3">
          {run.failed === 0 || ok > 0 ? (
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-green text-white">
              <DrawnCheck className="size-3.5" />
            </span>
          ) : (
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-brass-text" aria-hidden />
          )}
          <p className="min-w-0 flex-1 text-sm leading-5">
            <span className="font-medium text-ink">{result}</span> <span className="text-ink-soft">{after}</span>
          </p>
          <Button size="sm" variant="ghost" className="-my-1 shrink-0" onClick={run.dismiss}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  )
}

/* ---------------- Filter ---------------- */

function FilterChip({ selected, count, onClick, children }: { selected: boolean; count: number; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-sm leading-none whitespace-nowrap transition-colors duration-(--duration-micro) ease-(--ease-out)',
        selected ? 'border-green bg-green font-medium text-white' : 'border-line bg-white text-ink-soft hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
      <span className={cn('text-xs tabular', selected ? 'text-white/80' : 'text-ink-50')}>{count}</span>
    </button>
  )
}

/* ---------------- A folder's worth of documents ---------------- */

/** Column widths shared by the headings and every row, at widths where the columns show. */
const COL = { kind: 'w-36', size: 'w-16', added: 'w-24', status: '@md:w-[7.5rem]' }

interface RowActions {
  onAsk: (doc: KnowledgeDoc) => void
  onOriginal: (doc: KnowledgeDoc) => void
  onRemove: (doc: KnowledgeDoc) => void
  onRemoveNow: (doc: KnowledgeDoc) => void
  onRetry: (doc: KnowledgeDoc) => void
}

function GroupBlock({ group, heads, narrowed, query, leaving, ...actions }: { group: Group; heads: boolean; narrowed: boolean; query: string; leaving: ReadonlySet<string> } & RowActions) {
  // A folder that has only now been added fades in; one that was here already does not.
  const [arrived] = useState(() => isFresh(group.newest))
  const loose = group.name === LOOSE
  const where = group.origin === null ? null : isPath(group.origin) ? group.origin : group.origin === DROPPED ? 'Dragged in' : null
  return (
    <section aria-label={group.name} className={cn('flex flex-col gap-2', arrived && 'animate-fade')}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1">
        <h3 className="flex min-w-0 items-center gap-2 text-base font-semibold leading-6 text-ink">
          <Art src={loose ? ART.document : ART.folder} />
          <span className="truncate">{group.name}</span>
        </h3>
        <span className="text-sm leading-5 tabular text-ink-50">{narrowed ? `${group.shown.length} of ${group.all.length}` : `${pluralise(group.all.length, 'document')} · ${sizeWords(sum(group.all))}`}</span>
        {where && (
          <span className="ml-auto min-w-0 truncate font-mono text-xs leading-5 tracking-[0.02em] text-ink-50" title={isPath(where) ? `The originals are in ${where}` : undefined}>
            {where}
          </span>
        )}
      </header>

      {heads && (
        <div aria-hidden className="hidden items-center gap-3.5 px-[17px] pt-1 @3xl:flex">
          <span className="label-mono min-w-0 flex-1 pl-12">Document</span>
          <span className={cn('label-mono shrink-0', COL.kind)}>Kind</span>
          <span className={cn('label-mono shrink-0 text-right', COL.size)}>Size</span>
          <span className={cn('label-mono shrink-0', COL.added)}>Added</span>
          <span className={cn('label-mono shrink-0', COL.status)}>Status</span>
          <span className="w-7 shrink-0" />
        </div>
      )}

      <ul className="overflow-hidden rounded-xl border border-line bg-white">
        {group.shown.map((doc) => (
          <DocRow key={doc.id} doc={doc} query={query} leaving={leaving.has(doc.id)} {...actions} />
        ))}
      </ul>
    </section>
  )
}

/* ---------------- One document ---------------- */

function DocRow({ doc, query, leaving, onAsk, onOriginal, onRemove, onRemoveNow, onRetry }: { doc: KnowledgeDoc; query: string; leaving: boolean } & RowActions) {
  // A document added a moment ago opens into the list. One that was already here is simply there.
  const [entered, setEntered] = useState(() => !isFresh(doc.added_at))
  // The tick is drawn only when this row watched the document become ready.
  const [watched] = useState(() => doc.status !== 'ready')
  // The reason stays in place while its panel closes after "Try again".
  const [problem, setProblem] = useState(doc.problem)
  if (doc.problem && doc.problem !== problem) setProblem(doc.problem)

  useEffect(() => {
    if (entered) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [entered])

  const open = entered && !leaving
  const pages = pagesWords(doc.pages)
  const kindLine = [doc.kind, pages].filter(Boolean).join(' · ')
  const added = relativeTime(doc.added_at)
  const failed = doc.status === 'failed'

  return (
    <li
      aria-hidden={leaving || undefined}
      className={cn('group/row grid transition-[grid-template-rows,opacity] duration-(--duration-panel) ease-(--ease-out)', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="border-t border-line-soft transition-colors duration-(--duration-micro) ease-(--ease-out) hover:bg-paper-raised group-first/row:border-t-0">
          <div className="flex min-h-[60px] items-center gap-3.5 px-4 py-2.5">
            <FileTile name={doc.name} kind={doc.kind} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-medium leading-5.5 text-ink" title={doc.name}>
                <Highlight text={doc.name} query={query} />
              </div>
              <div className="mt-0.5 truncate text-xs leading-4.5 tabular text-ink-50 @3xl:hidden">
                {kindLine} · {sizeWords(doc.size_bytes)} · added {added}
              </div>
            </div>
            <div className={cn('hidden shrink-0 truncate text-sm leading-5 tabular text-ink-soft @3xl:block', COL.kind)}>{kindLine}</div>
            <div className={cn('hidden shrink-0 text-right text-sm leading-5 tabular text-ink-soft @3xl:block', COL.size)}>{sizeWords(doc.size_bytes)}</div>
            <div className={cn('hidden shrink-0 truncate text-sm leading-5 tabular text-ink-50 @3xl:block', COL.added)} title={formatDateTime(doc.added_at)}>
              <span className="sr-only">Added </span>
              {added}
            </div>
            <Status doc={doc} drawn={watched} className={cn('shrink-0', COL.status)} />
            <Menu>
              <MenuTrigger asChild>
                <IconButton label={`More for ${doc.name}`} size="sm" tabIndex={leaving ? -1 : undefined}>
                  <MoreHorizontal />
                </IconButton>
              </MenuTrigger>
              <MenuContent className="min-w-60">
                <MenuItem icon={<MessageSquareText />} disabled={doc.status !== 'ready'} onSelect={() => onAsk(doc)}>
                  Ask about this document
                </MenuItem>
                <MenuItem icon={<MapPin />} onSelect={() => onOriginal(doc)}>
                  Where the original is
                </MenuItem>
                <MenuSeparator />
                <MenuItem destructive icon={<Trash2 />} onSelect={() => onRemove(doc)}>
                  Remove from my knowledge
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>

          <Reveal open={failed}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-3 pl-[64px] pr-4">
              <p className="min-w-0 flex-1 basis-72 text-sm leading-5 text-ink-soft">{problem ?? 'AIOS could not read this document.'}</p>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" onClick={() => onRetry(doc)} tabIndex={leaving ? -1 : undefined}>
                  Try again
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onRemoveNow(doc)} tabIndex={leaving ? -1 : undefined}>
                  Remove
                </Button>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </li>
  )
}

/* ---------------- Status ---------------- */

/**
 * Copying, Reading, Ready or Couldn't read. Each has its own mark as well as
 * its own word, so none of them depends on colour: one bar of two filling,
 * both bars, a tick, a warning triangle.
 */
function Status({ doc, drawn, className }: { doc: KnowledgeDoc; drawn: boolean; className?: string }) {
  const label = doc.status === 'copying' ? 'Copying' : doc.status === 'reading' ? 'Reading' : doc.status === 'ready' ? 'Ready' : 'Couldn’t read'
  return (
    <div className={cn('flex items-center gap-2 text-sm leading-5', doc.status === 'failed' ? 'font-medium text-brass-text' : isWorking(doc) ? 'text-ink' : 'text-ink-soft', className)}>
      {isWorking(doc) && (
        <span className="flex w-[18px] shrink-0 items-center gap-[3px]" aria-hidden>
          <span className={cn('h-1.5 flex-1 rounded-full bg-green', doc.status === 'copying' && 'animate-pulse')} />
          <span className={cn('h-1.5 flex-1 rounded-full', doc.status === 'reading' ? 'animate-pulse bg-green' : 'bg-ink-12')} />
        </span>
      )}
      {doc.status === 'ready' && (
        <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-green-soft text-green" aria-hidden>
          {drawn ? (
            <DrawnCheck className="size-3" />
          ) : (
            <svg viewBox="0 0 16 16" fill="none" className="size-3">
              <path d="M3.25 8.6 6.4 11.75 12.75 4.9" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      )}
      {doc.status === 'failed' && <AlertTriangle className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />}
      <span className="whitespace-nowrap @max-md:sr-only">{label}</span>
    </div>
  )
}
