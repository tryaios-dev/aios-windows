import { useEffect, useMemo, useRef, useState } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router'
import { Dialog as RDialog } from 'radix-ui'
import { ArrowRight, CornerDownLeft, Cpu, House, LibraryBig, MessageSquare, MessageSquarePlus, Puzzle, ScrollText, Search, Settings2, Zap } from 'lucide-react'
import { api } from '@/lib/api'
import { useExtras } from '@/lib/extras'
import { useStore, useStoreShallow } from '@/lib/store'
import type { Conversation, KnowledgeDoc, Project, SearchHit } from '@/lib/types'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'
import { ClassChip } from '@/components/ui/chips'
import { Input } from '@/components/ui/fields'
import { Spinner } from '@/components/ui/feedback'
import { Kbd } from '@/components/ui/layout'
import { useExampleSearches } from './examples'
import { useMessageSearch } from './useMessageSearch'
import { Highlight, RoleLabel } from './highlight'
import { DocIcon } from './DocIcon'
import { DOC_STATUS, docFacts, matchDocuments } from './knowledgeDocs'
import { useDebounced } from './useDebounced'

const MAX_CONVERSATIONS = 5
const MAX_MESSAGES = 8
const MAX_DOCUMENTS = 5
const EMPTY: Conversation[] = []

type Item =
  | { kind: 'conversation'; id: string; conversation: Conversation; project?: Project }
  | { kind: 'message'; id: string; hit: SearchHit; conversation?: Conversation; project?: Project }
  | { kind: 'document'; id: string; doc: KnowledgeDoc }
  | { kind: 'action'; id: string; label: string; detail?: string; icon: React.ReactNode }
  | { kind: 'example'; id: string; query: string }

const optionId = (id: string) => `command-option-${id}`

/** Opens with Ctrl K (KEYS.search): search conversations and messages across every project, documents in My secure knowledge by name, plus a few places to go. */
export function CommandPalette() {
  const open = useStore((s) => s.ui.commandOpen)
  const setOpen = useStore((s) => s.setCommandOpen)
  const navigate = useNavigate()
  const location = useLocation()

  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const debounced = useDebounced(query, 120)
  const needle = debounced.trim()
  const pending = query.trim() !== needle
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fresh palette each time it opens.
  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
    }
  }, [open])

  /* ---------------- data ---------------- */

  const projects = useStore((s) => s.projects)
  const allConversations = useStore((s) => s.conversations)
  // Subscribe to messages only while open, so a streaming answer never re-renders a closed palette.
  const messages = useStore((s) => (s.ui.commandOpen ? s.messages : null))

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const conversationById = useMemo(() => new Map(allConversations.map((c) => [c.id, c])), [allConversations])

  const conversations = useStoreShallow((s) => {
    const q = needle.toLowerCase()
    if (!q) return EMPTY
    return s.conversations
      .filter((c) => c.title.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.title.toLowerCase().startsWith(q) ? 0 : 1
        const bStarts = b.title.toLowerCase().startsWith(q) ? 0 : 1
        return aStarts - bStarts || b.updated_at.localeCompare(a.updated_at)
      })
      .slice(0, MAX_CONVERSATIONS)
  })

  // `messages` re-runs the search so results follow the store while the palette is open.
  const found = useMessageSearch(open && needle.length >= 2 ? needle : null, messages)
  const hits = useMemo<SearchHit[]>(() => found.slice(0, MAX_MESSAGES), [found])

  // Documents are found by name. The stored list is selected as it is, then narrowed here.
  const knowledge = useExtras((s) => s.knowledge)
  const documents = useMemo(() => (open ? matchDocuments(knowledge, needle).slice(0, MAX_DOCUMENTS) : []), [open, knowledge, needle])

  const projectMatch = matchPath('/projects/:projectId/*', location.pathname) ?? matchPath('/projects/:projectId', location.pathname)
  const currentProject = projectMatch?.params.projectId ? projectById.get(projectMatch.params.projectId) : undefined

  const actions = useMemo<Item[]>(() => {
    const list: Item[] = []
    if (currentProject && !currentProject.archived) {
      list.push({ kind: 'action', id: 'new-conversation', label: `New conversation in ${currentProject.name}`, icon: <MessageSquarePlus /> })
    }
    list.push({ kind: 'action', id: 'open-models', label: 'Open AI models', icon: <Cpu /> })
    list.push({ kind: 'action', id: 'open-knowledge', label: 'Open My secure knowledge', icon: <LibraryBig /> })
    list.push({ kind: 'action', id: 'open-skills', label: 'Add skills to my AI', icon: <Puzzle /> })
    list.push({ kind: 'action', id: 'open-resources', label: 'Add resources to my AI', icon: <Zap /> })
    list.push({ kind: 'action', id: 'open-settings', label: 'Open Settings', icon: <Settings2 /> })
    list.push({ kind: 'action', id: 'open-activity', label: 'Open Activity', icon: <ScrollText /> })
    list.push({ kind: 'action', id: 'go-home', label: 'Go to Home', icon: <House /> })
    const q = needle.toLowerCase()
    const filtered = q ? list.filter((a) => a.kind === 'action' && a.label.toLowerCase().includes(q)) : list
    if (needle) filtered.push({ kind: 'action', id: 'search-everything', label: `Search everything for "${needle}"`, detail: 'All results, with filters', icon: <ArrowRight /> })
    return filtered
  }, [currentProject, needle])

  const conversationItems = useMemo<Item[]>(
    () => conversations.map((c) => ({ kind: 'conversation', id: `c-${c.id}`, conversation: c, project: projectById.get(c.project_id) })),
    [conversations, projectById],
  )
  const messageItems = useMemo<Item[]>(
    () => hits.map((h) => ({ kind: 'message', id: `m-${h.message_id}`, hit: h, conversation: conversationById.get(h.conversation_id), project: projectById.get(h.project_id) })),
    [hits, conversationById, projectById],
  )

  const documentItems = useMemo<Item[]>(() => documents.map((d) => ({ kind: 'document', id: `d-${d.id}`, doc: d })), [documents])

  // Before anything is typed: a few searches a person might run. Choosing one types it for them.
  const examples = useExampleSearches(open)
  const exampleItems = useMemo<Item[]>(() => (query.trim() ? [] : examples.map((q) => ({ kind: 'example', id: `e-${q}`, query: q }))), [examples, query])

  const flat = useMemo(() => [...exampleItems, ...conversationItems, ...documentItems, ...messageItems, ...actions], [exampleItems, conversationItems, documentItems, messageItems, actions])
  const active = flat.length ? Math.min(index, flat.length - 1) : -1

  useEffect(() => {
    setIndex(0)
  }, [needle])

  useEffect(() => {
    if (active < 0) return
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  /* ---------------- actions ---------------- */

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  const activate = (item: Item | undefined) => {
    if (!item) return
    if (item.kind === 'example') {
      setQuery(item.query)
      setIndex(0)
      inputRef.current?.focus()
    } else if (item.kind === 'conversation') {
      go(`/projects/${item.conversation.project_id}/c/${item.conversation.id}`)
    } else if (item.kind === 'message') {
      go(`/projects/${item.hit.project_id}/c/${item.hit.conversation_id}?m=${item.hit.message_id}`)
    } else if (item.kind === 'document') {
      go('/knowledge')
    } else if (item.id === 'new-conversation' && currentProject) {
      void api.conversations.create(currentProject.id).then((conv) => conv && go(`/projects/${currentProject.id}/c/${conv.id}`))
    } else if (item.id === 'open-models') {
      go('/models')
    } else if (item.id === 'open-knowledge') {
      go('/knowledge')
    } else if (item.id === 'open-skills') {
      go('/skills')
    } else if (item.id === 'open-resources') {
      go('/resources')
    } else if (item.id === 'open-settings') {
      go('/settings/general')
    } else if (item.id === 'open-activity') {
      go('/activity')
    } else if (item.id === 'go-home') {
      go('/')
    } else if (item.id === 'search-everything') {
      go(`/search?q=${encodeURIComponent(needle)}`)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (flat.length) setIndex((i) => (i + 1) % flat.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (flat.length) setIndex((i) => (i - 1 + flat.length) % flat.length)
    } else if (e.key === 'Home' && flat.length) {
      e.preventDefault()
      setIndex(0)
    } else if (e.key === 'End' && flat.length) {
      e.preventDefault()
      setIndex(flat.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(flat[active])
    }
  }

  /* ---------------- render ---------------- */

  const noResults = needle.length > 0 && conversationItems.length === 0 && documentItems.length === 0 && messageItems.length === 0 && !pending
  let cursor = 0
  const renderGroup = (label: string, items: Item[]) => {
    if (items.length === 0) return null
    return (
      <div role="group" aria-labelledby={`command-group-${label.replace(/\s+/g, '-')}`} className="pb-1">
        <div id={`command-group-${label.replace(/\s+/g, '-')}`} className="label-mono px-2.5 pb-1.5 pt-2.5">
          {label}
        </div>
        {items.map((item) => {
          const i = cursor++
          return <Row key={item.id} item={item} index={i} highlighted={i === active} query={needle} onHover={() => setIndex(i)} onSelect={() => activate(item)} />
        })}
      </div>
    )
  }

  return (
    <RDialog.Root open={open} onOpenChange={setOpen}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-ink/35 backdrop-blur-[2px] data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out" />
        <RDialog.Content
          className="fixed inset-x-0 top-[15vh] z-50 mx-auto flex w-[calc(100vw-32px)] max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-white shadow-plate focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out"
        >
          <RDialog.Title className="sr-only">Search</RDialog.Title>
          <RDialog.Description className="sr-only">Search everything you have asked, every answer, and the names of the documents in My secure knowledge. Searching happens on this computer.</RDialog.Description>

          <div className="flex items-center gap-3 border-b border-line-soft px-4">
            <Search className="size-4 shrink-0 text-ink-50" strokeWidth={1.75} aria-hidden />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search conversations and documents"
              aria-label="Search conversations and documents"
              role="combobox"
              aria-expanded={flat.length > 0}
              aria-controls="command-results"
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? optionId(flat[active].id) : undefined}
              autoComplete="off"
              spellCheck={false}
              className="h-12 rounded-none border-0 bg-transparent px-0 text-md shadow-none hover:border-0 focus:border-0 focus:ring-0"
            />
            {pending ? <Spinner className="size-3.5" label="Searching" /> : null}
            <Kbd>Esc</Kbd>
          </div>

          <div ref={listRef} id="command-results" role="listbox" aria-label="Results" className="max-h-[min(60vh,440px)] overflow-y-auto p-2">
            {!needle && <p className="px-2.5 pb-1 pt-2.5 text-sm leading-5 text-ink-soft">Search everything you have asked and every answer, in every project, and the documents in My secure knowledge by name.</p>}
            {noResults && (
              <div className="px-2.5 pb-2 pt-2.5">
                <p className="break-words text-sm font-medium leading-5 text-ink">Nothing matches "{needle}".</p>
                <p className="mt-0.5 text-sm leading-5 text-ink-soft">Search looks for the exact phrase in conversations, and in the names of your documents. Try fewer words, or check the spelling.</p>
              </div>
            )}
            {renderGroup('For example', exampleItems)}
            {renderGroup('Conversations', conversationItems)}
            {renderGroup('In my secure knowledge', documentItems)}
            {renderGroup('Messages', messageItems)}
            {renderGroup('Actions', actions)}
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-line-soft bg-paper px-4 py-2 text-xs leading-4.5 text-ink-50">
            <span className="flex shrink-0 items-center gap-3">
              <span className="flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> Move
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>Enter</Kbd> Open
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>Esc</Kbd> Close
              </span>
            </span>
            <span className="truncate">Searching happens on this computer</span>
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

function Row({ item, index, highlighted, query, onHover, onSelect }: { item: Item; index: number; highlighted: boolean; query: string; onHover: () => void; onSelect: () => void }) {
  const base = 'flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-(--duration-micro) ease-(--ease-out) data-[highlighted]:bg-paper-deep'
  const common = {
    role: 'option' as const,
    id: optionId(item.id),
    'aria-selected': highlighted,
    'data-index': index,
    'data-highlighted': highlighted || undefined,
    tabIndex: -1,
    onMouseMove: onHover,
    onClick: onSelect,
  }

  if (item.kind === 'example') {
    return (
      <div {...common} className={base} aria-label={`Search for ${item.query}`}>
        <Search className="size-4 shrink-0 text-ink-50" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.query}</span>
        {highlighted && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-50">
            Search for this <CornerDownLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
          </span>
        )}
      </div>
    )
  }

  if (item.kind === 'conversation') {
    const c = item.conversation
    return (
      <div {...common} className={base}>
        <MessageSquare className="size-4 shrink-0 text-ink-50" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          <Highlight text={c.title} query={query} />
          {c.archived && <span className="ml-2 font-mono text-2xs text-ink-50">archived</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {item.project && (
            <>
              <span className="max-w-40 truncate text-xs text-ink-50">{item.project.name}</span>
              <ClassChip value={c.classification_effective} size="xs" />
            </>
          )}
          <span className="w-20 whitespace-nowrap text-right font-mono text-2xs tabular text-ink-50">{relativeTime(c.updated_at)}</span>
        </span>
      </div>
    )
  }

  if (item.kind === 'document') {
    const d = item.doc
    const status = DOC_STATUS[d.status]
    return (
      <div {...common} className={base} aria-label={`${d.name}. ${docFacts(d)}. ${status.label}. Opens My secure knowledge.`}>
        <DocIcon kind={d.kind} className="size-4 shrink-0 text-ink-50" />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          <Highlight text={d.name} query={query} />
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="hidden max-w-56 truncate text-xs text-ink-50 sm:inline">{docFacts(d)}</span>
          <span className={cn('whitespace-nowrap text-right font-mono text-2xs', d.status === 'failed' ? 'text-brass-text' : 'text-ink-50')}>{status.label}</span>
        </span>
      </div>
    )
  }

  if (item.kind === 'message') {
    const h = item.hit
    return (
      <div {...common} className={cn(base, 'items-start')}>
        <RoleLabel role={h.role} className="mt-0.5 w-14 justify-center" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-sm leading-5 text-ink-soft">
            <Highlight text={h.snippet} query={query} />
          </span>
          <span className="truncate text-xs text-ink-50">
            {item.conversation?.title ?? 'Conversation removed'}
            <span className="mx-1 text-ink-50">·</span>
            {item.project?.name ?? 'Project removed'}
          </span>
        </span>
        <span className="mt-0.5 w-20 shrink-0 whitespace-nowrap text-right font-mono text-2xs tabular text-ink-50">{relativeTime(h.created_at)}</span>
      </div>
    )
  }

  return (
    <div {...common} className={base}>
      <span className="flex size-4 shrink-0 items-center justify-center text-ink-50 [&>svg]:size-4 [&>svg]:stroke-[1.75]">{item.icon}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.label}</span>
      {item.detail && <span className="hidden shrink-0 text-xs text-ink-50 sm:inline">{item.detail}</span>}
      {highlighted && <Kbd>Enter</Kbd>}
    </div>
  )
}
