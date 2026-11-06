/**
 * Simulated behaviour switches, from the prototype's review panel (not ported).
 * The defaults reproduce the pilot build. Change DEFAULT_SIM locally to see a state
 * such as an interrupted download or an unavailable evidence writer.
 */
export interface SimFlags {
  /** Operator configuration flag: the company provider exists only behind it (M-10). Off in the pilot build. */
  companyFlag: boolean;
  /** Whether the company server answers. Off simulates "Company unreachable" (M-09). */
  companyReachable: boolean;
  /** Lose the connection part-way through the next Company answer: partial answer, local continuation offered. */
  dropNextCompanyAnswer: boolean;
  /** Evidence writer process reachable. Off simulates evidence-pending markers and the health warning (F-05). */
  writerAvailable: boolean;
  /** Force a Vulkan crash on the next local answer so the GPU to CPU fallback shows (AC-09, D-06). */
  engineCrashNext: boolean;
  /** Fail the next download at 60% so the resume path shows (AC-02, I-03). */
  failNextDownload: boolean;
  /** Make the next package import fail its checksum check (AC-16). */
  failNextImport: boolean;
  /** A signed update is waiting on the feed (M-18). */
  updateAvailable: boolean;
  /** Slow machine profile: CPU-only timings and "Preparing context" on long prompts. */
  slowMachine: boolean;
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
};

export interface SimScenario {
  key: keyof SimFlags;
  label: string;
  description: string;
  /** One-shot switches reset themselves after they fire. */
  oneShot?: boolean | undefined;
  group: "Provider" | "Engine" | "Evidence" | "Delivery" | "Updates";
}

export const SIM_SCENARIOS: SimScenario[] = [
  {
    key: "companyFlag",
    group: "Provider",
    label: "Company provider flag (lab)",
    description:
      "Operator config flag. Shows the Company AI project toggle and move-to-Company flows. Off in the pilot build.",
  },
  {
    key: "companyReachable",
    group: "Provider",
    label: "Company server reachable",
    description: 'Turn off to see "Continue this conversation locally?" when a Company conversation sends.',
  },
  {
    key: "dropNextCompanyAnswer",
    group: "Provider",
    label: "Drop next Company answer",
    description: "Connection lost mid-answer. The partial answer is saved and local continuation is offered.",
    oneShot: true,
  },
  {
    key: "engineCrashNext",
    group: "Engine",
    label: "Crash GPU build on next answer",
    description: "Vulkan build fails; the engine restarts on CPU and tells the user, with a link to Safe mode.",
    oneShot: true,
  },
  {
    key: "slowMachine",
    group: "Engine",
    label: "Slow machine (8 GB, CPU only)",
    description: 'CPU timings and the "Preparing context" indicator on long conversations.',
  },
  {
    key: "writerAvailable",
    group: "Evidence",
    label: "Evidence writer available",
    description: "Turn off to see evidence-pending markers on answers and the health warning.",
  },
  {
    key: "failNextDownload",
    group: "Delivery",
    label: "Interrupt next download",
    description: "Drops the connection at 60%. The download resumes from where it stopped.",
    oneShot: true,
  },
  {
    key: "failNextImport",
    group: "Delivery",
    label: "Fail next package import",
    description: "The package fails its checksum check and is rejected with the reason.",
    oneShot: true,
  },
  {
    key: "updateAvailable",
    group: "Updates",
    label: "Update waiting on the feed",
    description: "A signed update is ready. Shows the notice in Settings and the sidebar dot.",
  },
];
