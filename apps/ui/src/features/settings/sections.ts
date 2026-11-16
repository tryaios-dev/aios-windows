import { ART } from '@/assets/icons'

/** Sections of /settings/:section, in navigation order. Named for what people come here to do. */
export const SETTINGS_SECTIONS = ['general', 'backup', 'privacy', 'computer', 'troubleshooting', 'about'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export interface SectionMeta {
  label: string
  /** One line under the section heading saying what lives here. */
  description: string
  /** A colour icon from `@/assets/icons`. */
  icon: string
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  general: { label: 'General', description: 'Updates, and which version of AIOS this is.', icon: ART.settings },
  backup: { label: 'Backup and recovery', description: 'Keep a copy of your work away from this computer, and know how to get it back.', icon: ART.vault },
  privacy: { label: 'Privacy and connections', description: 'What stays on this computer, and the few times AIOS goes online.', icon: ART.privacy },
  computer: { label: 'This computer', description: 'How fast AIOS answers here, and what this computer has.', icon: ART.computer },
  troubleshooting: { label: 'Troubleshooting', description: 'Check that AIOS is working, and get help when it is not.', icon: ART.troubleshooting },
  about: { label: 'About', description: 'This version, what is in it, and who to ask.', icon: ART.about },
}

export function isSettingsSection(value: string | undefined): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value)
}

/** Section ids from before the regroup. Old links land on the section that now holds the same thing. */
export const LEGACY_SECTIONS: Record<string, SettingsSection> = {
  engine: 'computer',
  hardware: 'computer',
  network: 'privacy',
  health: 'troubleshooting',
  data: 'backup',
}
