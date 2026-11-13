import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Cpu, FileText, FolderOpen, ListChecks, MessagesSquare, Tags, type LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore, useStoreShallow } from '@/lib/store'
import type { ExportResult, ImportResult, Project } from '@/lib/types'
import { cn } from '@/lib/cn'
import { formatBytes, pluralise } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { CLASS_META, ClassChip } from '@/components/ui/chips'
import { Callout, Spinner } from '@/components/ui/feedback'
import { Hint, Input, Label } from '@/components/ui/fields'
import { Hash, KeyValue, Mono } from '@/components/ui/layout'
import { Dialog } from '@/components/ui/overlays'
import { IconTile } from '@/features/settings/shared'
import { Disclosure } from './ProjectDialogs'

/**
 * Project file dialogs (MVP 4.5, 9.5, AC-16; tickets J-01, J-02, K-09).
 * The specification calls the format "Project Package v1"; people see "a file".
 *
 * Both dialogs keep their flow state inside the dialog content, so Radix
 * unmounting the content on close resets them without an effect. While a
 * file is being saved or checked the dialog refuses to close.
 */

const EXPORT_FOLDER = 'C:\\Users\\pilot\\Documents\\AIOS exports'

/** Mirrors the file-name rule the export endpoint applies. */
function projectFileName(projectName: string) {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `${slug || 'project'}.aiosproj`
}

function folderOf(path: string) {
  const i = path.lastIndexOf('\\')
  return i > 0 ? path.slice(0, i) : path
}

/* ---------------- Shared pieces ---------------- */

function DialogBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4 px-6 pb-1">{children}</div>
}

function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-2 px-6 pt-4">{children}</div>
}

function ContentsList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="label-mono mb-2 px-0.5">{title}</div>
      <ul className="divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-paper-raised">{children}</ul>
    </section>
  )
}

function ContentsItem({ icon: Icon, muted, children }: { icon: LucideIcon; muted?: boolean; children: ReactNode }) {
  return (
    <li className={cn('flex items-start gap-3 px-3.5 py-2.5 text-sm leading-5', muted ? 'bg-paper text-ink-50' : 'text-ink')}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', muted ? 'text-ink-50' : 'text-green')} strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  )
}

function WorkingRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-paper-raised px-3.5 py-3 animate-fade" aria-live="polite">
      <Spinner className="text-green" label={label} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block truncate text-xs text-ink-50">{detail}</span>
      </span>
    </div>
  )
}

function ActivityLink({ seq, onOpen }: { seq: number; onOpen: () => void }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      <span className="tabular">Record {seq}</span>
      <button type="button" onClick={onOpen} className="rounded-xs text-sm font-medium text-green underline-offset-4 hover:underline">
        See in Activity
      </button>
    </span>
  )
}

/* ================================================================== */
/* Save this project as a file                                         */
/* ================================================================== */

export function ExportProjectDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project: Project }) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && busy) return
        onOpenChange(o)
      }}
      width="md"
      hideClose={busy}
      bare
      title="Save this project as a file"
      description="One file you can open in AIOS on another computer."
    >
      <ExportFlow project={project} onBusy={setBusy} onClose={() => onOpenChange(false)} />
    </Dialog>
  )
}

type ExportPhase = { kind: 'idle'; error?: string } | { kind: 'working' } | { kind: 'done'; result: ExportResult }

function ExportFlow({ project, onBusy, onClose }: { project: Project; onBusy: (b: boolean) => void; onClose: () => void }) {
  const navigate = useNavigate()
  const counts = useStoreShallow((s) => {
    const ids = new Set(s.conversations.filter((c) => c.project_id === project.id).map((c) => c.id))
    return {
      conversations: ids.size,
      messages: s.messages.filter((m) => ids.has(m.conversation_id)).length,
    }
  })
  const [folder, setFolder] = useState(EXPORT_FOLDER)
  const [phase, setPhase] = useState<ExportPhase>({ kind: 'idle' })
  const fileName = projectFileName(project.name)
  const label = CLASS_META[project.classification].label

  const run = async () => {
    setPhase({ kind: 'working' })
    onBusy(true)
    try {
      const result = await api.projects.exportPackage(project.id)
      setPhase({ kind: 'done', result })
    } catch (e) {
      setPhase({ kind: 'idle', error: e instanceof Error ? e.message : 'No reason was given.' })
    } finally {
      onBusy(false)
    }
  }

  const openActivity = (seq: number) => {
    onClose()
    navigate(`/projects/${project.id}/activity?seq=${seq}`)
  }

  if (phase.kind === 'done') {
    const { result } = phase
    return (
      <>
        <DialogBody>
          <Callout tone="success" title="Saved">
            To use it on another computer, open AIOS there and choose Add a project from a file. Keep the file somewhere that suits its {label} label.
          </Callout>
          <KeyValue
            dense
            rows={[
              { k: 'File name', v: <Mono className="text-ink">{result.file_name}</Mono> },
              { k: 'Where', v: <Mono className="break-all">{folderOf(result.path)}</Mono> },
              { k: 'Size', v: <span className="tabular">{formatBytes(result.size_bytes)}</span> },
            ]}
          />
          <Disclosure label="Details">
            <KeyValue
              dense
              rows={[
                { k: 'Checksum', v: <Hash value={result.checksum} head={12} tail={8} />, hint: 'Lets the other computer confirm the file is complete and unchanged.' },
                { k: 'Activity record', v: <ActivityLink seq={result.evidence_seq} onOpen={() => openActivity(result.evidence_seq)} /> },
              ]}
            />
          </Disclosure>
        </DialogBody>
        <DialogFooter>
          <Button
            leading={<FolderOpen className="size-3.5" />}
            onClick={() => useStore.getState().toast({ kind: 'info', title: 'Folder opened', description: folderOf(result.path) })}
          >
            Show in folder
          </Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </DialogFooter>
      </>
    )
  }

  const working = phase.kind === 'working'

  return (
    <>
      <DialogBody>
        <ContentsList title="What is in the file">
          <ContentsItem icon={MessagesSquare}>
            Your conversations and their summaries
            <span className="tabular text-ink-50"> · {pluralise(counts.conversations, 'conversation')}, {pluralise(counts.messages, 'message')}</span>
          </ContentsItem>
          <ContentsItem icon={Tags}>
            <span className="inline-flex flex-wrap items-center gap-1.5">
              The sensitivity label <ClassChip value={project.classification} size="xs" />
            </span>
          </ContentsItem>
          <ContentsItem icon={ListChecks}>What AIOS needs to check the file is complete</ContentsItem>
          <ContentsItem icon={Cpu} muted>Not in the file: AI models. The other computer uses its own.</ContentsItem>
        </ContentsList>

        {working ? (
          <WorkingRow label="Saving the file" detail={`${fileName} to ${folder}`} />
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="export-folder">Save to</Label>
            <div className="flex items-center gap-2">
              <Input id="export-folder" mono readOnly value={folder} className="flex-1" aria-describedby="export-folder-hint" />
              <Button leading={<FolderOpen className="size-3.5" />} onClick={() => setFolder(EXPORT_FOLDER)}>
                Choose folder
              </Button>
            </div>
            <Hint>
              <span id="export-folder-hint">
                The file will be called <Mono>{fileName}</Mono>. Activity keeps a note that you saved it, and holds no conversation content.
              </span>
            </Hint>
          </div>
        )}

        {phase.kind === 'idle' && phase.error && (
          <Callout tone="deny" title="The file could not be saved. Nothing was written.">
            Check that the folder exists and that you can save to it, then try again.
            <Disclosure label="Details" className="mt-1">
              <Mono className="break-words">{phase.error}</Mono>
            </Disclosure>
          </Callout>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={working}>Cancel</Button>
        <Button variant="primary" onClick={run} loading={working}>Save file</Button>
      </DialogFooter>
    </>
  )
}

/* ================================================================== */
/* Add a project from a file                                           */
/* ================================================================== */

export function ImportPackageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && busy) return
        onOpenChange(o)
      }}
      width="md"
      hideClose={busy}
      bare
      title="Add a project from a file"
      description="AIOS checks the file is complete and unchanged before adding anything."
    >
      <ImportFlow onBusy={setBusy} onClose={() => onOpenChange(false)} />
    </Dialog>
  )
}

interface PickedFile {
  file_name: string
  size_bytes: number
  saved_on: string
}

/** The prototype has no file system; choosing a file picks this sample. */
const SAMPLE_FILE: PickedFile = {
  file_name: 'supplier-faq.aiosproj',
  size_bytes: 86 * 1024,
  saved_on: '19 Oct 2026',
}

type ImportPhase = { kind: 'pick' } | { kind: 'working' } | { kind: 'done'; result: ImportResult } | { kind: 'failed'; error: string }

function ImportFlow({ onBusy, onClose }: { onBusy: (b: boolean) => void; onClose: () => void }) {
  const navigate = useNavigate()
  const [file, setFile] = useState<PickedFile | null>(null)
  const [phase, setPhase] = useState<ImportPhase>({ kind: 'pick' })
  const importedId = phase.kind === 'done' ? phase.result.project_id : undefined
  const imported = useStore((s) => s.projects.find((p) => p.id === importedId))

  const run = async () => {
    if (!file) return
    setPhase({ kind: 'working' })
    onBusy(true)
    try {
      const outcome = await api.projects.importPackage()
      setPhase(outcome.ok ? { kind: 'done', result: outcome.result } : { kind: 'failed', error: outcome.error })
    } catch (e) {
      setPhase({ kind: 'failed', error: e instanceof Error ? e.message : 'No reason was given.' })
    } finally {
      onBusy(false)
    }
  }

  const tryAnother = () => {
    setFile(null)
    setPhase({ kind: 'pick' })
  }

  if (phase.kind === 'done') {
    const { result } = phase
    const skipped = result.warnings.length
    return (
      <>
        <DialogBody>
          <Callout tone="success" title={`Added ${result.project_name}`}>
            It is a new project on this computer and keeps the sensitivity label it was saved with.
          </Callout>
          <KeyValue
            dense
            rows={[
              { k: 'Conversations', v: <span className="tabular">{result.conversations}</span> },
              { k: 'Messages', v: <span className="tabular">{result.messages}</span> },
              { k: 'Summaries', v: <span className="tabular">{result.summaries}</span> },
              { k: 'Sensitivity', v: <ClassChip value={imported?.classification ?? 'internal'} /> },
            ]}
          />
          {skipped > 0 && (
            <Callout tone="caution" compact>
              {skipped === 1 ? 'One item in the file was not recognised and was left out.' : `${skipped} items in the file were not recognised and were left out.`}
            </Callout>
          )}
          {result.remapped && (
            <Callout tone="neutral" compact>
              A project with the same internal name already existed, so this one was added as a separate project.
            </Callout>
          )}
          <Disclosure label="Details">
            <KeyValue
              dense
              rows={[
                { k: 'Project ID', v: <Hash value={result.project_id} head={12} tail={8} /> },
                { k: 'Label source', v: <Mono>{imported?.classification_source ?? 'import'}</Mono> },
                ...(skipped > 0
                  ? [
                      {
                        k: 'Left out',
                        v: (
                          <ul className="flex flex-col gap-1">
                            {result.warnings.map((w) => (
                              <li key={w}>
                                <Mono className="break-words">{w}</Mono>
                              </li>
                            ))}
                          </ul>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Disclosure>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose()
              navigate(`/projects/${result.project_id}`)
            }}
          >
            Open project
          </Button>
        </DialogFooter>
      </>
    )
  }

  const working = phase.kind === 'working'
  const failed = phase.kind === 'failed'

  return (
    <>
      <DialogBody>
        <div className={cn('flex items-center gap-3.5 rounded-lg border px-3.5 py-3 transition-colors duration-(--duration-panel) ease-(--ease-out)', file ? 'border-line bg-white' : 'border-dashed border-line-strong bg-paper-raised')}>
          <IconTile tone={failed ? 'deny' : file ? 'green' : 'neutral'}>
            <FileText strokeWidth={1.75} />
          </IconTile>
          <div className="min-w-0 flex-1" aria-live="polite">
            {file ? (
              <>
                <div className="truncate font-mono text-sm text-ink">{file.file_name}</div>
                <div className="mt-0.5 text-xs leading-4.5 text-ink-50">
                  <span className="tabular">{formatBytes(file.size_bytes, 0)}</span> · saved {file.saved_on}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-ink">No file chosen</div>
                <div className="mt-0.5 text-xs leading-4.5 text-ink-50">Choose a project file that was saved from AIOS.</div>
              </>
            )}
          </div>
          {!failed && (
            <Button size="sm" variant={file ? 'ghost' : 'primary'} onClick={() => setFile(SAMPLE_FILE)} disabled={working}>
              {file ? 'Change' : 'Choose file'}
            </Button>
          )}
        </div>

        {failed ? (
          <Callout tone="deny" title="This file is damaged or was changed. Nothing was added.">
            Ask whoever sent it to save the project again, then try the new file.
            <Disclosure label="Details" className="mt-1">
              <Mono className="break-words">{phase.error}</Mono>
            </Disclosure>
          </Callout>
        ) : working ? (
          <WorkingRow label="Checking the file" detail="Nothing is added until every check passes." />
        ) : (
          <Hint>It is added as a new project. Nothing already on this computer is changed. Activity keeps a note that it was added.</Hint>
        )}
      </DialogBody>
      <DialogFooter>
        {failed ? (
          <>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={tryAnother}>Try another file</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={working}>Cancel</Button>
            {/* Choosing a file is the first step, so it holds the primary button until a file is chosen. */}
            <Button variant={file ? 'primary' : 'secondary'} onClick={run} loading={working} disabled={!file}>Add project</Button>
          </>
        )}
      </DialogFooter>
    </>
  )
}
