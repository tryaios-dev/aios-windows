import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useStore } from '@/lib/store'
import { modelLabel, sizeBlurb } from '@/lib/words'
import { catalogueEntry } from '@/data/catalogue'
import { ConfirmDialog, Dialog } from '@/components/ui/overlays'
import { Button } from '@/components/ui/button'
import { RadioCard, RadioGroup } from '@/components/ui/fields'
import { Callout } from '@/components/ui/feedback'

/** Dialogs the store can raise from anywhere: carrying on here when the company server drops, and choosing an AI model when one was removed. */
export function GlobalDialogs() {
  return (
    <>
      <ContinueLocallyDialog />
      <ModelChoiceDialog />
    </>
  )
}

/** Lab only. The title is the specification sentence, word for word. */
function ContinueLocallyDialog() {
  const prompt = useStore((s) => s.continueLocally)
  const answer = useStore((s) => s.answerContinueLocally)
  const conv = useStore((s) => s.conversations.find((c) => c.id === prompt?.conversation_id))
  const defaultModel = useStore((s) => s.installedModels.find((m) => m.id === s.settings.default_model_id))
  const open = !!prompt
  const title = conv?.title ?? 'this conversation'
  const using = defaultModel ? ` using ${modelLabel(defaultModel)}` : ''
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) answer(false)
      }}
      eyebrow="Company server not reachable"
      title="Continue this conversation locally?"
      description={
        prompt?.partial_message_id
          ? `The connection to the company server dropped part-way through the answer. What arrived is saved. You can carry on with "${title}" on this computer${using}. Nothing is sent anywhere.`
          : `The company server cannot be reached right now. You can carry on with "${title}" on this computer${using}, and your message will be answered here. Nothing moves until you choose.`
      }
      confirmLabel="Continue on this computer"
      cancelLabel="Stay on the company server"
      onConfirm={() => answer(true)}
      disabled={!defaultModel}
    >
      {!defaultModel && <Callout tone="caution">No AI model is installed on this computer, so this conversation cannot continue here yet. Choose one in AI models.</Callout>}
    </ConfirmDialog>
  )
}

function ModelChoiceDialog() {
  const prompt = useStore((s) => s.modelChoice)
  const answer = useStore((s) => s.answerModelChoice)
  const installed = useStore((s) => s.installedModels)
  const defaultId = useStore((s) => s.settings.default_model_id)
  const removedId = useStore((s) => s.conversations.find((c) => c.id === s.modelChoice?.conversation_id)?.model_id)
  const [choice, setChoice] = useState<string | null>(null)
  const navigate = useNavigate()
  const valid = choice && installed.some((m) => m.id === choice) ? choice : null
  const selected = valid ?? (defaultId && installed.some((m) => m.id === defaultId) ? defaultId : null) ?? installed[0]?.id ?? null
  const open = !!prompt
  // "Standard · Qwen3 8B" when the catalogue still knows the removed model.
  const removedEntry = catalogueEntry(removedId)
  const removed = removedEntry ? modelLabel(removedEntry) : 'The AI model this conversation used'
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) answer(null)
      }}
      title="Which AI model should carry on?"
      description={`${removed} is no longer installed. Your message waits until you choose.`}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => answer(null)}>Cancel</Button>
          {installed.length === 0 ? (
            <Button variant="primary" onClick={() => { answer(null); navigate('/models') }}>Open AI models</Button>
          ) : (
            <Button variant="primary" onClick={() => answer(selected)} disabled={!selected}>Use this AI model</Button>
          )}
        </>
      }
    >
      {installed.length === 0 ? (
        <Callout tone="caution">No AI model is installed. Choose one in AI models, then send your message again. Your message is kept in the box.</Callout>
      ) : (
        <RadioGroup key={prompt?.conversation_id} value={selected ?? undefined} onValueChange={setChoice} className="flex flex-col gap-2" aria-label="AI model">
          {installed.map((m) => (
            <RadioCard key={m.id} value={m.id} title={modelLabel(m)} description={sizeBlurb(m.tier)} />
          ))}
        </RadioGroup>
      )}
    </Dialog>
  )
}
