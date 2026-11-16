import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Archive, ArrowUpRight, LibraryBig, ListFilter, MessageSquare, Search, SearchX, X } from 'lucide-react'
import { useExtras } from '@/lib/extras'
import { useStore } from '@/lib/store'
import type { Conversation, KnowledgeDoc, MessageRole, Project, SearchHit } from '@/lib/types'
import { cn } from '@/lib/cn'
import { formatDateTime, pluralise, relativeTime } from '@/lib/format'
import { KEYS } from '@/lib/words'
import { Button, IconButton } from '@/components/ui/button'
import { Badge, ClassChip } from '@/components/ui/chips'
import { Input, Label, Select, Switch } from '@/components/ui/fields'
import { EmptyState, Spinner } from '@/components/ui/feedback'
import { Kbd, PageBody, PageHeader, SectionLabel } from '@/components/ui/layout'
import { Tooltip } from '@/components/ui/overlays'
import { IconTile } from '@/features/settings/shared'
import { useExampleSearches } from './examples'
import { useMessageSearch } from './useMessageSearch'
import { Highlight, RoleLabel } from './highlight'
import { DocIcon } from './DocIcon'
import { DOC_STATUS, docFacts, matchDocuments } from './knowledgeDocs'
import { useDebounced } from './useDebounced'

const MIN_QUERY = 2
/** The store caps results at this many hits (most recent first). */
const HIT_CAP = 60
const NO_DOCS: KnowledgeDoc[] = []

type TypeFilter = 'all' | MessageRole | 'documents'

interface ConversationGroup {
  conversation?: Conversation
  conversationId: string
  hits: SearchHit[]
}

interface ProjectGroup {
  project?: Project
  projectId: string
  count: number
  conversations: ConversationGroup[]
}

/**
 * /search?q= searches across every conversation, grouped by project and conversation,
 * and finds documents in My secure knowledge by name, in a group of their own.
 */
export function SearchView() {
  const [params, setParams] = useSearchParams()
  const urlQuery = params.get('q') ?? ''
  const navigate = useNavigate()

  // The input owns the text; the URL follows it (replace) and feeds it back when changed from elsewhere.
  const [draft, setDraft] = useState(urlQuery)
  const lastWritten = useRef(urlQuery)
  useEffect(() => {
    if (urlQuery !== lastWritten.current) {
      lastWritten.current = urlQuery
      setDraft(urlQuery)
    }
  }, [urlQuery])

  const setQuery = (value: string) => {
    setDraft(value)
    lastWritten.current = value
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set('q', value)
        else next.delete('q')
        return next
      },
      { replace: true },
    )
  }

  const debounced = useDebounced(draft.trim(), 120)
  const pending = draft.trim() !== debounced

  const [projectFilter, setProjectFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [includeArchived, setIncludeArchived] = useState(true)

  /* ---------------- data ---------------- */

  const projects = useStore((s) => s.projects)
  const conversations = useStore((s) => s.conversations)
  const messages = useStore((s) => s.messages)
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const conversationById = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations])

  // `messages` keeps results current while the store changes underneath.
  const hits: SearchHit[] = useMessageSearch(debounced.length >= MIN_QUERY ? debounced : null, messages)

  // Documents are found by name. The whole list is selected, then narrowed here.
  const knowledge = useExtras((s) => s.knowledge)
  const docHits = useMemo(() => matchDocuments(knowledge, debounced, MIN_QUERY), [knowledge, debounced])
  // A document belongs to no project and is neither a message nor an answer, so those filters set documents aside.
  const docsShown = (typeFilter === 'all' || typeFilter === 'documents') && projectFilter === 'all' ? docHits : NO_DOCS

  const filtered = useMemo(
    () =>
      hits.filter((h) => {
        if (typeFilter === 'documents') return false
        if (projectFilter !== 'all' && h.project_id !== projectFilter) return false
        if (typeFilter !== 'all' && h.role !== typeFilter) return false
        if (!includeArchived && (conversationById.get(h.conversation_id)?.archived || projectById.get(h.project_id)?.archived)) return false
        return true
      }),
    [hits, projectFilter, typeFilter, includeArchived, conversationById, projectById],
  )

  const groups = useMemo<ProjectGroup[]>(() => {
    const byProject = new Map<string, ProjectGroup>()
    for (const h of filtered) {
      let pg = byProject.get(h.project_id)
      if (!pg) {
        pg = { project: projectById.get(h.project_id), projectId: h.project_id, count: 0, conversations: [] }
        byProject.set(h.project_id, pg)
      }
      pg.count++
      let cg = pg.conversations.find((c) => c.conversationId === h.conversation_id)
      if (!cg) {
        cg = { conversation: conversationById.get(h.conversation_id), conversationId: h.conversation_id, hits: [] }
        pg.conversations.push(cg)
      }
      cg.hits.push(h)
    }
    return [...byProject.values()]
  }, [filtered, projectById, conversationById])

  const conversationCount = useMemo(() => groups.reduce((n, g) => n + g.conversations.length, 0), [groups])
  const found = hits.length + docHits.length
  const shown = filtered.length + docsShown.length
  const hidden = found - shown
  const filtersActive = projectFilter !== 'all' || typeFilter !== 'all' || !includeArchived

  const clearFilters = () => {
    setProjectFilter('all')
    setTypeFilter('all')
    setIncludeArchived(true)
  }

  const examples = useExampleSearches()
  const runExample = (example: string) => {
    setQuery(example)
    document.getElementById('search-query')?.focus()
  }

  const projectOptions = useMemo(
    () => [{ value: 'all', label: 'All projects' }, ...projects.map((p) => ({ value: p.id, label: p.archived ? `${p.name} (archived)` : p.name }))],
    [projects],
  )

  /* ---------------- render ---------------- */

  let body: React.ReactNode
  if (!debounced) {
    body = (
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <IconTile size="lg" tone="neutral">
          <Search strokeWidth={1.75} />
        </IconTile>
        <h2 className="mt-5 font-display text-3xl text-ink">Search your conversations and documents</h2>
        <p className="mt-2 max-w-md text-base leading-[1.375rem] text-ink-soft">Type a word or a phrase you remember. Each result opens the conversation at that exact message. Documents in My secure knowledge are found by name.</p>

        {examples.length > 0 && (
          <div className="mt-7 flex flex-col items-center gap-2.5">
            <div className="label-mono">For example</div>
            <ul className="flex flex-wrap items-center justify-center gap-2" aria-label="Example searches">
              {examples.map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    onClick={() => runExample(example)}
                    aria-label={`Search for ${example}`}
                    className="group inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-white pl-3 pr-3.5 text-sm text-ink shadow-[0_1px_1px_rgba(22,33,27,0.04)] transition-[border-color,background-color,box-shadow,transform] duration-(--duration-micro) ease-(--ease-out) hover:-translate-y-px hover:border-green/50 hover:shadow-lift active:translate-y-0"
                  >
                    <Search className="size-3.5 text-ink-50 transition-colors duration-(--duration-micro) group-hover:text-green" strokeWidth={1.75} aria-hidden />
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-8 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs leading-4.5 text-ink-50">
          Press <Kbd>{KEYS.search}</Kbd> to search from anywhere in AIOS.
        </p>
      </div>
    )
  } else if (debounced.length < MIN_QUERY) {
    body = <EmptyState compact title="Keep typing" description={`Search needs at least ${MIN_QUERY} characters.`} />
  } else if (found === 0 && !pending) {
    body = (
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <IconTile size="lg" tone="neutral">
          <SearchX strokeWidth={1.75} />
        </IconTile>
        <h2 className="mt-5 max-w-lg break-words text-lg font-semibold leading-6 text-ink">Nothing matches "{debounced}".</h2>
        <ul className="mt-3 flex max-w-sm flex-col gap-1.5 text-left text-sm leading-5 text-ink-soft">
          <Tip>Search looks for the exact phrase, so fewer words find more.</Tip>
          <Tip>Check the spelling, or try one word you are sure was used.</Tip>
          <Tip>Search reads what was said in conversations, not their titles.</Tip>
          <Tip>Documents in My secure knowledge are found by their name, not by what is inside them.</Tip>
        </ul>
        <div className="mt-6">
          <Button onClick={() => setQuery('')}>Clear search</Button>
        </div>
      </div>
    )
  } else if (shown === 0 && !pending) {
    body = (
      <EmptyState
        compact
        icon={<ListFilter strokeWidth={1.75} />}
        title="No matches with these filters"
        description={`${pluralise(found, 'match', 'matches')} ${found === 1 ? 'is' : 'are'} hidden by the filters above.`}
        action={<Button size="sm" onClick={clearFilters}>Clear filters</Button>}
      />
    )
  } else {
    body = (
      <div className="flex flex-col gap-7">
        <div className="flex min-h-7 items-center justify-between gap-3 px-1">
          <p className="label-mono tabular" aria-live="polite">
            {[filtered.length > 0 ? `${pluralise(filtered.length, 'match', 'matches')} in ${pluralise(conversationCount, 'conversation')}` : '', docsShown.length > 0 ? pluralise(docsShown.length, 'document') : ''].filter(Boolean).join(' · ')}
            {hidden > 0 && <span className="text-ink-50"> · {hidden} hidden by filters</span>}
          </p>
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>

        {docsShown.length > 0 && <KnowledgeBlock docs={docsShown} query={debounced} onOpen={() => navigate('/knowledge')} />}

        {groups.map((g) => (
          <section key={g.projectId} className="animate-fade" aria-labelledby={`search-project-${g.projectId}`}>
            <SectionLabel className="px-1" right={pluralise(g.count, 'match', 'matches')}>
              <span id={`search-project-${g.projectId}`} className="flex items-center gap-2">
                <span className="truncate">{g.project?.name ?? 'Project removed'}</span>
                {g.project && <ClassChip value={g.project.classification} size="xs" className="font-sans normal-case tracking-normal" />}
                {g.project?.archived && <span className="text-ink-50">archived</span>}
              </span>
            </SectionLabel>

            <div className="mt-2.5 flex flex-col gap-3">
              {g.conversations.map((cg) => (
                <ConversationBlock key={cg.conversationId} group={cg} query={debounced} onOpenConversation={() => navigate(`/projects/${g.projectId}/c/${cg.conversationId}`)} onOpenHit={(h) => navigate(`/projects/${h.project_id}/c/${h.conversation_id}?m=${h.message_id}`)} />
              ))}
            </div>
          </section>
        ))}

        {hits.length >= HIT_CAP && (
          <p className="px-1 text-xs leading-4.5 text-ink-50">Showing the {HIT_CAP} most recent matches. Add a word to narrow the search.</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Search" description="Search everything you have asked, every answer, and the names of the documents in My secure knowledge. Searching happens on this computer.">
        <div className="flex flex-col gap-3 pb-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-50" strokeWidth={1.75} aria-hidden />
            <Input
              id="search-query"
              type="text"
              autoFocus
              value={draft}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && draft) {
                  e.preventDefault()
                  setQuery('')
                }
              }}
              placeholder="Search messages and document names"
              aria-label="Search messages and document names"
              autoComplete="off"
              spellCheck={false}
              className="h-11 pl-10 pr-20 text-md shadow-[0_1px_2px_rgba(22,33,27,0.04)]"
            />
            <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
              {pending && draft.trim().length >= MIN_QUERY && <Spinner className="size-3.5" label="Searching" />}
              {draft && (
                <Tooltip content="Clear search">
                  <IconButton label="Clear search" size="sm" onClick={() => setQuery('')}>
                    <X />
                  </IconButton>
                </Tooltip>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select size="sm" className="w-56" aria-label="Project" value={projectFilter} onValueChange={setProjectFilter} options={projectOptions} />
            <Select
              size="sm"
              className="w-40"
              aria-label="Type"
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(v as TypeFilter)}
              options={[
                { value: 'all', label: 'Everything' },
                { value: 'user', label: 'Your messages' },
                { value: 'assistant', label: 'Answers' },
                { value: 'documents', label: 'Documents' },
              ]}
            />
            <div className="ml-auto flex items-center gap-2">
              <Switch id="search-include-archived" checked={includeArchived} onCheckedChange={setIncludeArchived} />
              <Label htmlFor="search-include-archived" className="cursor-pointer text-sm font-normal text-ink-soft">
                Include archived
              </Label>
            </div>
          </div>
        </div>
      </PageHeader>
      <PageBody>{body}</PageBody>
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-30" aria-hidden />
      <span>{children}</span>
    </li>
  )
}

/** Documents whose name matches, in their own group. Any of them opens My secure knowledge. */
function KnowledgeBlock({ docs, query, onOpen }: { docs: KnowledgeDoc[]; query: string; onOpen: () => void }) {
  return (
    <section className="animate-fade" aria-labelledby="search-knowledge">
      <SectionLabel className="px-1" right={pluralise(docs.length, 'document')}>
        <span id="search-knowledge" className="flex items-center gap-2">
          <LibraryBig className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="truncate">In my secure knowledge</span>
        </span>
      </SectionLabel>
      <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-white shadow-card">
        <ul className="divide-y divide-line-soft">
          {docs.map((doc) => {
            const status = DOC_STATUS[doc.status]
            return (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={onOpen}
                  className="group flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors duration-(--duration-micro) ease-(--ease-out) hover:bg-paper"
                  aria-label={`Open ${doc.name} in My secure knowledge. ${status.label}.`}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line-soft bg-paper-raised text-ink-soft" aria-hidden>
                    <DocIcon kind={doc.kind} className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium leading-5 text-ink">
                      <Highlight text={doc.name} query={query} />
                    </span>
                    <span className="truncate text-xs leading-4.5 text-ink-50">{docFacts(doc)}</span>
                  </span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <span className="hidden w-20 shrink-0 whitespace-nowrap text-right font-mono text-2xs tabular text-ink-50 sm:block" title={`Added ${formatDateTime(doc.added_at)}`}>
                    {relativeTime(doc.added_at)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-green opacity-0 transition-opacity duration-(--duration-micro) group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden>
                    Open
                    <ArrowUpRight className="size-3.5 shrink-0" />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

function ConversationBlock({ group, query, onOpenConversation, onOpenHit }: { group: ConversationGroup; query: string; onOpenConversation: () => void; onOpenHit: (h: SearchHit) => void }) {
  const c = group.conversation
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
      <button
        type="button"
        onClick={onOpenConversation}
        className="group flex min-h-10 w-full items-center gap-2.5 bg-paper-raised px-4 py-2 text-left transition-colors duration-(--duration-micro) ease-(--ease-out) hover:bg-paper-deep"
        aria-label={`Open conversation ${c?.title ?? ''}`.trim()}
      >
        <MessageSquare className="size-4 shrink-0 text-ink-50" strokeWidth={1.75} aria-hidden />
        <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', c?.archived ? 'text-ink-soft' : 'text-ink')}>{c?.title ?? 'Conversation removed'}</span>
        {c?.archived && (
          <Badge tone="neutral" icon={<Archive />}>
            Archived
          </Badge>
        )}
        <span className="font-mono text-2xs tabular text-ink-50">{pluralise(group.hits.length, 'match', 'matches')}</span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-green opacity-0 transition-opacity duration-(--duration-micro) group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden>
          Open
          <ArrowUpRight className="size-3.5 shrink-0" />
        </span>
      </button>
      <ul className="divide-y divide-line-soft border-t border-line-soft">
        {group.hits.map((h) => (
          <li key={h.message_id}>
            <button
              type="button"
              onClick={() => onOpenHit(h)}
              className="group flex w-full items-start gap-3.5 px-4 py-3 text-left transition-colors duration-(--duration-micro) ease-(--ease-out) hover:bg-paper"
              aria-label={`Open ${h.role === 'user' ? 'your message' : 'the answer'} from ${formatDateTime(h.created_at)}`}
            >
              <RoleLabel role={h.role} className="mt-0.5 w-14 justify-center" />
              <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-5 text-ink-soft transition-colors duration-(--duration-micro) group-hover:text-ink">
                <Highlight text={h.snippet} query={query} />
              </span>
              <time dateTime={h.created_at} title={formatDateTime(h.created_at)} className="mt-0.5 w-20 shrink-0 whitespace-nowrap text-right font-mono text-2xs tabular text-ink-50">
                {relativeTime(h.created_at)}
              </time>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
