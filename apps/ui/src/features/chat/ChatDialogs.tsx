import { useState } from 'react'
import { Building2, Cloud } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import { resourceModels, type Conversation, type LinkedResource } from '@/lib/types'
import { pluralise } from '@/lib/format'
import { ClassChip } from '@/components/ui/chips'
import { ConfirmDialog } from '@/components/ui/overlays'
import { Field, Select } from '@/components/ui/fields'

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

/**
 * Moving a conversation to a cloud AI model linked on the Resources page (DeepSeek V4 first). The
 * same promise as the Company dialog: it asks first, and moving back to this computer never asks.
 */
export function MoveToResourceDialog({ open, onOpenChange, conversation, resource }: { open: boolean; onOpenChange: (o: boolean) => void; conversation: Conversation; resource: LinkedResource }) {
  const toast = useStore((s) => s.toast)
  const count = useStore((s) => s.messages.filter((m) => m.conversation_id === conversation.id).length)
  const hasSummary = useStore((s) => s.summaries.some((x) => x.conversation_id === conversation.id))
  const name = resource.name ?? 'the linked AI model'
  const models = resourceModels(resource)
  // Already on this resource: start from another of its models; else from its default.
  const here = conversation.current_provider === 'resource' && models.some((m) => m.id === conversation.model_id)
  const [modelId, setModelId] = useState(() => (here ? models.find((m) => m.id !== conversation.model_id) : models[0])?.id ?? '')
  const modelName = models.find((m) => m.id === modelId)?.name ?? modelId
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="This will leave your computer"
      title={here ? `Use ${modelName} for this conversation?` : `Move this conversation to ${name}?`}
      description={`This conversation's history will be sent to ${modelName}, a cloud AI model of ${name} you linked. Each model is charged at its own price.`}
      confirmLabel="Send and move"
      cancelLabel="Stay on this computer"
      onConfirm={() => {
        if (!modelId || (here && modelId === conversation.model_id)) return onOpenChange(false)
        api.conversations.setProvider(conversation.id, 'resource', true, resource.id, modelId)
        onOpenChange(false)
        toast({ kind: 'info', title: `Moved to ${modelName}`, description: 'A line in the conversation marks the move, and Activity keeps a note of it.' })
      }}
    >
      {models.length > 1 && (
        <Field label="AI model" htmlFor="resource-model" hint="Bigger models answer better and cost more per word.">
          <Select
            id="resource-model"
            value={modelId}
            onValueChange={setModelId}
            options={models.map((m) => ({ value: m.id, label: m.name, description: m.id === conversation.model_id ? 'In use now' : m.name !== m.id ? m.id : undefined }))}
          />
        </Field>
      )}
      <div className="flex items-center gap-3 rounded-lg border border-line bg-paper px-3 py-2.5 text-sm">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-ink text-paper"><Cloud className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">{name}{modelId ? ` · ${modelName}` : ''}</div>
          <div className="text-xs leading-4.5 text-ink-50">
            {pluralise(count, 'message')} will be sent{hasSummary ? ', with the summary of earlier ones' : ''}. The conversation stays there until you move it back. Moving back never asks.
          </div>
        </div>
        <ClassChip value={conversation.classification_effective} />
      </div>
    </ConfirmDialog>
  )
}
