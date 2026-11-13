import { useId, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, Building2, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { isLowering, useStore } from '@/lib/store'
import type { Classification, Project } from '@/lib/types'
import { cn } from '@/lib/cn'
import { pluralise } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { CLASS_META, ClassChip } from '@/components/ui/chips'
import { Checkbox, Field, FieldError, Hint, Input, Label, RadioCard, RadioGroup } from '@/components/ui/fields'
import { Callout } from '@/components/ui/feedback'
import { ConfirmDialog, Dialog } from '@/components/ui/overlays'
import { Reveal } from '@/features/settings/shared'

const CLASSES: Classification[] = ['restricted', 'internal', 'public']

/** The glossary sensitivity note. The same sentence for every label. */
export const SENSITIVITY_NOTE = CLASS_META.restricted.detail

/** A quiet "show more" row. Closed by default so the first view stays calm; it opens with a smooth change of height. */
export function Disclosure({ label, children, defaultOpen = false, className }: { label: string; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="-ml-2 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-50 transition-colors duration-(--duration-micro) ease-(--ease-out) hover:bg-ink-6 hover:text-ink"
      >
        <ChevronRight className={cn('size-3.5 transition-transform duration-(--duration-panel) ease-(--ease-out)', open && 'rotate-90')} strokeWidth={2} aria-hidden />
        {label}
      </button>
      <Reveal open={open} id={id} className="pt-2">
        {children}
      </Reveal>
    </div>
  )
}

/** Radio cards for picking a sensitivity label. Shared by create and change. */
export function ClassPicker({ value, onChange, current }: { value: Classification; onChange: (c: Classification) => void; current?: Classification }) {
  return (
    <RadioGroup value={value} onValueChange={(v) => onChange(v as Classification)} className="flex flex-col gap-2" aria-label="Sensitivity">
      {CLASSES.map((c) => {
        const meta = CLASS_META[c]
        return (
          <RadioCard
            key={c}
            value={c}
            title={
              <span className="flex items-center gap-2">
                <ClassChip value={c} />
                {current === c && <span className="text-xs font-normal text-ink-50">Current</span>}
              </span>
            }
            description={meta.summary}
          />
        )
      })}
    </RadioGroup>
  )
}

/* ---------------- Create project ---------------- */

/**
 * Asks for a name. The sensitivity label is shown with its default (Restricted)
 * so nobody is surprised by it later, and can be changed in place.
 */
export function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [cls, setCls] = useState<Classification>('restricted')
  const [choosing, setChoosing] = useState(false)
  const [missing, setMissing] = useState(false)
  const pickerId = useId()

  // A fresh form each time the dialog opens: reset during render when `open` flips, not in an effect.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName('')
      setCls('restricted')
      setChoosing(false)
      setMissing(false)
    }
  }

  const submit = async () => {
    if (!name.trim()) {
      setMissing(true)
      return
    }
    const project = await api.projects.create({ name: name.trim(), classification: cls })
    if (!project) return
    onOpenChange(false)
    navigate(`/projects/${project.id}`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="sm"
      title="New project"
      description="A project keeps related conversations together."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>Create project</Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-name">Name</Label>
          <Input
            id="project-name"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setMissing(false)
            }}
            placeholder="For example, Harbourline lease review"
            maxLength={80}
            autoComplete="off"
            aria-invalid={missing || undefined}
          />
          {missing ? <FieldError>Give the project a name first.</FieldError> : <Hint>You can rename it at any time.</Hint>}
        </div>

        {/* Decision D7: a new project asks for a name only. It is Restricted unless the person opens this. */}
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => setChoosing((v) => !v)}
            aria-expanded={choosing}
            aria-controls={pickerId}
            className="group -ml-1 inline-flex h-7 w-fit items-center gap-1.5 rounded-sm px-1 text-sm text-ink-soft transition-colors duration-(--duration-micro) hover:text-ink"
          >
            <ChevronRight className={cn('size-3.5 text-ink-50 transition-transform duration-(--duration-panel) ease-(--ease-out)', choosing && 'rotate-90')} aria-hidden />
            More options
          </button>
          <Reveal open={choosing} id={pickerId} className="pt-3 pb-1">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-ink">Sensitivity</span>
              <ClassPicker value={cls} onChange={setCls} />
              <Hint>{SENSITIVITY_NOTE}</Hint>
            </div>
          </Reveal>
        </div>
      </form>
    </Dialog>
  )
}

/* ---------------- Rename ---------------- */

export function RenameDialog({ open, onOpenChange, title, label, initial, onSubmit, placeholder }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; label: string; initial: string; onSubmit: (name: string) => void; placeholder?: string }) {
  const [value, setValue] = useState(initial)
  // Start from the current name each time the dialog opens, or when that name changes underneath it.
  const resetKey = open ? `open:${initial}` : 'closed'
  const [seenKey, setSeenKey] = useState(resetKey)
  if (seenKey !== resetKey) {
    setSeenKey(resetKey)
    if (open) setValue(initial)
  }
  const submit = () => {
    if (!value.trim()) return
    onSubmit(value.trim())
    onOpenChange(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!value.trim() || value.trim() === initial}>Save</Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label={label} htmlFor="rename-input">
          <Input id="rename-input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} maxLength={80} onFocus={(e) => e.target.select()} />
        </Field>
      </form>
    </Dialog>
  )
}

/* ---------------- Change sensitivity ---------------- */

export function ChangeClassDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project: Project }) {
  const navigate = useNavigate()
  const toast = useStore((s) => s.toast)
  const [cls, setCls] = useState<Classification>(project.classification)
  const [ack, setAck] = useState(false)

  // Start from the project's current label each time the dialog opens, or when that label changes underneath it.
  const resetKey = open ? `open:${project.classification}` : 'closed'
  const [seenKey, setSeenKey] = useState(resetKey)
  if (seenKey !== resetKey) {
    setSeenKey(resetKey)
    if (open) {
      setCls(project.classification)
      setAck(false)
    }
  }

  const lowering = isLowering(project.classification, cls)
  const changed = cls !== project.classification
  const label = CLASS_META[cls].label

  const choose = (next: Classification) => {
    setCls(next)
    setAck(false)
  }

  const submit = async () => {
    const out = await api.projects.reclassify(project.id, cls)
    if (!out) return
    const { project: result, reviewedCopy } = out
    onOpenChange(false)
    if (reviewedCopy) {
      toast({ kind: 'success', title: 'Copy made', description: `"${result.name}" is labelled ${label}. "${project.name}" is as it was.`, action: { label: 'Open the copy', href: `/projects/${result.id}` } })
      navigate(`/projects/${result.id}`)
    } else {
      toast({ kind: 'success', title: `This project is now ${label}`, description: 'New conversations take the new label. Existing ones keep the label they were given.' })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change sensitivity"
      description={<span>{project.name} is labelled <ClassChip value={project.classification} className="align-middle" />.</span>}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!changed || (lowering && !ack)}>
            {lowering ? 'Make a copy' : 'Change sensitivity'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ClassPicker value={cls} onChange={choose} current={project.classification} />
        {changed && lowering && (
          <Callout tone="caution" className="animate-fade">
            <p>AIOS makes a copy with the new label and leaves the original as it was.</p>
            <div className="mt-3 flex items-start gap-2.5 text-sm text-ink">
              <Checkbox id="class-ack" checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />
              <Label htmlFor="class-ack" className="cursor-pointer font-normal">I have looked through it and it suits {label}.</Label>
            </div>
          </Callout>
        )}
        {changed && !lowering && (
          <Callout tone="info" className="animate-fade">New conversations take the new label. Existing ones keep the label they were given.</Callout>
        )}
        <Hint>{SENSITIVITY_NOTE}</Hint>
      </div>
    </Dialog>
  )
}

/* ---------------- Company server for new conversations (lab only) ---------------- */

export function CompanyAiDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project: Project }) {
  const company = useStore((s) => s.health.company)
  const toast = useStore((s) => s.toast)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="This will leave your computer"
      title="Use Company AI for new conversations in this project"
      description={
        <span>
          New conversations in this project will be sent to the company server at <span className="font-mono text-xs text-ink">{company.base_url.replace('https://', '')}</span>. Conversations you already have stay where they are until you move them.
        </span>
      }
      confirmLabel="Use the company server"
      cancelLabel="Stay on this computer"
      onConfirm={() => {
        api.projects.setCompanyAi(project.id, true, true)
        onOpenChange(false)
        toast({ kind: 'info', title: 'New conversations will use the company server', description: `New conversations in "${project.name}" run on the company server while it can be reached.` })
      }}
    >
      <div className="flex items-center gap-3 rounded-lg border border-line bg-paper px-3 py-2.5 text-sm">
        <span className="flex size-8 items-center justify-center rounded-md bg-ink text-paper"><Building2 className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">{company.model_name} on the company server</div>
          <div className="text-xs text-ink-50">{company.reachable ? 'It can be reached now.' : 'It cannot be reached at the moment. New conversations will start on this computer.'}</div>
        </div>
        <ClassChip value={project.classification} />
      </div>
      <p className="mt-3 text-xs leading-4.5 text-ink-50">Activity keeps a note of this change. Turning it off later never asks and sends nothing.</p>
    </ConfirmDialog>
  )
}

/* ---------------- Delete / archive ---------------- */

export function DeleteProjectDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project: Project }) {
  const navigate = useNavigate()
  const toast = useStore((s) => s.toast)
  const convCount = useStore((s) => s.conversations.filter((c) => c.project_id === project.id).length)
  const what = convCount === 0 ? 'This removes the project from this computer.' : `This removes the project and its ${pluralise(convCount, 'conversation')} from this computer.`
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete "${project.name}"?`}
      description={`${what} It cannot be undone. Activity keeps a note that it was deleted, never what it said.`}
      confirmLabel="Delete project"
      confirmVariant="destructive"
      onConfirm={() => {
        api.projects.remove(project.id)
        onOpenChange(false)
        toast({ kind: 'info', title: 'Project deleted', description: 'Activity keeps a note that it was deleted.' })
        navigate('/')
      }}
    >
      <p className="rounded-lg border border-line bg-paper-raised px-3.5 py-2.5 text-sm leading-5 text-ink-soft">To keep a copy, save the project as a file first. To put it out of the way without losing anything, archive it instead.</p>
    </ConfirmDialog>
  )
}

/** The three labels side by side, each with its one line. */
export function ClassLegend({ className }: { className?: string }) {
  return (
    <div className={cn('grid gap-2 sm:grid-cols-3', className)}>
      {CLASSES.map((c) => (
        <div key={c} className="rounded-lg border border-line bg-paper px-3 py-2.5">
          <ClassChip value={c} />
          <p className="mt-1.5 text-xs leading-4.5 text-ink-soft">{CLASS_META[c].summary}</p>
        </div>
      ))}
    </div>
  )
}

/** Shown on a project that was made as a copy with a new label. */
export function ReviewedCopyNote({ project }: { project: Project }) {
  const original = useStore((s) => s.projects.find((p) => p.id === project.derived_from_project_id))
  const navigate = useNavigate()
  if (!project.derived_from_project_id) return null
  return (
    <Callout tone="neutral" compact>
      {original ? (
        <span className="flex flex-wrap items-center gap-1.5">
          A copy of
          <button className="inline-flex items-center gap-1 font-medium text-ink hover:underline" onClick={() => navigate(`/projects/${original.id}`)}>
            {original.name} <ArrowRight className="size-3" />
          </button>
          made with a new label.
        </span>
      ) : (
        'A copy of another project, made with a new label. The original has since been deleted.'
      )}
    </Callout>
  )
}
