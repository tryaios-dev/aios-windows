import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Cpu, HardDrive, MemoryStick, Monitor } from 'lucide-react'
import { useStore } from '@/lib/store'
import type { Hardware, ModelTier } from '@/lib/types'
import { formatBytes } from '@/lib/format'
import { fitOnThisComputer, modelLabel, sizeBlurb, sizeWord } from '@/lib/words'
import { MINIMUM_PROFILE } from '@/data/catalogue'
import { Badge } from '@/components/ui/chips'
import { RadioCard, RadioGroup } from '@/components/ui/fields'
import { KeyValue, Mono, SectionLabel } from '@/components/ui/layout'
import { Disclosure, DrawnCheck, Plate, Sequence, StepBody, StepFooter, StepHeading } from '../SetupFrame'
import { useSequence } from '../useSequence'
import { availableTiers, cannotRunReason, tierEntry } from '../tiers'
import { platform } from '@/lib/platform'

const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1]

const CHECKS = [
  { icon: Cpu, label: 'Processor' },
  { icon: MemoryStick, label: 'Memory' },
  { icon: Monitor, label: 'Graphics card' },
  { icon: HardDrive, label: 'Free space' },
] as const

/** What each row reports once it has ticked, as a figure. */
function checkDetail(label: (typeof CHECKS)[number]['label'], hw: Hardware): string {
  switch (label) {
    case 'Processor':
      return `${hw.cores} cores`
    case 'Memory':
      return `${hw.ram_gb} GB`
    case 'Graphics card':
      return hw.gpu ? `${hw.gpu.vram_gb} GB` : 'none found'
    case 'Free space':
      return `${hw.free_disk_gb} GB`
  }
}

/** The one sentence the check resolves to. */
function resultSentence(tier: ModelTier, hw: Hardware): string {
  const { fit } = fitOnThisComputer(tierEntry(tier), hw)
  const name = `the ${sizeWord(tier)} AI model`
  return fit === 'well' ? `This computer can run ${name} well.` : `This computer can run ${name}, but slowly.`
}

/**
 * Step 2. The check runs by itself and resolves to one sentence. Nothing here
 * is a required decision: the specification and the other size sit behind
 * two disclosures.
 */
export function ComputerStep({ note, tier, recommended, onTierChange, checked, onChecked, onBack, onContinue }: { note?: string; /** The size AIOS will set up. Null when this computer cannot run one. */ tier: ModelTier | null; recommended: ModelTier | null; onTierChange: (t: ModelTier) => void; checked: boolean; onChecked: () => void; onBack: () => void; onContinue: () => void }) {
  const hw = useStore((s) => s.hardware)
  const { done, finished } = useSequence([420, 380, 440, 380], checked)

  useEffect(() => {
    if (finished && !checked) onChecked()
  }, [finished, checked, onChecked])

  const entry = tier ? tierEntry(tier) : null

  return (
    <>
      <StepBody>
        <StepHeading note={note} title="Your computer" lede="AIOS looks at this computer to choose an AI model that suits it. Nothing is sent anywhere." />

        <AnimatePresence mode="wait" initial={false}>
          {!finished ? (
            <motion.section key="checking" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
              <SectionLabel>Checking this computer</SectionLabel>
              <Plate className="mt-3 py-2 sm:py-2">
                <Sequence
                  label="Checking this computer"
                  done={done}
                  items={CHECKS.map(({ icon: Icon, label }) => ({
                    label: (
                      <span className="inline-flex items-center gap-2.5">
                        <Icon className="size-3.5 text-ink-50" aria-hidden strokeWidth={1.75} />
                        {label}
                      </span>
                    ),
                    detail: checkDetail(label, hw),
                  }))}
                />
              </Plate>
            </motion.section>
          ) : (
            <motion.div key="result" className="flex flex-col gap-6" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE }}>
              {tier && entry ? (
                <Plate as="section" aria-label="Result" className="flex items-start gap-4 sm:gap-5">
                  <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-green text-white" aria-hidden>
                    <DrawnCheck className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1" role="status">
                    <p className="text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">{resultSentence(tier, hw)}</p>
                    <p className="mt-2 text-md leading-6 text-ink-soft">{sizeBlurb(tier)}</p>
                    {/* What AIOS found, at a glance. The full list is under "Why?". */}
                    <dl className="mt-5 grid grid-cols-3 divide-x divide-line-soft rounded-lg border border-line-soft bg-paper-raised/70">
                      {[
                        { k: 'Memory', v: `${hw.ram_gb} GB` },
                        { k: 'Graphics card', v: hw.gpu ? `${hw.gpu.vram_gb} GB` : 'Not used' },
                        { k: 'Free space', v: `${hw.free_disk_gb} GB` },
                      ].map((f) => (
                        <div key={f.k} className="min-w-0 px-3.5 py-2.5">
                          <dt className="label-mono truncate">{f.k}</dt>
                          <dd className="mt-0.5 truncate text-base font-medium leading-6 tabular text-ink">{f.v}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm leading-5 text-ink-soft">
                      <span>
                        AIOS will set up <span className="font-medium text-ink">{modelLabel(entry)}</span>
                      </span>
                      <Mono className="tabular">{formatBytes(entry.size_bytes)} to download</Mono>
                    </p>
                  </div>
                </Plate>
              ) : (
                <Plate as="section" aria-label="Result" className="flex flex-col gap-5">
                  <div role="status">
                    <p className="text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">This computer cannot run an AI model.</p>
                    <p className="mt-2 text-md leading-6 text-ink-soft">
                      An AI model needs at least {MINIMUM_PROFILE.ram_gb} GB of memory and {MINIMUM_PROFILE.free_disk_gb} GB of free space. This computer has {hw.ram_gb} GB of memory and {hw.free_disk_gb} GB of free space.
                    </p>
                  </div>
                  <p className="border-t border-line-soft pt-4 text-sm leading-5 text-ink">AIOS will open without chat. Your projects, search and backups still work.</p>
                </Plate>
              )}

              <div className="flex flex-col gap-2">
                <Disclosure label="Why?">
                  <p className="mb-3 text-sm leading-5 text-ink-soft">This is what AIOS found. An AI model needs enough memory to run and enough free space to be stored. A graphics card makes answers arrive faster.</p>
                  <KeyValue
                    dense
                    rows={[
                      { k: 'Memory', v: <span className="tabular">{hw.ram_gb} GB</span> },
                      { k: 'Graphics card', v: hw.gpu ? <span className="tabular">{hw.gpu.name}, {hw.gpu.vram_gb} GB</span> : 'None that AIOS can use. AIOS will use your processor.' },
                      { k: 'Free space', v: <span className="tabular">{hw.free_disk_gb} GB</span> },
                      { k: `${platform.os} version`, v: hw.os },
                    ]}
                  />
                </Disclosure>

                {tier && (
                  <Disclosure label="Choose a different AI model" hint={recommended && tier !== recommended ? 'Changed' : undefined}>
                    <RadioGroup value={tier} onValueChange={(v) => onTierChange(v as ModelTier)} className="flex flex-col gap-3" aria-label="AI model">
                      {availableTiers().map((t) => {
                        const option = tierEntry(t)
                        const reason = cannotRunReason(option, hw)
                        return (
                          <RadioCard
                            key={t}
                            value={t}
                            disabled={!!reason}
                            className="bg-white p-4"
                            title={
                              <span className="inline-flex flex-wrap items-center gap-2">
                                {modelLabel(option)}
                                {recommended === t && <Badge tone="green">Recommended</Badge>}
                              </span>
                            }
                            meta={<Mono className="tabular">{formatBytes(option.size_bytes)}</Mono>}
                            description={sizeBlurb(t)}
                          >
                            {reason ? (
                              <span className="mt-1.5 block text-xs leading-4.5 text-brass-text">{reason}</span>
                            ) : (
                              <span className="mt-1.5 block text-xs leading-4.5 text-ink-50">{fitOnThisComputer(option, hw).line}</span>
                            )}
                          </RadioCard>
                        )
                      })}
                    </RadioGroup>
                    <p className="mt-3 text-xs leading-4.5 text-ink-50">You can change this later in AI models.</p>
                  </Disclosure>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </StepBody>
      <StepFooter onBack={onBack} primary={{ label: 'Continue', onClick: onContinue }} />
    </>
  )
}
