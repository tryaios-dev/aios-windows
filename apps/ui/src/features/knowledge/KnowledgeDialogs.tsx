import { Check, Copy } from 'lucide-react'
import type { KnowledgeDoc } from '@/lib/types'
import { formatDate } from '@/lib/format'
import { Button, IconButton } from '@/components/ui/button'
import { useCopy } from '@/components/ui/layout'
import { ConfirmDialog, Dialog, Tooltip } from '@/components/ui/overlays'
import { FileTile } from './KnowledgeArt'
import { isPath, pagesWords, sizeWords } from './helpers'

function PathText({ children }: { children: string }) {
  return <span className="break-all font-mono text-xs tracking-[0.02em] text-ink">{children}</span>
}

/* ---------------- Choose a folder ---------------- */

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
