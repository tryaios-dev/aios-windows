import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import type { InstalledModel } from '@/lib/types'
import { formatBytes } from '@/lib/format'
import { modelLabel } from '@/lib/words'
import { ConfirmDialog } from '@/components/ui/overlays'

/** Remove an installed AI model. Conversations are kept; the activity record notes the removal. */
export function DeleteModelDialog({
  open,
  onOpenChange,
  model,
  successor,
  onRemoved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: InstalledModel
  /** The newer version that takes over, when this removal finishes an update. New conversations move to it. */
  successor?: InstalledModel
  onRemoved?: () => void
}) {
  const inUse = useStore((s) => s.settings.default_model_id === model.id)
  const other = useStore((s) => (s.settings.default_model_id === model.id ? s.installedModels.find((m) => m.id !== model.id) : undefined))
  const next = successor ?? other
  const label = modelLabel(model)
  const freed = formatBytes(model.size_bytes)

  const confirm = () => {
    const answering = !!useStore.getState().generation
    const result = api.models.remove(model.id)
    onOpenChange(false)
    if (!result.ok) {
      useStore.getState().toast({
        kind: 'deny',
        title: `${label} was not removed`,
        description: answering ? 'AIOS is writing an answer. Wait for it to finish, or stop it, then try again.' : result.reason,
      })
      return
    }
    // Finishing an update: new conversations go to the newer version, not to whichever other one is installed.
    if (successor && inUse) api.models.setDefault(successor.id)
    onRemoved?.()
    useStore.getState().toast({ kind: 'info', title: `${label} removed`, description: `${freed} freed on this computer.` })
  }

  const notes: string[] = []
  if (inUse) notes.push(next ? `It is the one in use. New conversations will use ${modelLabel(next)} instead.` : 'It is the only AI model installed. Chat will not work until you install another. Everything else keeps working.')
  notes.push('A conversation that used it will ask which AI model to carry on with.')

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${label}?`}
      description={`This frees ${freed} on this computer. Your conversations are kept, and you can install it again at any time.`}
      confirmLabel="Remove"
      confirmVariant="destructive"
      onConfirm={confirm}
    >
      <ul className="flex flex-col gap-1.5 rounded-lg border border-line bg-paper-raised px-3.5 py-2.5 text-sm leading-5 text-ink-soft">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </ConfirmDialog>
  )
}
