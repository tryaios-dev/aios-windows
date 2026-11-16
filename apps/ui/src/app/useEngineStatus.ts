import { useStore } from '@/lib/store'
import { modelLabelById } from '@/lib/words'
import type { DotTone } from '@/components/ui/chips'

export interface EngineStatus {
  tone: DotTone
  pulse: boolean
  label: string
  detail: string
}

/** One place that turns the AI model's state into the words every screen uses (docs/GLOSSARY.md). */
export function useEngineStatus(): EngineStatus {
  const health = useStore((s) => s.health)
  const installed = useStore((s) => s.installedModels)
  const modelId = useStore((s) => s.health.loaded_model_id ?? s.settings.default_model_id)
  const model = modelLabelById(modelId, installed)
  const using = health.engine_build === 'cpu' ? 'using your processor' : 'using your graphics card'

  if (installed.length === 0 || health.engine === 'no_model') return { tone: 'neutral', pulse: false, label: 'No AI model installed', detail: 'Chat needs one. Everything else works.' }
  switch (health.engine) {
    case 'ready':
      return { tone: 'green', pulse: false, label: 'Ready', detail: `${model}, ${using}` }
    case 'generating':
      return { tone: 'green', pulse: true, label: 'Answering', detail: `${model}, ${using}` }
    case 'loading':
      return { tone: 'brass', pulse: true, label: 'Starting up', detail: `Getting ${model} ready` }
    case 'failed':
      return { tone: 'brass', pulse: true, label: 'Switching to a slower mode', detail: 'Your graphics card stopped responding' }
    case 'idle_unloaded':
    case 'not_started':
    default:
      return { tone: 'green', pulse: false, label: 'Ready', detail: `${model} is resting. It starts when you send a message.` }
  }
}

export function useWriterStatus() {
  const writer = useStore((s) => s.health.writer)
  const pending = useStore((s) => s.health.evidence_pending)
  if (writer === 'unavailable') return { tone: 'brass' as DotTone, label: 'Activity recording is paused', detail: pending ? `It will catch up by itself. ${pending} waiting.` : 'It will catch up by itself.' }
  return { tone: 'green' as DotTone, label: 'Recording activity', detail: 'Every action is added to the record' }
}
