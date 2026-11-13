import { useEffect, useMemo, useRef, useState } from 'react'
import type { IncomingFile } from '@/lib/extras'
import type { KnowledgeDoc } from '@/lib/types'
import { SAMPLE_FILES } from '@/data/knowledge'
import { formatBytes, pluralise } from '@/lib/format'

/** The collection single files go into, and what is recorded for a file that was dragged in. */
export const LOOSE = 'Added one by one'
export const DROPPED = 'Dropped in'

/* ---------------- Words ---------------- */

export const isWorking = (d: KnowledgeDoc) => d.status === 'copying' || d.status === 'reading'

/** "1.8 MB", "94 KB": no decimals below a megabyte, where they only add noise. */
export const sizeWords = (bytes: number) => formatBytes(bytes, bytes < 1024 * 1024 ? 0 : 1)

export const pagesWords = (pages?: number) => (pages ? pluralise(pages, 'page') : null)

/** A folder on this computer, as opposed to "Dropped in". */
export const isPath = (origin: string) => /[\\/]/.test(origin)

/** The file name without its ending. */
export function stem(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

/** A document that arrived a moment ago, so its row may slide in. Anything older is simply there. */
export const isFresh = (iso: string) => Date.now() - Date.parse(iso) < 1200

const sameKey = (collection: string, name: string) => `${collection}/${name}`.toLowerCase()

/** The same test the store uses to avoid copying a file twice. */
export function alreadyHere(docs: KnowledgeDoc[]): (collection: string, name: string) => boolean {
  const have = new Set(docs.map((d) => sameKey(d.collection, d.name)))
  return (collection, name) => have.has(sameKey(collection, name))
}

/* ---------------- "Add files" ---------------- */

/**
 * Stands in for the Windows file dialog: the next two files that are not in
 * the library yet. When every one has been used it goes round again, and the
 * store says they were added before.
 */
export function nextSampleFiles(docs: KnowledgeDoc[], turn: number): Array<{ origin: string; files: IncomingFile[] }> {
  const here = alreadyHere(docs)
  const unused = SAMPLE_FILES.filter((f) => !here(LOOSE, f.name))
  const start = (turn * 2) % SAMPLE_FILES.length
  const picked = unused.length ? unused.slice(0, 2) : [SAMPLE_FILES[start], SAMPLE_FILES[(start + 1) % SAMPLE_FILES.length]]
  const byOrigin = new Map<string, IncomingFile[]>()
  for (const f of picked) {
    const list = byOrigin.get(f.origin) ?? []
    list.push({ name: f.name, size_bytes: f.size_bytes, pages: f.pages })
    byOrigin.set(f.origin, list)
  }
  return [...byOrigin.entries()].map(([origin, files]) => ({ origin, files }))
}

/* ---------------- Dropped files ---------------- */

export interface DroppedBatch {
  collection: string
  files: IncomingFile[]
}

/** Files Windows and macOS scatter about that nobody means to add. */
const HIDDEN = /^(\.|~\$)|^(thumbs\.db|desktop\.ini)$/i
const MOST_FILES = 200
const DEEPEST = 5

function entriesIn(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader()
  const all: FileSystemEntry[] = []
  return new Promise((resolve) => {
    const more = () =>
      reader.readEntries(
        (batch) => {
          if (!batch.length) return resolve(all)
          all.push(...batch)
          more()
        },
        () => resolve(all),
      )
    more()
  })
}

const fileOf = (entry: FileSystemFileEntry) => new Promise<File | null>((resolve) => entry.file(resolve, () => resolve(null)))

async function filesInside(dir: FileSystemDirectoryEntry, depth = 0, into: IncomingFile[] = []): Promise<IncomingFile[]> {
  for (const entry of await entriesIn(dir)) {
    if (into.length >= MOST_FILES) break
    if (HIDDEN.test(entry.name)) continue
    if (entry.isDirectory) {
      if (depth < DEEPEST) await filesInside(entry as FileSystemDirectoryEntry, depth + 1, into)
    } else {
      const file = await fileOf(entry as FileSystemFileEntry)
      if (file) into.push({ name: file.name, size_bytes: file.size })
    }
  }
  return into
}

/**
 * What was dropped, by name and size only. Nothing is opened and nothing is
 * sent anywhere. Loose files go in together; a dropped folder comes in as a
 * group of its own under the folder's name.
 */
export async function readDrop(dt: DataTransfer): Promise<DroppedBatch[]> {
  const loose: IncomingFile[] = []
  const folders: FileSystemDirectoryEntry[] = []
  // The browser only hands these over while the drop is happening, so they are all collected before the first wait.
  const items = dt.items ? Array.from(dt.items).filter((i) => i.kind === 'file') : []
  if (items.length) {
    for (const item of items) {
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
      if (entry?.isDirectory) {
        folders.push(entry as FileSystemDirectoryEntry)
        continue
      }
      const file = item.getAsFile()
      if (file && !HIDDEN.test(file.name)) loose.push({ name: file.name, size_bytes: file.size })
    }
  } else {
    for (const file of Array.from(dt.files)) if (!HIDDEN.test(file.name)) loose.push({ name: file.name, size_bytes: file.size })
  }

  const batches: DroppedBatch[] = []
  if (loose.length) batches.push({ collection: LOOSE, files: loose.slice(0, MOST_FILES) })
  for (const folder of folders) {
    const files = await filesInside(folder)
    if (files.length) batches.push({ collection: folder.name, files })
  }
  return batches
}

const carriesFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')

/**
 * Files dragged from the desktop over the window. Enter and leave are counted,
 * because the browser fires both for every element the pointer crosses; the
 * state only clears when the count is back to nothing or the pointer has left
 * the window. Returns whether files are over the window right now.
 */
export function usePageDrop(onDrop: (batches: DroppedBatch[]) => void): boolean {
  const [over, setOver] = useState(false)
  const handler = useRef(onDrop)
  useEffect(() => {
    handler.current = onDrop
  })

  useEffect(() => {
    let depth = 0
    const clear = () => {
      depth = 0
      setOver(false)
    }
    const enter = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth += 1
      setOver(true)
    }
    const hover = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      // Without this the browser would open the file instead of handing it over.
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      depth = Math.max(0, depth - 1)
      const outside = e.relatedTarget === null && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight)
      if (depth === 0 || outside) clear()
    }
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      clear()
      if (e.dataTransfer) void readDrop(e.dataTransfer).then((batches) => handler.current(batches))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', hover)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    window.addEventListener('dragend', clear)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', hover)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      window.removeEventListener('dragend', clear)
    }
  }, [])

  return over
}

/* ---------------- The run of documents being added ---------------- */

export interface AddingRun {
  total: number
  /** Finished, whether ready or not readable. */
  done: number
  failed: number
  running: boolean
  /** Every document in the run is one the person asked to try again. */
  again: boolean
  /** 0 to 100. Copying counts for a little, reading for about half. */
  percent: number
  dismiss: () => void
}

const WEIGHT: Record<KnowledgeDoc['status'], number> = { copying: 0.12, reading: 0.55, ready: 1, failed: 1 }

/** The run after the library changed: unchanged while nothing is being added, otherwise everything in the addition under way. */
function nextRun(prev: string[], knowledge: KnowledgeDoc[], retried: ReadonlySet<string>): string[] {
  const working = knowledge.filter(isWorking)
  if (!working.length) return prev
  const byId = new Map(knowledge.map((d) => [d.id, d]))
  const live = prev.filter((id) => byId.has(id))
  // A run that has finished is replaced; one still going takes the newcomers in.
  const carry = new Set(live.some((id) => isWorking(byId.get(id)!)) ? live : [])
  // Documents added in one go share a timestamp, which also finds the ones that finished while the page was closed.
  const stamps = new Set(working.filter((d) => !retried.has(d.id)).map((d) => d.added_at))
  const next = knowledge.filter((d) => carry.has(d.id) || isWorking(d) || stamps.has(d.added_at)).map((d) => d.id)
  return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next
}

/**
 * Which documents belong to the addition under way, so the page can say
 * "Adding 5 documents, 3 of 5 done". A run starts when something begins
 * copying, takes in everything added in the same go, and stays on screen
 * after it finishes until it is dismissed or the next run starts.
 */
export function useAddingRun(knowledge: KnowledgeDoc[], retried: ReadonlySet<string>): AddingRun | null {
  const [state, setState] = useState<{ seen: KnowledgeDoc[] | null; ids: string[] }>({ seen: null, ids: [] })
  // Worked out while rendering, whenever the library has changed, so the progress area is never a frame behind the list.
  let ids = state.ids
  if (state.seen !== knowledge) {
    ids = nextRun(state.ids, knowledge, retried)
    setState({ seen: knowledge, ids })
  }

  return useMemo(() => {
    const wanted = new Set(ids)
    const docs = knowledge.filter((d) => wanted.has(d.id))
    if (!docs.length) return null
    const done = docs.filter((d) => !isWorking(d)).length
    return {
      total: docs.length,
      done,
      failed: docs.filter((d) => d.status === 'failed').length,
      running: done < docs.length,
      again: docs.every((d) => retried.has(d.id)),
      percent: (docs.reduce((n, d) => n + WEIGHT[d.status], 0) / docs.length) * 100,
      dismiss: () => setState((prev) => ({ ...prev, ids: [] })),
    }
  }, [ids, knowledge, retried])
}
