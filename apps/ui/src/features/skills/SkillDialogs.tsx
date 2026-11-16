import { useEffect, useRef, useState } from 'react'
import type { SkillFileCheck } from '@aios/bridge-contract'
import { api } from '@/lib/api'
import { FolderOpen, Puzzle } from 'lucide-react'
import { formatBytes } from '@/lib/format'
import type { SkillEntry } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/feedback'
import { ConfirmDialog, Dialog } from '@/components/ui/overlays'
import { ProgressBar } from '@/components/app/InstallProgress'
import { DrawnCheck } from '@/features/settings/shared'
import { RunsHere, SkillFacts, SkillTile, UsesList } from './SkillParts'
import { SmoothHeight, Steps } from './shared'

/* ---------------- Review before adding ---------------- */

/**
 * The step between "Add" and a skill being added: what it does, what it can
 * use, where it runs and who made it. A skill never gets access to anything
 * without the person having seen this. The same view, without the button,
 * shows what an added skill can use.
 */
export function SkillReviewDialog({ open, onOpenChange, skill, mode, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; skill: SkillEntry | null; mode: 'add' | 'view'; onAdd?: (skill: SkillEntry) => void }) {
  if (!skill) return null
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow={mode === 'add' ? 'Before you add it' : 'Added skill'}
      title={
        <span className="flex items-center gap-3">
          <SkillTile id={skill.id} category={skill.category} />
          {skill.name}
        </span>
      }
      description={skill.detail}
      footer={
        mode === 'add' ? (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Not now
            </Button>
            <Button variant="primary" onClick={() => onAdd?.(skill)}>
              Add skill
            </Button>
          </>
        ) : (
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        )
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <UsesList uses={skill.uses} />
        <RunsHere />
        <SkillFacts skill={skill} className="pt-1" />
      </div>
    </Dialog>
  )
}

/* ---------------- Remove ---------------- */

export function RemoveSkillDialog({ open, onOpenChange, skill, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; skill: SkillEntry | null; onConfirm: () => void }) {
  if (!skill) return null
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${skill.name}?`}
      description="Your AI will no longer be able to do this. Your conversations and documents are not touched, and you can add the skill again at any time."
      confirmLabel="Remove skill"
      cancelLabel="Keep it"
      confirmVariant="destructive"
      onConfirm={onConfirm}
    />
  )
}

/* ---------------- Add your own ---------------- */

type OwnStep = 'choose' | 'checking' | 'review'

/**
 * A skill from a file. The person chooses the file in the system dialog, AIOS checks it, and the
 * same review appears as for any listed skill. Nothing is added before that.
 */
export function OwnSkillDialog({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: (id: string, path: string) => void }) {
  const [step, setStep] = useState<OwnStep>('choose')
  const [chosen, setChosen] = useState<{ path: string; check: SkillFileCheck } | null>(null)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  const [fileName, setFileName] = useState('')
  const choose = async () => {
    const path = await api.skills.chooseFile()
    if (!path || !alive.current) return
    setFileName(path.split(/[\\/]/).at(-1) ?? path)
    setStep('checking')
    const check = await api.skills.checkFile(path)
    if (!alive.current) return
    setChosen(check ? { path, check } : null)
    setStep(check ? 'review' : 'choose')
  }

  const OWN_SKILL = chosen?.check.entry
  const OWN_SKILL_FILE = { name: chosen?.check.file_name ?? fileName, size_bytes: OWN_SKILL?.size_bytes ?? 0 }
  const wasAdded = chosen?.check.already_added ?? false

  const reviewing = step === 'review'

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add your own skill"
      description={
        <>
          A skill is a file ending <span className="font-mono text-xs tracking-[0.02em] text-ink">.aios-skill</span>. A colleague may have given you one, or you may have written it yourself.
        </>
      }
      footer={
        reviewing ? (
          wasAdded ? (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Not now
              </Button>
              <Button variant="primary" onClick={() => chosen && onAdd(chosen.check.entry.id, chosen.path)}>
                Add skill
              </Button>
            </>
          )
        ) : undefined
      }
    >
      <SmoothHeight gutter>
        {step === 'choose' ? (
          <div className="pt-1">
            <Steps items={['You choose the file.', 'AIOS checks it and shows you what it wants to use.', 'It can run only after you have seen that and added it.']} />
            <div className="mt-5 flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-line-strong bg-paper-raised/70 px-5 py-6 text-center">
              <Button variant="primary" leading={<FolderOpen className="size-4" />} onClick={() => void choose()}>
                Choose a skill file
              </Button>
              <p className="text-xs leading-4.5 text-ink-50">Nothing is added until you say so.</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pt-1">
            {/* The file that was chosen, and where the check has got to. */}
            <div className="rounded-lg border border-line bg-paper-raised px-3.5 py-3">
              <div className="flex items-center gap-3">
                <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-ink-soft [&>svg]:size-4 [&>svg]:stroke-[1.75]">
                  <Puzzle />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs tracking-[0.02em] text-ink">{OWN_SKILL_FILE.name}</div>
                  {OWN_SKILL_FILE.size_bytes > 0 && <div className="text-xs leading-4.5 tabular text-ink-50">{formatBytes(OWN_SKILL_FILE.size_bytes)}</div>}
                </div>
                <span role="status" className="shrink-0 text-sm leading-5">
                  {reviewing ? (
                    <span className="flex items-center gap-1.5 font-medium text-green">
                      <DrawnCheck />
                      Checked
                    </span>
                  ) : (
                    <span className="text-ink-soft">Checking it</span>
                  )}
                </span>
              </div>
              {!reviewing && <ProgressBar size="sm" indeterminate label="Checking the skill file" className="mt-3" />}
            </div>

            {reviewing && OWN_SKILL && (
              <div className="flex animate-fade flex-col gap-4">
                <div className="flex items-start gap-3.5">
                  <SkillTile id={OWN_SKILL.id} category={OWN_SKILL.category} />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-md font-semibold text-ink">{OWN_SKILL.name}</h3>
                    <p className="mt-0.5 text-sm leading-5 text-ink-soft">{OWN_SKILL.detail}</p>
                  </div>
                </div>
                <UsesList uses={OWN_SKILL.uses} />
                <RunsHere />
                <SkillFacts skill={OWN_SKILL} className="pt-1" />
                {wasAdded && (
                  <Callout tone="neutral" compact>
                    This skill is already added. It is in your list.
                  </Callout>
                )}
              </div>
            )}
          </div>
        )}
      </SmoothHeight>
    </Dialog>
  )
}
