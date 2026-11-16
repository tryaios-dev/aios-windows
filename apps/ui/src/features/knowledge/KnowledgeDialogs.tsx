import { useState } from 'react'
import { AlertTriangle, Check, Copy } from 'lucide-react'
import type { FolderPreview } from '@aios/bridge-contract'
import type { KnowledgeDoc } from '@/lib/types'
import { formatDate, pluralise } from '@/lib/format'
import { Button, IconButton } from '@/components/ui/button'
import { Badge } from '@/components/ui/chips'
import { RadioCard, RadioGroup } from '@/components/ui/fields'
import { useCopy } from '@/components/ui/layout'
import { ConfirmDialog, Dialog, Tooltip } from '@/components/ui/overlays'
import { FileTile } from './KnowledgeArt'
import { Reveal } from '@/features/settings/shared'
import { isPath, pagesWords, sizeWords } from './helpers'

const total = (files: Array<{ size_bytes: number }>) => files.reduce((n, f) => n + f.size_bytes, 0)

function PathText({ children }: { children: string }) {
  return <span className="break-all font-mono text-xs tracking-[0.02em] text-ink">{children}</span>
}

/* ---------------- Choose a folder ---------------- */

/**
 * After the system folder dialog, says what will be copied and where the originals stay, before
 * anything is added (POST /knowledge/folder/preview). Nothing is copied until "Add".
 */
export function ChooseFolderDialog({ open, onOpenChange, preview, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; preview: FolderPreview | null; onAdd: (preview: FolderPreview) => void }) {
  const [path, setPath] = useState(preview?.path ?? '')
  if (!preview) return null
  const fresh = preview.files.filter((f) => !f.already)
  const chosen = path === preview.path
  const already = preview.files.length - fresh.length

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Choose a folder"
      description="AIOS copies what is in the folder. The folder itself is not moved or changed."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!chosen || !fresh.length} onClick={() => onAdd(preview)}>
            {fresh.length ? `Add ${pluralise(fresh.length, 'file')}` : 'Add folder'}
          </Button>
        </>
      }
    >
      <RadioGroup value={path} onValueChange={setPath} aria-label="Folders on this computer" className="flex flex-col gap-2">
        <RadioCard
          value={preview.path}
          title={preview.name}
          meta={<span className="tabular">{`${pluralise(preview.files.length, 'file')} · ${sizeWords(total(preview.files))}`}</span>}
          description={<span className="break-all font-mono text-xs tracking-[0.02em] text-ink-50">{preview.path}</span>}
        >
          {!fresh.length && preview.files.length > 0 && (
            <span className="mt-1.5">
              <Badge tone="green" icon={<Check />}>
                Already in your knowledge
              </Badge>
            </span>
          )}
        </RadioCard>
      </RadioGroup>

      <Reveal open={chosen} className="pt-4">
        {chosen && (
          <div className="overflow-hidden rounded-lg border border-line-soft bg-paper-raised" role="status">
            {fresh.length ? (
              <p className="px-4 py-3 text-sm leading-5 text-ink-soft">
                <span className="font-medium tabular text-ink">
                  {pluralise(fresh.length, 'file')}, {sizeWords(total(fresh))}
                </span>{' '}
                will be copied. {already > 0 && `${already === 1 ? 'One is' : `${already} are`} already in your knowledge. `}The originals stay in <PathText>{preview.path}</PathText>.
              </p>
            ) : (
              <p className="px-4 py-3 text-sm leading-5 text-ink-soft">{preview.files.length ? 'Everything in this folder is already in your knowledge. Nothing would be copied twice.' : 'There are no files in this folder.'}</p>
            )}
            {fresh.length > 0 && (
              <ul className="max-h-64 divide-y divide-line-soft overflow-y-auto border-t border-line-soft bg-white">
                {fresh.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="px-4 py-2">
                    <div className="flex items-baseline gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm leading-5 text-ink">{file.name}</span>
                      <span className="shrink-0 text-xs leading-5 tabular text-ink-50">
                        {file.kind} · {sizeWords(file.size_bytes)}
                      </span>
                    </div>
                    {file.problem && (
                      <p className="mt-0.5 flex items-start gap-1.5 text-xs leading-4.5 text-brass-text">
                        <AlertTriangle className="mt-[3px] size-3 shrink-0" aria-hidden />
                        <span>AIOS will not be able to read this one. {file.problem}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Reveal>
    </Dialog>
  )
}

/* ---------------- Where the original is ---------------- */

export function OriginalDialog({ doc, open, onOpenChange }: { doc: KnowledgeDoc; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { copied, copy } = useCopy()
  const known = isPath(doc.origin)
  const full = known ? `${doc.origin.replace(/[\\/]+$/, '')}\\${doc.name}` : ''
  const meta = [doc.kind, pagesWords(doc.pages), sizeWords(doc.size_bytes)].filter(Boolean).join(' · ')
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Where the original is"
      width="sm"
      footer={
        <Button variant="primary" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      }
    >
      <div className="flex items-center gap-3.5">
        <FileTile name={doc.name} kind={doc.kind} />
        <div className="min-w-0">
          <div className="break-words text-base font-medium leading-5.5 text-ink">{doc.name}</div>
          <div className="mt-0.5 text-xs leading-4.5 tabular text-ink-50">{meta}</div>
        </div>
      </div>

      {known ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-line-soft bg-paper-raised py-2.5 pl-3.5 pr-2">
          <div className="min-w-0 flex-1">
            <div className="label-mono">Original file</div>
            <div className="mt-1 leading-5">
              <PathText>{full}</PathText>
            </div>
          </div>
          <Tooltip content={copied ? 'Copied' : 'Copy this location'}>
            <IconButton label="Copy this location" size="sm" onClick={() => copy(full)}>
              {copied ? <Check className="text-green" /> : <Copy />}
            </IconButton>
          </Tooltip>
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-line-soft bg-paper-raised px-3.5 py-2.5 text-sm leading-5 text-ink">You dragged this one in. The original is still where you dragged it from.</p>
      )}

      <p className="mt-3.5 text-sm leading-5 text-ink-soft">
        AIOS did not move or change the original. Your AI works from the encrypted copy AIOS made on {formatDate(doc.added_at)}. If you change the original, remove this document here and add it again.
      </p>
    </Dialog>
  )
}

/* ---------------- Remove ---------------- */

export function RemoveDialog({ doc, open, onOpenChange, onConfirm }: { doc: KnowledgeDoc; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Remove this document from your knowledge?"
      description={`AIOS deletes its encrypted copy of “${doc.name}”, and your AI can no longer use it.`}
      confirmLabel="Remove"
      confirmVariant="destructive"
      onConfirm={onConfirm}
    >
      <p className="rounded-lg border border-line-soft bg-paper-raised px-3.5 py-2.5 text-sm leading-5 text-ink">
        The original file is not touched.{' '}
        {isPath(doc.origin) ? (
          <>
            It stays in <PathText>{doc.origin}</PathText>.
          </>
        ) : (
          'It stays where you dragged it from.'
        )}
      </p>
    </ConfirmDialog>
  )
}
