import { Building2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import type { Conversation } from '@/lib/types'
import { pluralise } from '@/lib/format'
import { ClassChip } from '@/components/ui/chips'
import { ConfirmDialog } from '@/components/ui/overlays'

/**
 * Lab only. The confirmation from MVP 11.3: the description is the specification
 * sentence, word for word. Moving back to this computer never shows a dialog.
 */
export function MoveToCompanyDialog({ open, onOpenChange, conversation }: { open: boolean; onOpenChange: (o: boolean) => void; conversation: Conversation }) {
  const company = useStore((s) => s.health.company)
  const toast = useStore((s) => s.toast)
  const count = useStore((s) => s.messages.filter((m) => m.conversation_id === conversation.id).length)
  const hasSummary = useStore((s) => s.summaries.some((x) => x.conversation_id === conversation.id))
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="This will leave your computer"
      title="Move this conversation to the company server?"
      description="This conversation's history will be sent to the company AI server."
      confirmLabel="Send and move"
      cancelLabel="Stay on this computer"
      onConfirm={() => {
        api.conversations.setProvider(conversation.id, 'company', true)
        onOpenChange(false)
        toast({ kind: 'info', title: 'Moved to the company server', description: 'A line in the conversation marks the move, and Activity keeps a note of it.' })
      }}
    >
      <div className="flex items-center gap-3 rounded-lg border border-line bg-paper px-3 py-2.5 text-sm">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-ink text-paper"><Building2 className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">{company.model_name} at {company.base_url.replace('https://', '')}</div>
          <div className="text-xs leading-4.5 text-ink-50">
            {pluralise(count, 'message')} will be sent{hasSummary ? ', with the summary of earlier ones' : ''}. The conversation stays on the company server until you move it back. Moving back never asks.
          </div>
        </div>
        <ClassChip value={conversation.classification_effective} />
      </div>
    </ConfirmDialog>
  )
}
