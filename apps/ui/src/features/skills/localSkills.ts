import { create } from 'zustand'
import { useStore } from '@/lib/store'
import type { InstalledSkill, SkillEntry } from '@/lib/types'

/**
 * Skills the person added from a file of their own. In this prototype there is
 * one file to choose, and what was added is remembered until AIOS is reset.
 * Adding and removing are recorded in Activity in the same words as any other
 * skill.
 */

/** Stands in for the Windows file dialog: the file the person "chooses". */
export const OWN_SKILL_FILE = { name: 'invoice-reader.aios-skill', size_bytes: 2_412_544 }

export const OWN_SKILL: SkillEntry = {
  id: 'own-invoice-reader',
  name: 'Invoice reader',
  line: 'Pull the supplier, dates, amounts and VAT out of invoices.',
  detail: 'Reads the invoices you choose and lists the supplier, invoice number, date, net amount, VAT and total for each one, ready to copy into a spreadsheet.',
  category: 'Documents',
  publisher: 'Added by you',
  licence: 'Not stated',
  open_source: false,
  size_bytes: OWN_SKILL_FILE.size_bytes,
  version: '0.4.0',
  uses: ['The conversation you are in', 'Documents you choose from My secure knowledge'],
  example: 'List the totals and VAT from the March invoices.',
}

interface LocalSkillsState {
  added: InstalledSkill[]
  add: () => void
  remove: (id: string) => void
  setEnabled: (id: string, enabled: boolean) => void
}

const record = (event_type: 'skill_installed' | 'skill_removed', payload: Record<string, string>) => useStore.getState()._appendEvent({ event_type, actor: 'user', payload })

export const useLocalSkills = create<LocalSkillsState>()((set, get) => ({
  added: [],

  add: () => {
    if (get().added.some((s) => s.id === OWN_SKILL.id)) return
    set((s) => ({ added: [...s.added, { id: OWN_SKILL.id, installed_at: new Date().toISOString(), enabled: true }] }))
    record('skill_installed', { skill: OWN_SKILL.name, publisher: OWN_SKILL.publisher, version: OWN_SKILL.version, licence: OWN_SKILL.licence })
  },

  remove: (id) => {
    if (!get().added.some((s) => s.id === id)) return
    set((s) => ({ added: s.added.filter((x) => x.id !== id) }))
    record('skill_removed', { skill: OWN_SKILL.name })
  },

  setEnabled: (id, enabled) => set((s) => ({ added: s.added.map((x) => (x.id === id ? { ...x, enabled } : x)) })),
}))

// The prototype's reset buttons announce a reset; skills added from a file go with it.
if (typeof window !== 'undefined') {
  window.addEventListener('aios:reset', () => useLocalSkills.setState({ added: [] }))
}
