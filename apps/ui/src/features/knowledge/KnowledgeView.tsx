import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { FilePlus2, FolderOpen } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useExtras } from '@/lib/extras'
import { truncate } from '@/lib/format'
import { useStore } from '@/lib/store'
import type { KnowledgeDoc } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { PageBody, PageHeader } from '@/components/ui/layout'
import { EmptyKnowledge } from './EmptyKnowledge'
import { StoreDrawing } from './KnowledgeArt'
import { OriginalDialog, RemoveDialog } from './KnowledgeDialogs'
import { Library, type LibraryFilter } from './Library'
import { stem, useAddingRun, usePageDrop, type DroppedBatch } from './helpers'

const NONE: ReadonlySet<string> = new Set()

/** How long a row takes to close before its document is removed. Matches the row's own transition. */
const ROW_CLOSES_MS = 220

/**
 * My secure knowledge: the documents the person wants their AI to know about.
 * Files are copied in, never moved; AIOS keeps the copy encrypted on this
 * computer and reads it so the AI can use it when asked.
 *
 * Three ways in, all ending at the same place: drop files anywhere on the
 * page, choose a folder, or add files. Everything added is listed underneath,
 * grouped by the folder it came in with.
 */
export function KnowledgeView() {
  const navigate = useNavigate()
  const knowledge = useExtras((s) => s.knowledge)
  const lastProjectId = useStore((s) => s.ui.lastProjectId)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [original, setOriginal] = useState<{ doc: KnowledgeDoc; open: boolean } | null>(null)
  const [removal, setRemoval] = useState<{ doc: KnowledgeDoc; open: boolean } | null>(null)
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(NONE)
  const [retried, setRetried] = useState<ReadonlySet<string>>(NONE)
  const top = useRef<HTMLDivElement>(null)

  const run = useAddingRun(knowledge, retried)
  const empty = knowledge.length === 0

  // The backend has no knowledge store yet (proposed: POST /knowledge), so adding says so and changes nothing.
  const addFiles = () => api.knowledge.add()

  const addDropped = (batches: DroppedBatch[]) => {
    if (!batches.length) {
      useStore.getState().toast({ kind: 'info', title: 'Nothing to add', description: 'There were no files in what you dropped.' })
      return
    }
    api.knowledge.add()
  }

  const dragging = usePageDrop(addDropped)

  const ask = async (doc: KnowledgeDoc) => {
    const open = api.projects.list().filter((p) => !p.archived)
    const project = open.find((p) => p.id === lastProjectId) ?? open[0] ?? (await api.projects.create({ name: 'My workspace', classification: 'restricted' }))
    const conversation = project && (await api.conversations.create(project.id, `About ${truncate(stem(doc.name), 48)}`))
    if (project && conversation) navigate(`/projects/${project.id}/c/${conversation.id}`, { state: { draftText: `About “${doc.name}” in my secure knowledge: ` } })
  }

  const retry = (doc: KnowledgeDoc) => {
    setRetried((prev) => new Set(prev).add(doc.id))
    api.knowledge.retry(doc.id)
  }

  /** Close the row, then remove the document. The original file is never involved. */
  const remove = (doc: KnowledgeDoc) => {
    setLeaving((prev) => new Set(prev).add(doc.id))
    window.setTimeout(() => {
      api.knowledge.remove(doc.id)
      setLeaving((prev) => {
        const next = new Set(prev)
        next.delete(doc.id)
        return next
      })
    }, ROW_CLOSES_MS)
  }

  const openFolders = () => api.knowledge.add()

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="My secure knowledge"
        description="The documents you want your AI to know about, kept as encrypted copies on this computer."
        actions={
          <>
            <Button leading={<FilePlus2 className="size-4" />} onClick={addFiles} aria-label="Add files">
              <span className="max-sm:sr-only">Add files</span>
            </Button>
            {/* On a fresh page the same button sits, larger, in the drop area; one of them is enough to lead. */}
            <Button variant={empty ? 'secondary' : 'primary'} leading={<FolderOpen className="size-4" />} onClick={openFolders} aria-label="Choose a folder">
              <span className="max-sm:sr-only">Choose a folder</span>
            </Button>
          </>
        }
      />

      <PageBody>
        <div ref={top}>
          {empty ? (
            <EmptyKnowledge key="empty" onChooseFolder={openFolders} onAddFiles={addFiles} />
          ) : (
            <div key="library" className="animate-fade">
              <Library
                docs={knowledge}
                query={query}
                onQuery={setQuery}
                filter={filter}
                onFilter={setFilter}
                run={run}
                leaving={leaving}
                onAddFiles={addFiles}
                onAsk={ask}
                onOriginal={(doc) => setOriginal({ doc, open: true })}
                onRemove={(doc) => setRemoval({ doc, open: true })}
                onRemoveNow={remove}
                onRetry={retry}
              />
            </div>
          )}
        </div>
      </PageBody>

      {/* Files dragged from the desktop: the whole page becomes the place to drop them. It never takes the pointer, so nothing flickers. */}
      <div
        aria-hidden={!dragging}
        className={cn(
          'pointer-events-none absolute inset-0 z-30 flex bg-paper/85 p-4 backdrop-blur-[3px] transition-[opacity,visibility] duration-(--duration-micro) ease-(--ease-out)',
          dragging ? 'visible opacity-100' : 'invisible opacity-0',
        )}
      >
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-hidden rounded-2xl border-2 border-dashed border-green bg-green-wash px-6 text-center transition-transform duration-(--duration-panel) ease-(--ease-out)',
            dragging ? 'scale-100' : 'scale-[0.985]',
          )}
        >
          <div className="w-full max-w-[25rem]">
            <StoreDrawing playing={dragging} />
          </div>
          <div>
            <p className="font-display text-3xl leading-[1.15] text-ink">Drop to add to your secure knowledge</p>
            <p className="mx-auto mt-3 max-w-md text-md leading-6 text-ink-soft">AIOS keeps an encrypted copy on this computer. Your original files stay where they are.</p>
          </div>
        </div>
      </div>
      <p className="sr-only" role="status">
        {dragging ? 'Drop to add to your secure knowledge' : ''}
      </p>

      {original && <OriginalDialog doc={original.doc} open={original.open} onOpenChange={(open) => setOriginal((o) => (o ? { ...o, open } : o))} />}
      {removal && (
        <RemoveDialog
          doc={removal.doc}
          open={removal.open}
          onOpenChange={(open) => setRemoval((r) => (r ? { ...r, open } : r))}
          onConfirm={() => {
            setRemoval((r) => (r ? { ...r, open: false } : r))
            remove(removal.doc)
          }}
        />
      )}
    </div>
  )
}
