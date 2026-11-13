import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { LibraryBig, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { pluralise } from '@/lib/format'
import type { KnowledgeDoc } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/fields'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays'
import { DocIcon } from '@/features/search/DocIcon'
import { useChosenDocuments, useKnowledgeUse } from './knowledgeUse'

const quietLink = 'rounded-xs font-medium text-green underline-offset-4 hover:underline'

/**
 * "Use my knowledge": a quiet button in the message box that opens the list of documents ready to use.
 * Choosing documents sends nothing and changes nothing in the message; it marks what the questions in this conversation are asked with.
 */
export function KnowledgeButton({ conversationId, disabled, onCompanyServer }: { conversationId: string; disabled?: boolean; /** Documents are used only in conversations that run on this computer. */ onCompanyServer?: boolean }) {
  const { ready, chosen, total } = useChosenDocuments(conversationId)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const count = onCompanyServer ? 0 : chosen.length

  const q = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const shown = q ? ready.filter((d) => d.name.toLowerCase().includes(q) || d.collection.toLowerCase().includes(q)) : ready
    const byFolder = new Map<string, KnowledgeDoc[]>()
    for (const d of shown) byFolder.set(d.collection, [...(byFolder.get(d.collection) ?? []), d])
    return [...byFolder.entries()]
  }, [ready, q])

  const notReady = total - ready.length
  const toggle = (id: string) => useKnowledgeUse.getState().toggle(conversationId, id)
  const openLibrary = (
    <Link to="/knowledge" className={quietLink} onClick={() => setOpen(false)}>
      Open My secure knowledge
    </Link>
  )

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={count ? `Use my knowledge. ${pluralise(count, 'document')} chosen.` : 'Use my knowledge'}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors duration-(--duration-micro) hover:bg-ink-6 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60 data-[state=open]:bg-ink-6 data-[state=open]:text-ink',
            count ? 'text-green-dark' : 'text-ink-soft',
          )}
        >
          <LibraryBig className="size-3.5 shrink-0" />
          <span className="hidden sm:inline">Use my knowledge</span>
          {count > 0 && <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-green px-1 text-2xs font-semibold leading-none text-white tabular">{count}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="px-3.5 pt-3 pb-3">
          <div className="text-sm font-semibold leading-5 text-ink">Use my knowledge</div>
          {onCompanyServer ? (
            <p className="mt-1 text-sm leading-5 text-ink-soft">This conversation runs on the company server. Documents from My secure knowledge are used only in conversations on this computer.</p>
          ) : total === 0 ? (
            <>
              <p className="mt-1 text-sm leading-5 text-ink-soft">You have not added any documents yet. Add them in My secure knowledge and they are listed here.</p>
              <Button size="sm" asChild className="mt-3">
                <Link to="/knowledge" onClick={() => setOpen(false)}>
                  Open My secure knowledge
                </Link>
              </Button>
            </>
          ) : ready.length === 0 ? (
            <>
              <p className="mt-1 text-sm leading-5 text-ink-soft">None of your documents is ready to use yet. They are listed here once AIOS has read them.</p>
              <Button size="sm" asChild className="mt-3">
                <Link to="/knowledge" onClick={() => setOpen(false)}>
                  Open My secure knowledge
                </Link>
              </Button>
            </>
          ) : (
            <p className="mt-0.5 text-xs leading-4.5 text-ink-50">Choose the documents the AI should use in this conversation. They stay on this computer.</p>
          )}
        </div>

        {!onCompanyServer && ready.length > 0 && (
          <>
            <div className="relative px-3.5 pb-2">
              <Search className="pointer-events-none absolute left-6 top-2 size-3.5 text-ink-50" strokeWidth={1.75} aria-hidden />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a document"
                aria-label="Find a document"
                autoComplete="off"
                spellCheck={false}
                className="h-7.5 w-full rounded-md border border-line-control bg-white pl-8 pr-2.5 text-sm text-ink transition-[border-color,box-shadow] duration-(--duration-micro) placeholder:text-ink-50 hover:border-line-strong focus:border-green focus:outline-none focus:ring-2 focus:ring-green/20"
              />
            </div>

            <div className="max-h-64 overflow-y-auto border-t border-line-soft px-1.5 py-1.5" role="group" aria-label="Documents ready to use">
              {groups.length === 0 ? (
                <p className="px-2 py-3 text-sm leading-5 text-ink-soft">No document or folder has that name.</p>
              ) : (
                groups.map(([folder, docs]) => (
                  <div key={folder} role="group" aria-label={folder}>
                    <div className="label-mono px-2 pb-1 pt-2">{folder}</div>
                    {docs.map((d) => {
                      const picked = chosen.some((c) => c.id === d.id)
                      return (
                        <label key={d.id} className={cn('flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-(--duration-micro) hover:bg-paper-deep', picked && 'bg-green-wash hover:bg-green-soft')}>
                          <Checkbox checked={picked} onCheckedChange={() => toggle(d.id)} />
                          <DocIcon kind={d.kind} className="size-4 shrink-0 text-ink-50" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm leading-5 text-ink">{d.name}</span>
                            <span className="block truncate text-xs leading-4.5 text-ink-50 tabular">{d.pages ? `${d.kind} · ${pluralise(d.pages, 'page')}` : d.kind}</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                ))
              )}
            </div>

            {notReady > 0 && (
              <p className="border-t border-line-soft px-3.5 py-2 text-xs leading-4.5 text-ink-50">
                {notReady === 1 ? '1 more document is not ready to use.' : `${notReady} more documents are not ready to use.`} {openLibrary}
              </p>
            )}

            <div className="flex min-h-10 items-center justify-between gap-3 border-t border-line-soft bg-paper-raised px-3.5 py-1.5">
              <span className="text-xs leading-4.5 text-ink-soft tabular" aria-live="polite">
                {chosen.length ? `${pluralise(chosen.length, 'document')} chosen` : 'None chosen'}
              </span>
              <span className="flex items-center gap-1">
                {chosen.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => useKnowledgeUse.getState().setChosen(conversationId, [])}>
                    Clear
                  </Button>
                )}
                <Button size="sm" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </span>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** The chosen documents, above the message box: "Using 2 documents", each one removable. */
export function KnowledgeChips({ conversationId }: { conversationId: string }) {
  const { chosen } = useChosenDocuments(conversationId)
  if (chosen.length === 0) return null
  return (
    <div className="flex animate-fade flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line-soft px-3 py-2">
      <span className="inline-flex items-center gap-1.5 pl-1 text-xs font-medium leading-4.5 text-ink-soft">
        <LibraryBig className="size-3.5 shrink-0 text-green" aria-hidden />
        Using {pluralise(chosen.length, 'document')}
      </span>
      <ul className="contents" aria-label="Documents this conversation is using">
        {chosen.map((d) => {
          return (
            <li key={d.id} className="inline-flex h-6 max-w-full items-center gap-1 rounded-sm border border-line bg-white pl-1.5 pr-0.5 text-xs leading-none text-ink">
              <DocIcon kind={d.kind} className="size-3 shrink-0 text-ink-50" />
              <span className="max-w-56 truncate leading-4.5" title={d.name}>
                {d.name}
              </span>
              <button
                type="button"
                onClick={() => useKnowledgeUse.getState().toggle(conversationId, d.id)}
                aria-label={`Stop using ${d.name}`}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-xs text-ink-50 transition-colors duration-(--duration-micro) hover:bg-ink-6 hover:text-ink"
              >
                <X className="size-3" strokeWidth={2} aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
