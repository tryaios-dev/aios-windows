import { platform } from '@/lib/platform'

/**
 * Simulated behaviour switches. These exist only in the prototype so reviewers
 * can see every state the MVP specifies without a backend. The floating
 * "Prototype scenarios" panel reads and writes them through the store.
 */
export interface SimFlags {
  /** Operator configuration flag: the company provider exists only behind it (M-10). Off in the pilot build. */
  companyFlag: boolean
  /** Whether the company server answers. Off simulates "Company unreachable" (M-09). */
  companyReachable: boolean
  /** Lose the connection part-way through the next Company answer: partial answer, local continuation offered. */
  dropNextCompanyAnswer: boolean
  /** Evidence writer process reachable. Off simulates evidence-pending markers and the health warning (F-05). */
  writerAvailable: boolean
  /** Force a Vulkan crash on the next local answer so the GPU to CPU fallback shows (AC-09, D-06). */
  engineCrashNext: boolean
  /** Fail the next download at 60% so the resume path shows (AC-02, I-03). */
  failNextDownload: boolean
  /** Make the next package import fail its checksum check (AC-16). */
  failNextImport: boolean
  /** A signed update is waiting on the feed (M-18). */
  updateAvailable: boolean
  /** Slow machine profile: CPU-only timings and "Preparing context" on long prompts. */
  slowMachine: boolean
  /** Windows no longer holds the keys (profile reset). The app cannot open its data and offers Restore. */
  keysMissing: boolean
  /** The next downloaded model fails its check: the file is removed and the user is told. */
  failNextVerify: boolean
  /** The next backup cannot reach its destination (drive unplugged). */
  failNextBackup: boolean
  /** The next update fails during install; the data is put back as it was. */
  failNextUpdate: boolean
  /** No backup has ever been made: shows the reminder on Home and in the sidebar. */
  neverBackedUp: boolean
  /** A newer AI model is in the catalogue: the "New" tag on AI models turns green. */
  newModelOut: boolean
  /** No microphone can be found when the person tries to speak a message. */
  micUnavailable: boolean
}

export const DEFAULT_SIM: SimFlags = {
  companyFlag: false,
  companyReachable: true,
  dropNextCompanyAnswer: false,
  writerAvailable: true,
  engineCrashNext: false,
  failNextDownload: false,
  failNextImport: false,
  updateAvailable: false,
  slowMachine: false,
  keysMissing: false,
  failNextVerify: false,
  failNextBackup: false,
  failNextUpdate: false,
  neverBackedUp: false,
  newModelOut: true,
  micUnavailable: false,
}

export interface SimScenario {
  key: keyof SimFlags
  label: string
  description: string
  /** One-shot switches reset themselves after they fire. */
  oneShot?: boolean
  group: 'Company server' | 'AI model' | 'Activity' | 'Downloads' | 'Updates' | 'Protection' | 'Voice'
}

export const SIM_SCENARIOS: SimScenario[] = [
  { key: 'micUnavailable', group: 'Voice', label: 'No microphone', description: 'Pressing the microphone in a message box shows "AIOS cannot find a microphone" instead of listening.' },
  { key: 'companyFlag', group: 'Company server', label: 'Company provider flag (lab)', description: 'Operator config flag. Shows the Company AI project toggle and move-to-Company flows. Off in the pilot build.' },
  { key: 'companyReachable', group: 'Company server', label: 'Company server reachable', description: 'Turn off to see "Continue this conversation locally?" when a Company conversation sends.' },
  { key: 'dropNextCompanyAnswer', group: 'Company server', label: 'Drop next Company answer', description: 'Connection lost mid-answer. The partial answer is saved and local continuation is offered.', oneShot: true },
  { key: 'engineCrashNext', group: 'AI model', label: 'Crash GPU build on next answer', description: 'The graphics-card build fails; AIOS restarts on the processor and tells the user, with a link to Compatibility mode.', oneShot: true },
  { key: 'newModelOut', group: 'AI model', label: 'A newer AI model is out', description: 'The catalogue lists a newer version of the Standard model. The New tag on AI models turns green until the page is opened.' },
  { key: 'slowMachine', group: 'AI model', label: 'Slow machine (8 GB, CPU only)', description: 'CPU timings and the "Preparing context" indicator on long conversations.' },
  { key: 'writerAvailable', group: 'Activity', label: 'Activity recording running', description: 'Turn off to see "Not recorded yet" on answers and the paused notice.' },
  { key: 'failNextDownload', group: 'Downloads', label: 'Interrupt next download', description: 'Drops the connection at 60%. The download resumes from where it stopped.', oneShot: true },
  { key: 'failNextImport', group: 'Downloads', label: 'Damage next project file', description: 'The next project file added fails its check and nothing is added.', oneShot: true },
  { key: 'updateAvailable', group: 'Updates', label: 'Update waiting on the feed', description: 'A signed update is ready. Shows the notice in Settings and the sidebar dot.' },
  { key: 'failNextUpdate', group: 'Updates', label: 'Fail next update', description: 'The update does not complete; the data is put back as it was and the user is told.', oneShot: true },
  { key: 'failNextVerify', group: 'Downloads', label: 'Damage next downloaded model', description: 'The file fails its check after download. AIOS removes it and says so.', oneShot: true },
  { key: 'neverBackedUp', group: 'Protection', label: 'No backup made yet', description: 'Shows the backup reminder on Home and a dot on Settings in the menu.' },
  { key: 'failNextBackup', group: 'Protection', label: 'Backup drive unavailable', description: 'The next backup cannot reach its folder. Nothing is changed and the user is told.', oneShot: true },
  { key: 'keysMissing', group: 'Protection', label: `${platform.os} lost the keys`, description: `Simulates a ${platform.os} profile reset. AIOS cannot open its data and leads into Restore.` },
]
