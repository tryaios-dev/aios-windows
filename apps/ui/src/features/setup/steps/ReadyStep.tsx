import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'motion/react'
import { ArrowUpRight, FilePlus2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import { formatDateTime } from '@/lib/format'
import { backupStatus, modelLabel, speedWords, waitWords } from '@/lib/words'
import { STARTERS, type Starter } from '@/data/stack'
import { cn } from '@/lib/cn'
import { ART, STARTER_ART, modelLogo } from '@/assets/icons'
import { ArtTile } from '@/components/ui/art'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/feedback'
import { KeyValue, Mono, SectionLabel } from '@/components/ui/layout'
import { Disclosure, Plate, StepBody, StepFooter, StepHeading } from '../SetupFrame'

const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1]

/**
 * Step 5. Where everything is, in the order of the menu, each with one live
 * fact. Then how fast answers will arrive, where backups stand, and four
 * ready-made requests to try. The last setup screen is also the first useful one.
 */
export function ReadyStep({ note, preferredModelId, onBack }: { note?: string; /** The AI model set up in step 3, when there was one. */ preferredModelId: string | null; onBack: () => void }) {
  const navigate = useNavigate()
  const model = useStore((s) => s.installedModels.find((m) => m.id === preferredModelId) ?? s.installedModels.find((m) => m.id === s.settings.default_model_id) ?? s.installedModels[0])
  const benchmark = useStore((s) => s.hardware.benchmark)
  const build = useStore((s) => s.health.engine_build)
  const writer = useStore((s) => s.health.writer)
  const settings = useStore((s) => s.settings)
  const hasModel = !!model
  const [measuring, setMeasuring] = useState(hasModel)
  const [leaving, setLeaving] = useState(false)
  const ran = useRef(false)

  // One short speed test, once, when there is an AI model to test.
  useEffect(() => {
    if (!hasModel || ran.current) return
    ran.current = true
    setMeasuring(true)
    void api.system.benchmark().then(() => setMeasuring(false))
  }, [hasModel])

  const backup = backupStatus(settings)
  const speed = speedWords(benchmark)
  const wait = waitWords(benchmark)

  /** Where everything is, in the order of the menu: the last setup screen teaches the first thing to know about the app. */
  const places: Array<{ icon: string; name: string; line: string; quiet?: boolean }> = [
    { icon: ART.knowledge, name: 'My secure knowledge', line: 'Add the documents you want your AI to use.' },
    { icon: model ? modelLogo(model.name) : ART.model, name: 'AI models', line: model ? `${modelLabel(model)} is installed.` : 'None yet. Chat needs one.', quiet: !hasModel },
    { icon: ART.skills, name: 'Add skills to my AI', line: 'New abilities, such as translating or reading spreadsheets.' },
    { icon: ART.resources, name: 'Add resources to my AI', line: 'More power for bigger jobs, when you choose.' },
    { icon: ART.activity, name: 'Activity', line: writer === 'ok' ? 'Everything your AI does, in plain words.' : 'Recording is paused. It will catch up by itself.' },
    { icon: backup.tone === 'none' ? ART.backupMissing : ART.backup, name: 'Backup', line: backup.tone === 'none' ? 'Not set up yet. Settings › Backup and recovery.' : 'Settings › Backup and recovery.' },
  ]

  const finish = () => {
    setLeaving(true)
    api.firstRun.complete({ installedModelId: model?.id ?? null })
  }

  const open = () => {
    finish()
    navigate('/')
  }

  const startTask = (starter: Starter) => {
    finish()
    const projects = api.projects.list()
    const project = projects[0]
    if (!project) {
      navigate('/')
      return
    }
    const conversation = api.conversations.create(project.id, starter.conversationTitle)
    navigate(`/projects/${project.id}/c/${conversation.id}?draft=${encodeURIComponent(starter.id)}`)
  }

  return (
    <>
      <StepBody>
        <StepHeading note={note} title="AIOS is ready." rule />

        <div className="flex flex-col gap-8">
          <section aria-labelledby="ready-parts">
            <SectionLabel>
              <span id="ready-parts">Where everything is</span>
            </SectionLabel>
            <Plate className="mt-3 p-0 sm:p-0">
              <ul className="grid grid-cols-1 sm:grid-cols-2">
                {places.map((place, i) => (
                  <motion.li key={place.name} className={cn('flex items-start gap-3.5 border-line-soft px-5 py-4', i > 0 && 'border-t', i === 1 && 'sm:border-t-0', i % 2 === 0 && 'sm:border-r')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease: EASE, delay: 0.06 + i * 0.05 }}>
                    <ArtTile src={place.icon} size="lg" dimmed={place.quiet} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold leading-6 text-ink">{place.name}</span>
                      <span className="mt-0.5 block text-sm leading-5 text-ink-soft">{place.line}</span>
                    </span>
                  </motion.li>
                ))}
              </ul>
            </Plate>
            <p className="mt-3 px-1 text-xs leading-4.5 text-ink-50">All of these are in the menu on the left, one click away.</p>
          </section>

          <section aria-labelledby="ready-knowledge" className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl border border-green/25 bg-green-wash px-5 py-5 sm:px-6">
            <div className="min-w-[min(100%,16rem)] flex-1">
              <h2 id="ready-knowledge" className="text-lg font-semibold leading-6 text-ink">
                First, give your AI your documents
              </h2>
              <p className="mt-1 text-sm leading-5 text-ink-soft">Add the PDFs and files you work with. AIOS keeps an encrypted copy on this computer, and your originals stay where they are.</p>
            </div>
            <Button variant="primary" disabled={leaving} leading={<FilePlus2 className="size-4" />} onClick={() => { finish(); navigate('/knowledge') }} className="shrink-0">
              Add documents
            </Button>
          </section>

          <section aria-labelledby="ready-expect">
            <SectionLabel>
              <span id="ready-expect">What to expect</span>
            </SectionLabel>
            <Plate tone="paper" className="mt-3 p-0 sm:p-0">
              <ul className="divide-y divide-line-soft">
                <li className="flex items-start gap-4 px-5 py-4 sm:px-6">
                  <ArtTile src={ART.speed} dimmed={!hasModel} />
                  <div className="min-w-0 flex-1 pt-0.5" aria-live="polite">
                    {!hasModel ? (
                      <>
                        <p className="text-sm font-medium leading-5 text-ink">Chat is off until you add an AI model</p>
                        <p className="mt-0.5 text-sm leading-5 text-ink-soft">Add one from AI models when you are ready. Your projects, search and backups work now.</p>
                      </>
                    ) : measuring ? (
                      <p className="flex items-center gap-2 pt-1 text-sm leading-5 text-ink-50">
                        <Spinner className="size-3.5" label="Checking" />
                        Checking how fast answers arrive…
                      </p>
                    ) : (
                      <>
                        <p className="text-sm font-medium leading-5 text-ink">{speed.line}</p>
                        {wait && <p className="mt-0.5 text-sm leading-5 text-ink-soft">{wait}</p>}
                      </>
                    )}
                  </div>
                </li>
                <li className="flex items-start gap-4 px-5 py-4 sm:px-6">
                  <ArtTile src={ART.vault} />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-sm font-medium leading-5 text-ink">{backup.label}</p>
                    <p className="mt-0.5 text-sm leading-5 text-ink-soft">
                      {backup.detail}
                      {backup.tone !== 'ok' && settings.backup_location && (
                        <>
                          {' '}
                          Backups will go to <Mono className="break-all text-ink">{settings.backup_location}</Mono>.
                        </>
                      )}
                      {backup.tone === 'none' && !settings.backup_location && ' Home will remind you to choose a place for backups.'}
                    </p>
                  </div>
                </li>
              </ul>
            </Plate>
            {hasModel && !measuring && benchmark && (
              <Disclosure label="Details" className="mt-2">
                <KeyValue
                  dense
                  rows={[
                    { k: 'AI model', v: modelLabel(model) },
                    { k: 'Running on', v: build === 'cpu' ? 'AIOS is using your processor' : 'AIOS is using your graphics card' },
                    { k: 'Tokens per second', v: <Mono className="tabular text-ink">{benchmark.tokens_per_second.toFixed(1)}</Mono> },
                    { k: 'Time to first token', v: <Mono className="tabular text-ink">{(benchmark.time_to_first_token_ms / 1000).toFixed(1)} s</Mono> },
                    { k: 'Measured', v: formatDateTime(benchmark.run_at) },
                  ]}
                />
              </Disclosure>
            )}
          </section>

          {hasModel && (
            <section aria-labelledby="ready-starters">
              <SectionLabel>
                <span id="ready-starters">Try one of these</span>
              </SectionLabel>
              <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {STARTERS.map((starter, i) => (
                  <motion.li key={starter.id} className="flex" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE, delay: 0.2 + i * 0.05 }}>
                    <button
                      type="button"
                      disabled={leaving}
                      onClick={() => startTask(starter)}
                      className="group flex w-full items-start gap-3.5 rounded-xl border border-line bg-white p-4 text-left shadow-card transition-[border-color,box-shadow,transform] duration-(--duration-panel) ease-(--ease-out) hover:-translate-y-px hover:border-green/40 hover:shadow-lift active:translate-y-0 disabled:cursor-not-allowed"
                    >
                      <ArtTile src={STARTER_ART[starter.id] ?? ART.conversation} size="lg" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2 text-base font-semibold leading-6 text-ink">
                          {starter.title}
                          <ArrowUpRight className="size-4 shrink-0 text-ink-30 transition-colors duration-(--duration-micro) group-hover:text-green" aria-hidden />
                        </span>
                        <span className="mt-0.5 block text-sm leading-5 text-ink-soft">{starter.line}</span>
                      </span>
                    </button>
                  </motion.li>
                ))}
              </ul>
              <p className="mt-3 px-1 text-xs leading-4.5 text-ink-50">Each one opens a conversation with the request written for you, ready to edit.</p>
            </section>
          )}
        </div>
      </StepBody>
      <StepFooter onBack={onBack} primary={{ label: 'Open AIOS', onClick: open, loading: leaving, arrow: false }} />
    </>
  )
}
