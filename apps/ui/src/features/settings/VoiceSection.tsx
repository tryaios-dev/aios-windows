import { useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Download, RotateCw, X } from 'lucide-react'
import { bridge } from '@/bridge'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import { formatBytes } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/fields'
import { Progress } from '@/components/ui/feedback'
import { LANGUAGES_BY_NAME, MAX_VOICE_LANGUAGES, languageName } from '@/features/voice/languages'
import { useVoiceStatus } from '@/features/voice/useVoiceModel'
import { PanelNote, SettingGroup, SettingPanel, SettingRow } from './SettingRow'

/** Voice: the languages the person speaks (main first), and the speech model on this computer. */
export function VoiceSection() {
  const chosen = useStore((s) => s.settings.voice_languages) ?? []
  const save = (next: string[]) => api.settings.update({ voice_languages: next.length ? next : null })
  const add = (code: string) => save([...chosen, code])
  const remove = (code: string) => save(chosen.filter((c) => c !== code))
  const makeMain = (code: string) => save([code, ...chosen.filter((c) => c !== code)])
  const options = LANGUAGES_BY_NAME.filter(([code]) => !chosen.includes(code)).map(([value, label]) => ({ value, label }))

  return (
    <>
      <SettingGroup
        title="Languages you speak"
        description="Voice listens for these. Put the one you speak most first: short phrases that could be in more than one language are written in it."
      >
        <SettingPanel>
          {chosen.length === 0 ? (
            <PanelNote>None chosen. Voice guesses the language of each phrase, which can go wrong on short phrases, for example writing an Italian “ciao” as English.</PanelNote>
          ) : (
            <ol className="flex flex-col" aria-label="Languages you speak, main first">
              {chosen.map((code, i) => (
                <li key={code} className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0">
                  <span className="min-w-0 flex-1 text-sm font-medium text-ink">
                    {languageName(code)}
                    {i === 0 && <span className="ml-2 label-mono text-green">Main</span>}
                  </span>
                  {i > 0 && (
                    <Button size="sm" variant="ghost" leading={<ArrowUp className="size-3.5" />} onClick={() => makeMain(code)}>
                      Make main
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" aria-label={`Remove ${languageName(code)}`} onClick={() => remove(code)}>
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ol>
          )}
          {chosen.length < MAX_VOICE_LANGUAGES && (
            <SettingRow
              htmlFor="settings-voice-add-language"
              label={chosen.length ? 'Add another language' : 'Add a language'}
              hint={chosen.length ? `Up to ${MAX_VOICE_LANGUAGES}.` : 'Start with the one you speak most.'}
              control={<Select id="settings-voice-add-language" value={undefined} onValueChange={add} options={options} placeholder="Choose a language" size="sm" />}
            />
          )}
        </SettingPanel>
      </SettingGroup>
      <SpeechModel />
    </>
  )
}

/** The speech model: here, on its way, or missing with a way to get it. */
function SpeechModel() {
  const status = useVoiceStatus()
  const queryClient = useQueryClient()
  const model = status?.model
  const download = async () => {
    queryClient.setQueryData(['voice-status'], await bridge().voice.downloadModel())
  }

  let line = 'Checking…'
  let action: React.ReactNode = null
  let bar: React.ReactNode = null
  if (model?.status === 'ready') line = `On this computer, ${formatBytes(model.total_bytes)}. Speech is turned into text here and never leaves it.`
  else if (model?.status === 'downloading' || model?.status === 'verifying') {
    const pct = model.total_bytes ? (model.received_bytes / model.total_bytes) * 100 : 0
    line = model.status === 'verifying' ? 'Checking it is the genuine, unmodified file' : `Downloading: ${formatBytes(model.received_bytes)} of ${formatBytes(model.total_bytes)}`
    bar = <Progress value={pct} indeterminate={model.status === 'verifying'} label="Speech model download" />
  } else if (model?.status === 'failed') {
    line = 'The download stopped. What arrived is kept; it carries on from there.'
    action = (
      <Button size="sm" variant="primary" leading={<RotateCw className="size-3.5" />} onClick={download}>
        Try again
      </Button>
    )
  } else if (model?.status === 'missing') {
    line = `Not on this computer yet. It is about ${formatBytes(model.total_bytes)}, downloaded once from its publisher and checked before use.`
    action = (
      <Button size="sm" variant="primary" leading={<Download className="size-3.5" />} onClick={download}>
        Download
      </Button>
    )
  }
  return (
    <SettingGroup title="Speech model" description="What turns your voice into text. It runs on this computer.">
      <SettingPanel>
        <SettingRow label="Whisper small, multilingual" hint={line} control={action ?? undefined} align="start">
          {bar}
        </SettingRow>
      </SettingPanel>
    </SettingGroup>
  )
}
