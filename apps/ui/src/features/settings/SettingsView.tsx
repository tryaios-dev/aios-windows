import { NavLink, Navigate, useParams } from 'react-router'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/cn'
import { backupStatus } from '@/lib/words'
import { PageBody, PageHeader } from '@/components/ui/layout'
import { Tooltip } from '@/components/ui/overlays'
import { LEGACY_SECTIONS, SECTION_META, SETTINGS_SECTIONS, isSettingsSection, type SettingsSection } from './sections'
import { SectionHeader } from './SettingRow'
import { GeneralSection } from './GeneralSection'
import { BackupSection } from './BackupSection'
import { PrivacySection } from './PrivacySection'
import { ComputerSection } from './ComputerSection'
import { TroubleshootingSection } from './TroubleshootingSection'
import { AboutSection } from './AboutSection'

/**
 * Settings: a contents column on the left, one section at a time on the right.
 * Sections are named for what people come to do, not for the parts inside AIOS.
 * /settings opens General. A brass dot marks a section that wants attention.
 *
 * Both columns keep the same place for every section: the contents column has
 * a fixed width and the section heading always starts on the same line, so
 * moving between sections changes the words and nothing else.
 */
export function SettingsView() {
  const { section: param } = useParams()
  const updateReady = useStore((s) => !!s.settings.update_available)
  const lastBackupAt = useStore((s) => s.settings.last_backup_at)
  const backupLocation = useStore((s) => s.settings.backup_location)
  const needsAttention = useStore((s) => s.health.writer === 'unavailable' || s.health.engine === 'failed' || s.health.backend !== 'ok')

  if (param !== undefined && !isSettingsSection(param)) {
    const moved = LEGACY_SECTIONS[param]
    return <Navigate to={moved ? `/settings/${moved}` : '/settings'} replace />
  }
  const section: SettingsSection = param ?? 'general'
  const meta = SECTION_META[section]

  const backupTone = backupStatus({ last_backup_at: lastBackupAt, backup_location: backupLocation }).tone
  const dots: Partial<Record<SettingsSection, string>> = {
    ...(updateReady ? { general: 'An update is ready' } : {}),
    ...(backupTone !== 'ok' ? { backup: backupTone === 'none' ? 'No backup yet' : 'A backup is due' } : {}),
    ...(needsAttention ? { troubleshooting: 'Something needs a look' } : {}),
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings" description="Settings for AIOS on this computer. Each project keeps its own under Project settings." />
      <PageBody>
        <div className="flex flex-col gap-7 md:flex-row md:items-start md:gap-12">
          <nav aria-label="Settings sections" className="md:sticky md:top-7 md:w-56 md:shrink-0">
            <ul className="flex flex-wrap gap-1 md:flex-col md:gap-0.5">
              {SETTINGS_SECTIONS.map((id) => {
                const item = SECTION_META[id]
                const active = id === section
                const dot = dots[id]
                return (
                  <li key={id}>
                    <NavLink
                      // Bare /settings is General, so its link points there while that is the URL.
                      to={id === 'general' && param === undefined ? '/settings' : `/settings/${id}`}
                      end
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        // The label keeps one weight in both states, so nothing in the row changes width.
                        'group relative flex h-9 items-center gap-3 rounded-lg border px-3 text-sm font-medium transition-[background-color,border-color,color,box-shadow] duration-(--duration-micro) ease-(--ease-out)',
                        active ? 'border-line bg-white text-ink shadow-[0_1px_2px_rgba(22,33,27,0.05)]' : 'border-transparent text-ink-soft hover:bg-ink-6 hover:text-ink',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-2 bottom-2 -left-px w-0.5 rounded-full bg-green transition-opacity duration-(--duration-micro) ease-(--ease-out)',
                          active ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden
                      />
                      <img src={item.icon} alt="" aria-hidden draggable={false} className={cn('size-[18px] shrink-0 transition-[filter,opacity] duration-(--duration-micro)', active ? '' : 'opacity-80 saturate-[0.7] group-hover:opacity-100 group-hover:saturate-100')} />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {dot && (
                        <Tooltip content={dot} side="right">
                          <span className="flex size-4 shrink-0 items-center justify-center" role="img" aria-label={dot}>
                            <span className="size-1.5 rounded-full bg-brass ring-2 ring-brass/20" />
                          </span>
                        </Tooltip>
                      )}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* Remounts for each section so it arrives with a short fade. Nothing moves. */}
          <div key={section} className="min-w-0 flex-1 animate-fade">
            <SectionHeader title={meta.label} description={meta.description} />
            <div className="mt-7 flex flex-col gap-9">
              {section === 'general' && <GeneralSection />}
              {section === 'backup' && <BackupSection />}
              {section === 'privacy' && <PrivacySection />}
              {section === 'computer' && <ComputerSection />}
              {section === 'troubleshooting' && <TroubleshootingSection />}
              {section === 'about' && <AboutSection />}
            </div>
          </div>
        </div>
      </PageBody>
    </div>
  )
}
