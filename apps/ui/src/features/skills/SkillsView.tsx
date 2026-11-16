import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '@/lib/api'
import { notInThisBuild } from '@/bridge/live'
import { useExtras } from '@/lib/extras'
import { pluralise } from '@/lib/format'
import type { SkillEntry } from '@/lib/types'
import { PageBody, PageHeader } from '@/components/ui/layout'
import { OwnSkillCard, SkillCard } from './SkillCard'
import { OwnSkillDialog, RemoveSkillDialog, SkillReviewDialog } from './SkillDialogs'
import { SkillRow, type OwnedSkill } from './SkillRow'
import { SectionHeading } from './shared'
import { useSubject } from './useSubject'

const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1]

/**
 * Add skills to my AI (GET /skills). Two questions, in order: what can my AI already do,
 * and what else could it do. Every skill is reviewed before it is added (what
 * it does, what it can use, who made it), and there is a way in for a skill
 * of your own.
 */
export function SkillsView() {
  const installed = useExtras((s) => s.installedSkills)
  const installs = useExtras((s) => s.skillInstalls)
  // From the backend (GET /skills): what AIOS lists, and what was added from a file.
  const SKILLS = useExtras((s) => s.skillCatalogue)

  // Skills whose adding began on this visit. Their cards stay in place and say "Added"; their rows draw a tick.
  const [addedHere, setAddedHere] = useState<ReadonlySet<string>>(() => new Set())
  const review = useSubject<{ skill: SkillEntry; mode: 'add' | 'view' }>()
  const removal = useSubject<OwnedSkill>()
  const own = useSubject<true>()

  // A skill still being added from an earlier visit is treated the same way, so its card does not vanish when it finishes.
  const arriving = Object.keys(installs).filter((id) => !addedHere.has(id))
  if (arriving.length > 0) setAddedHere((prev) => new Set([...prev, ...arriving]))

  const installedIds = useMemo(() => new Set(installed.map((s) => s.id)), [installed])

  /** What the AI has: what came with AIOS first, then what was added, oldest first, so a new one arrives at the foot of the list. */
  const owned = useMemo<OwnedSkill[]>(() => {
    const included: OwnedSkill[] = SKILLS.filter((s) => s.included).map((entry) => ({ entry }))
    const added: OwnedSkill[] = []
    for (const item of installed) {
      const entry = SKILLS.find((s) => s.id === item.id)
      if (entry && !entry.included) added.push(entry.own ? { entry, installed: item, own: true } : { entry, installed: item })
    }
    added.sort((a, b) => (a.installed?.installed_at ?? '').localeCompare(b.installed?.installed_at ?? ''))
    return [...included, ...added]
  }, [SKILLS, installed])

  /** What can still be added, plus anything added on this visit. */
  const catalogue = useMemo(() => SKILLS.filter((s) => !s.included && !s.own && (!installedIds.has(s.id) || addedHere.has(s.id))), [SKILLS, installedIds, addedHere])

  const includedCount = owned.filter((s) => !s.installed).length
  const addedCount = owned.length - includedCount

  const markAddedHere = (id: string) => setAddedHere((prev) => new Set(prev).add(id))

  const add = (skill: SkillEntry) => {
    // Listed as in the design, but it needs an engine this build does not have: say so, add nothing.
    if (skill.available === false) {
      notInThisBuild(skill.name)
      review.setOpen(false)
      return
    }
    markAddedHere(skill.id)
    void api.skills.install(skill.id)
    review.setOpen(false)
  }

  const addOwn = (id: string, path: string) => {
    markAddedHere(id)
    void api.skills.installFile(path)
    own.setOpen(false)
  }

  const setEnabled = (skill: OwnedSkill, enabled: boolean) => void api.skills.setEnabled(skill.entry.id, enabled)

  const remove = () => {
    const skill = removal.subject
    if (skill) void api.skills.remove(skill.entry.id)
    removal.setOpen(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Add skills to my AI" description="A skill is an extra ability, like reading spreadsheets or translating, that runs on this computer." />
      <PageBody>
        <div className="flex flex-col gap-10 pb-6">
          {/* ---------------- What it can do now ---------------- */}
          <section aria-labelledby="skills-owned">
            <SectionHeading id="skills-owned" title="Your AI can already" right={addedCount > 0 ? `${includedCount} included · ${addedCount} added` : `${includedCount} included`}>
              What comes with every AIOS, and the skills you have added. Added skills can be turned off or removed.
            </SectionHeading>
            <ul className="mt-4 overflow-hidden rounded-xl border border-line bg-white shadow-card" aria-label="Skills your AI has">
              <AnimatePresence initial={false}>
                {owned.map((skill) => (
                  <motion.li
                    key={skill.entry.id}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: EASE }}
                    className="overflow-hidden border-t border-line-soft first:border-t-0"
                  >
                    <SkillRow
                      skill={skill}
                      justAdded={addedHere.has(skill.entry.id)}
                      onToggle={(enabled) => setEnabled(skill, enabled)}
                      onView={() => review.show({ skill: skill.entry, mode: 'view' })}
                      onRemove={() => removal.show(skill)}
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>

          {/* ---------------- What can be added ---------------- */}
          <section aria-labelledby="skills-add">
            <SectionHeading id="skills-add" title="Add a skill" right={catalogue.length > 0 ? pluralise(catalogue.length, 'skill') : undefined}>
              Add only the ones you need. Most are open source, so anyone can check how they work, and AIOS shows you what a skill can use before you add it.
            </SectionHeading>
            {catalogue.length === 0 && <p className="mt-4 rounded-xl border border-line bg-paper-raised px-5 py-4 text-sm leading-5 text-ink-soft">You have added every skill AIOS lists. New ones arrive with AIOS updates.</p>}
            <ul className="mt-4 grid gap-3 md:grid-cols-2" aria-label="Skills you can add">
              {catalogue.map((skill) => (
                <li key={skill.id}>
                  <SkillCard skill={skill} install={installs[skill.id]} added={installedIds.has(skill.id)} onReview={() => review.show({ skill, mode: 'add' })} />
                </li>
              ))}
              <li className={catalogue.length % 2 === 0 ? 'md:col-span-2' : undefined}>
                <OwnSkillCard wide={catalogue.length % 2 === 0} onOpen={() => own.show(true)} />
              </li>
            </ul>
          </section>
        </div>
      </PageBody>

      <SkillReviewDialog open={review.open} onOpenChange={review.setOpen} skill={review.subject?.skill ?? null} mode={review.subject?.mode ?? 'add'} onAdd={add} />
      <RemoveSkillDialog open={removal.open} onOpenChange={removal.setOpen} skill={removal.subject?.entry ?? null} onConfirm={remove} />
      <OwnSkillDialog key={own.run} open={own.open} onOpenChange={own.setOpen} onAdd={addOwn} />
    </div>
  )
}
