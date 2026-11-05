import type { LucideIcon } from "lucide-react";
import { Activity, Cpu, Database, Globe, HardDrive, Info, SlidersHorizontal } from "lucide-react";

/** Sections of /settings/:section, in navigation order (design brief, routes table). */
export const SETTINGS_SECTIONS = ["general", "engine", "network", "hardware", "health", "data", "about"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export interface SectionMeta {
  label: string;
  /** One line under the section heading saying what lives here. */
  description: string;
  icon: LucideIcon;
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  general: {
    label: "General",
    description: "Update and catalogue checks, and which version this is.",
    icon: SlidersHorizontal,
  },
  engine: { label: "Engine", description: "The local engine, Safe mode and the default model.", icon: Cpu },
  network: { label: "Network", description: "Every host AIOS may contact, and when.", icon: Globe },
  hardware: { label: "Hardware", description: "What this machine has and how fast it answers.", icon: HardDrive },
  health: { label: "Health", description: "Component state, logs and support.", icon: Activity },
  data: {
    label: "Data and recovery",
    description: "Where your data lives, how to back it up and how to restore.",
    icon: Database,
  },
  about: { label: "About", description: "This build, its limits, licences and pilot support.", icon: Info },
};

export function isSettingsSection(value: string | undefined): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}
