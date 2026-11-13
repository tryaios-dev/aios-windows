import { useId, useState } from 'react'
import { RadioGroup as RRadio } from 'radix-ui'
import type { ResourceEntry } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, Dialog } from '@/components/ui/overlays'
import { Steps } from '@/features/skills/shared'
import { KindTile, PriceLines } from './ResourceParts'
import { DEFAULT_LIMIT, LIMIT_CHOICES, kindWords, placeOf } from './words'

/**
 * The trust step. Before a resource is linked the person sees who runs it and
 * where, what it costs, an optional monthly limit, and exactly what will
 * happen each time it is used, with a small copy of the question AIOS will
 * ask. Linking itself sends nothing.
 */
export function LinkDialog({ open, onOpenChange, resource, onLink }: { open: boolean; onOpenChange: (open: boolean) => void; resource: ResourceEntry | null; onLink: (resource: ResourceEntry, monthlyLimit: number | null) => void }) {
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  const limitLabel = useId()
  if (!resource) return null
  const amount = LIMIT_CHOICES.find((c) => c.value === limit)?.amount ?? null

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title={`Link ${resource.name} to my AI?`}
      description={resource.line}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button variant="primary" onClick={() => onLink(resource, amount)}>
            Link
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 pt-1">
        {/* What it is, who runs it and where, and what it costs. */}
        <div className="grid items-center gap-x-6 gap-y-3.5 rounded-lg border border-line bg-paper-raised p-4 sm:grid-cols-[minmax(0,1fr)_21.5rem]">
          <div className="flex min-w-0 items-start gap-3">
            <KindTile resource={resource} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium leading-5 text-ink">{kindWords(resource)}</div>
              <div className="mt-0.5 text-sm leading-5 text-ink-soft">
                Run by {resource.provider}. {resource.region}.
              </div>
            </div>
          </div>
          <PriceLines resource={resource} />
        </div>

        {/* An optional monthly limit. */}
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span id={limitLabel} className="text-sm font-medium text-ink">
              Monthly spending limit
            </span>
            <span className="text-xs leading-4.5 text-ink-50">Optional</span>
          </div>
          <p className="mt-0.5 text-xs leading-4.5 text-ink-50">AIOS stops and asks when you reach it.</p>
          <RRadio.Root value={limit} onValueChange={setLimit} aria-labelledby={limitLabel} className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {LIMIT_CHOICES.map((choice) => (
              <RRadio.Item
                key={choice.value}
                value={choice.value}
                className="flex h-9 items-center justify-center rounded-md border border-line bg-white text-sm font-medium tabular text-ink-soft transition-[border-color,background-color,color,box-shadow] duration-(--duration-micro) ease-(--ease-out) hover:border-line-strong hover:text-ink data-[state=checked]:border-green data-[state=checked]:bg-green-wash data-[state=checked]:text-green-dark data-[state=checked]:shadow-[0_0_0_1px_var(--color-green)]"
              >
                {choice.label}
              </RRadio.Item>
            ))}
          </RRadio.Root>
        </div>

        {/* What happens afterwards, with the question AIOS will ask. */}
        <section className="overflow-hidden rounded-xl border border-line" aria-labelledby={`${limitLabel}-after`}>
          <h3 id={`${limitLabel}-after`} className="border-b border-line-soft bg-paper-raised px-4 py-2.5 text-sm font-semibold text-ink">
            What happens when you use it
          </h3>
          <div className="grid gap-x-5 gap-y-4 p-4 sm:grid-cols-[minmax(0,1fr)_17.5rem]">
            <Steps className="pt-0.5" items={['Linking sends nothing.', 'Each time, AIOS shows you exactly what would be sent and where, and waits for you to allow it.', 'Everything sent is listed in Activity.']} />
            <ConsentPreview resource={resource} />
          </div>
        </section>
      </div>
    </Dialog>
  )
}

/**
 * A small, faithful copy of the question AIOS asks before anything leaves
 * this computer. It is a picture, not a control: nothing in it can be pressed.
 */
function ConsentPreview({ resource }: { resource: ResourceEntry }) {
  const question = `Send 6 messages from “Launch video script” to ${resource.name}, run by ${resource.provider} in ${placeOf(resource)}?`
  return (
    <figure>
      <div role="img" aria-label={`The question AIOS asks each time. This will leave your computer. ${question} Estimated cost €0.04. The choices are: Stay on this computer, or Allow once.`} className="rounded-lg bg-ink/[0.07] p-2.5">
        <div className="rounded-[10px] border border-line bg-white px-3.5 pb-3 pt-3 shadow-lift" aria-hidden>
          <div className="label-mono">This will leave your computer</div>
          <p className="mt-1.5 text-sm font-semibold leading-5 text-ink">{question}</p>
          <p className="mt-1 text-xs leading-4.5 text-ink-soft">
            Estimated cost <span className="font-mono tabular text-ink">€0.04</span>.
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-1.5">
            <span className="inline-flex h-7 items-center rounded-sm px-2 text-xs font-medium text-ink-soft">Stay on this computer</span>
            <span className="inline-flex h-7 items-center rounded-sm bg-green px-2.5 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(22,33,27,0.18)]">Allow once</span>
          </div>
        </div>
      </div>
      <figcaption className="mt-2 text-center text-xs leading-4.5 text-ink-50">What AIOS shows you each time</figcaption>
    </figure>
  )
}

/* ---------------- Unlink ---------------- */

export function UnlinkDialog({ open, onOpenChange, resource, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; resource: ResourceEntry | null; onConfirm: () => void }) {
  if (!resource) return null
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Unlink ${resource.name}?`}
      description={`Unlinking sends nothing. AIOS stops offering ${resource.name}, and you can link it again at any time.`}
      confirmLabel="Unlink"
      cancelLabel="Keep it linked"
      confirmVariant="destructive"
      onConfirm={onConfirm}
    />
  )
}
