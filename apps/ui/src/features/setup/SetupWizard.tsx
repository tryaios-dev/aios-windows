import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '@/lib/api'
import { APP_VERSION, selectRecommendedTier, useStore } from '@/lib/store'
import type { ModelTier } from '@/lib/types'
import { SetupFrame, type RailStep } from './SetupFrame'
import { TIER_ENTRY, usableTier } from './tiers'
import { WelcomeStep } from './steps/WelcomeStep'
import { ComputerStep } from './steps/ComputerStep'
import { SettingUpStep } from './steps/SettingUpStep'
import { ProtectStep, type ProtectDraft } from './steps/ProtectStep'
import { ReadyStep } from './steps/ReadyStep'

/**
 * First-run wizard (MVP 4.1; tickets K-05, K-03, I-02; decision D13).
 * Five steps and one required decision: saving the recovery key. Renders
 * without the app shell.
 *
 * Progress is kept through `api.firstRun.setProgress`, so closing AIOS half
 * way returns to the same step. If it was closed while an unconfirmed key
 * was on screen, the wizard opens on "Protect your work" with a new key.
 */

type StepId = 'welcome' | 'computer' | 'setting-up' | 'protect' | 'ready'

const ORDER: StepId[] = ['welcome', 'computer', 'setting-up', 'protect', 'ready']
const PROTECT = ORDER.indexOf('protect')

const LABELS: Record<StepId, string> = {
  welcome: 'Welcome',
  computer: 'Your computer',
  'setting-up': 'Setting up',
  protect: 'Protect your work',
  ready: 'Ready',
}

const RESUMED = 'Picking up where you left off.'

/** Where to open, read once from what was saved when AIOS last closed. */
function readStart(): { index: number; keyPending: boolean } {
  const { ui, hardware } = useStore.getState()
  const keyPending = ui.setup.keyShownUnconfirmed
  let index = keyPending ? PROTECT : Math.max(0, Math.min(ORDER.length - 1, Math.round(ui.setup.step) || 0))
  // "Setting up" has nothing to do on a computer that cannot run an AI model.
  if (ORDER[index] === 'setting-up' && usableTier(selectRecommendedTier(useStore.getState()), hardware) === null) index = PROTECT
  return { index, keyPending }
}

export function SetupWizard() {
  const hw = useStore((s) => s.hardware)
  const recommended = usableTier(useStore(selectRecommendedTier), hw)
  const [start] = useState(readStart)
  const [index, setIndex] = useState(start.index)
  const [moved, setMoved] = useState(false)
  const [choice, setChoice] = useState<ModelTier | null>(null)
  const [machineChecked, setMachineChecked] = useState(start.index > 1)
  const [skippedModel, setSkippedModel] = useState(false)
  const [protect, setProtect] = useState<ProtectDraft>({ typed: '' })
  const [keyConfirmed, setKeyConfirmed] = useState(false)
  const [newKeyNotice, setNewKeyNotice] = useState(false)
  // A key shown before AIOS was closed must not be trusted: issue a new one, once.
  const [reissue, setReissue] = useState(start.keyPending)

  const step = ORDER[index]
  const tier = choice ?? recommended
  const belowMinimum = tier === null
  // "Setting up" is passed over when there is no AI model this computer can run.
  const isSkipped = (id: StepId) => id === 'setting-up' && belowMinimum

  // Remember the step, so setup can be picked up again after AIOS is closed.
  useEffect(() => {
    api.firstRun.setProgress({ step: index })
  }, [index])

  const move = (dir: 1 | -1) => {
    let i = index + dir
    while (i >= 0 && i < ORDER.length && isSkipped(ORDER[i])) i += dir
    if (i < 0 || i >= ORDER.length) return
    setMoved(true)
    setIndex(i)
  }
  const back = () => move(-1)
  const next = () => move(1)

  const onChecked = useCallback(() => setMachineChecked(true), [])
  const onIssued = useCallback(
    (isNew: boolean) => {
      setReissue(false)
      // Setup had already reached the key once, so the one on screen replaces it. Say so.
      if (isNew && start.index >= PROTECT) setNewKeyNotice(true)
    },
    [start.index],
  )
  const onProtectDraft = useCallback((patch: Partial<ProtectDraft>) => setProtect((d) => ({ ...d, ...patch })), [])

  const rail: RailStep[] = ORDER.map((id, i) => ({
    id,
    label: LABELS[id],
    // The rail says "skipped" only once the check has shown why.
    state: isSkipped(id) && (machineChecked || index > i) ? 'skipped' : i < index ? 'done' : i === index ? 'current' : 'todo',
  }))

  // Said once, on the step setup reopened at.
  const note = !moved && start.index > 0 ? RESUMED : undefined

  let content: ReactNode
  switch (step) {
    case 'welcome':
      content = <WelcomeStep onContinue={next} />
      break
    case 'computer':
      content = (
        <ComputerStep
          note={note}
          tier={tier}
          recommended={recommended}
          onTierChange={setChoice}
          checked={machineChecked}
          onChecked={onChecked}
          onBack={back}
          onContinue={() => {
            // Continue is never locked; leaving early accepts what AIOS chose.
            setMachineChecked(true)
            // Hold the size from here on: free space changes once the AI model is on disk.
            if (tier) setChoice(tier)
            next()
          }}
        />
      )
      break
    case 'setting-up':
      content = tier ? (
        <SettingUpStep key={tier} note={note} tier={tier} skipped={skippedModel} onSkip={() => setSkippedModel(true)} onUnskip={() => setSkippedModel(false)} onBack={back} onContinue={next} />
      ) : null
      break
    case 'protect':
      content = (
        <ProtectStep
          note={note}
          reissue={reissue}
          onIssued={onIssued}
          confirmed={keyConfirmed}
          newKeyNotice={newKeyNotice}
          draft={protect}
          onDraft={onProtectDraft}
          onBack={back}
          onContinue={() => {
            setKeyConfirmed(true)
            api.firstRun.setProgress({ keyShownUnconfirmed: false })
            next()
          }}
        />
      )
      break
    case 'ready':
      content = <ReadyStep note={note} preferredModelId={tier && !skippedModel ? TIER_ENTRY[tier] : null} onBack={back} />
      break
  }

  return (
    <SetupFrame steps={rail} current={index} rail={step !== 'welcome'} eyebrow={`AIOS ${APP_VERSION} · pilot version`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          className="flex min-h-0 flex-1 flex-col"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3, transition: { duration: 0.12 } }}
          transition={{ duration: 0.24, ease: [0.2, 0.7, 0.2, 1] }}
        >
          {content}
        </motion.div>
      </AnimatePresence>
    </SetupFrame>
  )
}
