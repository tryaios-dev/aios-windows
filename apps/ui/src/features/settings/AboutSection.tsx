import { useNavigate } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { useStore } from '@/lib/store'
import { ART } from '@/assets/icons'
import { Art } from '@/components/ui/art'
import { Wordmark } from '@/components/ui/brand'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/chips'
import { Ledger, SettingGroup, SettingPanel, SettingRow } from './SettingRow'

/**
 * What is in AIOS, in the order of the menu, then the two things that protect all of it.
 * Written out here on purpose: About must read the same whatever the setup screens list.
 */
const PARTS: Array<{ name: string; line: string; icon: string }> = [
  { icon: ART.activity, name: 'Activity', line: 'Everything your AI did, in plain words and in order. It holds none of what you wrote.' },
  { icon: ART.knowledge, name: 'My secure knowledge', line: 'The documents you want your AI to use. AIOS keeps an encrypted copy on this computer. Your original files stay where they are.' },
  { icon: ART.model, name: 'AI models', line: 'The AI itself, and newer versions as they come out. It runs on this computer, even with no internet.' },
  { icon: ART.skills, name: 'Skills', line: 'Extra abilities that run on this computer, such as translating or reading spreadsheets.' },
  { icon: ART.resources, name: 'Resources', line: 'More power for bigger jobs: cloud AI models and computing power by the hour. You approve everything that is sent.' },
]

const PROTECTION: Array<{ name: string; line: string; icon: string }> = [
  { icon: ART.encrypted, name: 'Secure storage', line: 'Everything AIOS keeps on this computer is encrypted, with backup and restore.' },
  { icon: ART.backup, name: 'Rules', line: 'What the AI may and may not do. Four are built in. The first: nothing leaves this computer unless you say so.' },
]

const NO_LICENCES: Array<{ name: string; role: string; licence: string }> = []

/** About: which version this is, what is in AIOS and how it is protected, licences and pilot support. */
export function AboutSection() {
  const version = useStore((s) => s.settings.app_version)
  // The open-source software and AI models in this build, as GET /system/info reports them.
  const licences = useStore((s) => s.live?.licences) ?? NO_LICENCES
  const navigate = useNavigate()

  return (
    <>
      <section aria-label="This version of AIOS" className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
        <div className="flex items-center gap-5 p-6">
          <div className="min-w-0 flex-1">
            <Wordmark height={24} />
            <p className="mt-2.5 flex flex-wrap items-center gap-x-2 text-sm leading-5 text-ink-soft">
              <span className="font-mono text-xs tracking-[0.02em] text-ink tabular">Version {version}</span>
              <span className="text-ink-30" aria-hidden>
                ·
              </span>
              Pilot version
            </p>
          </div>
        </div>
        <p className="border-t border-line-soft bg-paper-raised px-6 py-3 text-sm leading-5 text-ink-soft">Nothing leaves this computer unless you say so. AIOS goes online only to check for updates and to download an AI model you install.</p>
      </section>

      <SettingGroup title="What is in AIOS">
        <SettingPanel>
          <PartList parts={PARTS} />
        </SettingPanel>
      </SettingGroup>

      <SettingGroup title="How it is protected">
        <SettingPanel>
          <PartList parts={PROTECTION} />
        </SettingPanel>
      </SettingGroup>

      <SettingGroup title="Licences" description="Open-source software inside AIOS, and the AI models it can install.">
        <SettingPanel>
          <Ledger
            dense
            rows={licences.map((l) => ({
              rawKey: true,
              k: l.name,
              v: (
                <span className="flex items-center justify-between gap-4">
                  <span className="text-ink-soft">{l.role}</span>
                  <Badge mono>{l.licence}</Badge>
                </span>
              ),
            }))}
          />
        </SettingPanel>
      </SettingGroup>

      <SettingGroup title="Pilot support">
        <SettingPanel>
          <SettingRow
            label="Ask in the shared channel #aios-pilot"
            hint="If support asks for a diagnostic file, you can create one in Troubleshooting."
            control={
              <Button trailing={<ArrowRight className="size-3.5" />} onClick={() => navigate('/settings/troubleshooting')}>
                Open Troubleshooting
              </Button>
            }
          />
        </SettingPanel>
      </SettingGroup>
    </>
  )
}

function PartList({ parts }: { parts: Array<{ name: string; line: string; icon: string }> }) {
  return (
    <ul className="divide-y divide-line-soft">
      {parts.map((part) => (
        <li key={part.name} className="grid grid-cols-1 gap-x-6 gap-y-0.5 px-5 py-3 sm:grid-cols-[minmax(168px,32%)_1fr]">
          <span className="flex items-center gap-2.5 text-sm font-medium leading-5 text-ink">
            <Art src={part.icon} />
            {part.name}
          </span>
          <span className="text-sm leading-5 text-ink-soft">{part.line}</span>
        </li>
      ))}
    </ul>
  )
}
