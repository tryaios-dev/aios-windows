/**
 * Endpoint façade: the seam between screens and the backend. One function per MVP 9.3 local API
 * endpoint. Every call goes to the backend through `window.aios` (`@/bridge`), and `@/bridge/live`
 * loads the backend's answers into the store the screens read. The renderer never holds a port or
 * a token (SR-08).
 *
 * Not in the backend yet, so refused with a plain message and nothing changed: backup, a new
 * recovery key, My secure knowledge, skills and resources.
 */
import { errorCode } from '@aios/bridge-contract'
import { bridge } from '@/bridge'
import {
  applySettings,
  change,
  loadMessages,
  messageFor,
  notInThisBuild,
  refreshConversation,
  refreshConversations,
  refreshDownloads,
  refreshEvents,
  refreshHealthQuietly,
  refreshModels,
  refreshProjects,
  refreshSettings,
  refreshStatus,
  refreshWorkspace,
  reportFailure,
  toConversation,
  toProject,
} from '@/bridge/live'
import { useStore } from './store'
import type {
  Classification,
  Conversation,
  EvidenceExportResult,
  ExportResult,
  ImportResult,
  Project,
  ProviderType,
  SearchHit,
  Settings,
} from './types'

const s = () => useStore.getState()

export type SendResult =
  | { ok: true }
  | { ok: false; reason: 'no_model' | 'too_large' | 'busy' | 'company_unreachable' | 'model_missing' | 'error'; detail?: string }
export type RestoreResult = { ok: true; epoch: number | null } | { ok: false; error: string }
export type ImportOutcome = { ok: true; result: ImportResult } | { ok: false; error: string }

/** The settings a person can change; the rest are results of checks. */
export type SettingsChange = Partial<Pick<Settings, 'update_check' | 'catalogue_check' | 'safe_mode_cpu' | 'default_model_id'>>

/** Characters in a recovery key without hyphens: 9 groups of 4 (Recovery Package v1). */
export const RECOVERY_KEY_LENGTH = 36

/** Suggested file name for a project file: the project name, safe as a file name on every OS. */
function packageFileName(projectId: string): string {
  const name = s().projects.find((p) => p.id === projectId)?.name ?? 'project'
  const safe =
    name
      .replace(/[^A-Za-z0-9 ._-]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || 'project'
  return `${safe}.aiosproj`
}

const afterConversation = (id: string) => () => Promise.all([refreshConversation(id), refreshEvents()])

async function updateSettings(patch: SettingsChange): Promise<void> {
  try {
    applySettings(await bridge().settings.update(patch))
    // The engine state comes from the backend, never from a guess (D-06).
    if (patch.safe_mode_cpu !== undefined) await refreshHealthQuietly()
  } catch (err) {
    reportFailure(err, 'Setting not saved')
  }
}

async function checkCatalogue(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await bridge().settings.checkCatalogue()
    return { ok: true }
  } catch (err) {
    const error =
      errorCode(err) === 'mirror_unavailable'
        ? 'The list of AI models can’t be checked in this build yet. The list that came with AIOS stays in use.'
        : messageFor(err)
    return { ok: false, error }
  } finally {
    await refreshSettings().catch(() => undefined)
  }
}

export const api = {
  /** GET /health */
  health: () => s().health,

  /** GET /projects, POST /projects, PATCH /projects/{id}, DELETE /projects/{id} */
  projects: {
    list: () => s().projects,
    create: async (input: { name: string; classification: Classification }): Promise<Project | undefined> => {
      const created = await change('Project not created', () => bridge().projects.create(input))
      return created && toProject(created)
    },
    rename: (id: string, name: string) => void change('Not renamed', () => bridge().projects.update(id, { name }), refreshProjects),
    archive: (id: string, archived = true) =>
      void change(archived ? 'Not archived' : 'Not restored', () => bridge().projects.update(id, { archived }), refreshProjects),
    remove: (id: string) => void change('Project not deleted', () => bridge().projects.remove(id)),
    /** Reclassify: lowering creates a reviewed copy with provenance (M-04). */
    reclassify: async (id: string, to: Classification): Promise<{ project: Project; reviewedCopy: boolean } | undefined> => {
      const out = await change('Sensitivity label not changed', () => bridge().projects.reclassify(id, to))
      return out && { project: toProject(out.project), reviewedCopy: out.reviewed_copy }
    },
    setCompanyAi: (id: string, enabled: boolean, confirmed: boolean) =>
      void change('Not changed', () => bridge().projects.setCompanyAi(id, enabled, confirmed), refreshProjects),
    /** POST /projects/{id}/export. The system save dialog asks where; the screen confirmed already. */
    exportPackage: async (id: string): Promise<ExportResult> => {
      let result
      try {
        result = await bridge().projects.exportPackage(id, { file_name: packageFileName(id), confirmed: true })
      } catch (err) {
        throw new Error(messageFor(err))
      }
      if (!result) throw new Error('No file was chosen. Nothing was written.')
      await refreshEvents()
      return result
    },
    /** The system open dialog for a .aiosproj file. Null when cancelled. */
    choosePackage: async (): Promise<{ file_name: string; size_bytes: number; path: string } | null> => bridge().projects.choosePackage(),
    /** POST /projects/import, for the file chosen with `choosePackage`. */
    importPackage: async (path?: string): Promise<ImportOutcome> => {
      if (!path) return { ok: false, error: 'No file was chosen. Nothing was added.' }
      try {
        const result = await bridge().projects.importPackage(path)
        await refreshWorkspace()
        return { ok: true, result }
      } catch (err) {
        return { ok: false, error: messageFor(err) }
      }
    },
    /** GET /projects/{id}/evidence */
    evidence: (id: string) => s().events.filter((e) => e.project_id === id),
    /** POST /evidence/export (F-07): a save dialog, then the writer builds and signs the copy. */
    exportEvidence: async (scope: { project_id: string } | { from: string; to: string }): Promise<EvidenceExportResult> => {
      let result
      try {
        const input = 'project_id' in scope ? ({ scope: 'project', project_id: scope.project_id } as const) : ({ scope: 'range', from: scope.from, to: scope.to } as const)
        result = await bridge().evidence.export(input)
      } catch (err) {
        throw new Error(messageFor(err))
      }
      if (!result) throw new Error('No file was chosen. Nothing was written.')
      await refreshEvents()
      return result
    },
  },

  /** GET, POST, PATCH, DELETE /projects/{id}/conversations */
  conversations: {
    list: (projectId: string) => s().conversations.filter((c) => c.project_id === projectId),
    create: async (projectId: string, title?: string): Promise<Conversation | undefined> => {
      const created = await change(
        'Conversation not started',
        () => bridge().conversations.create(projectId, title),
        () => Promise.all([refreshConversations([projectId]), refreshEvents()]),
      )
      if (!created) return undefined
      const conv = toConversation(created)
      useStore.setState((st) => ({ conversations: [...st.conversations.filter((c) => c.id !== conv.id), conv] }))
      return conv
    },
    rename: (id: string, title: string) => void change('Not renamed', () => bridge().conversations.update(id, { title }), afterConversation(id)),
    archive: (id: string, archived = true) =>
      void change(archived ? 'Not archived' : 'Not restored', () => bridge().conversations.update(id, { archived }), afterConversation(id)),
    remove: (id: string) => void change('Conversation not deleted', () => bridge().conversations.remove(id)),
    setModel: (id: string, modelId: string) =>
      void change('AI model not changed', () => bridge().conversations.update(id, { model_id: modelId }), afterConversation(id)),
    /** POST /conversations/{id}/provider, with the confirmation rules (M-09). */
    setProvider: (id: string, to: ProviderType, confirmed: boolean) =>
      void change(
        'Not moved',
        () => bridge().conversations.setProvider(id, to, confirmed),
        async () => {
          await afterConversation(id)()
          await loadMessages(id)
        },
      ),
    /** GET /conversations/{id}/messages: loads them into the store when a conversation opens. */
    load: (id: string) => void loadMessages(id).catch((err: unknown) => reportFailure(err, 'Messages not loaded')),
    messages: (id: string) => s().messages.filter((m) => m.conversation_id === id),
    /** POST /conversations/{id}/messages */
    send: async (id: string, text: string): Promise<SendResult> => {
      try {
        await bridge().conversations.send(id, text)
        // refreshHealth: a graphics-card-to-processor fallback during this answer shows its notice now (D-06).
        await Promise.all([loadMessages(id), afterConversation(id)(), refreshHealthQuietly()])
        return { ok: true }
      } catch (err) {
        await Promise.all([loadMessages(id), refreshEvents()]).catch(() => undefined) // a refusal is recorded
        const code = errorCode(err)
        if (code === 'message_too_large') return { ok: false, reason: 'too_large', detail: messageFor(err) }
        if (code === 'no_model') return { ok: false, reason: 'no_model', detail: messageFor(err) }
        if (code === 'model_missing') return { ok: false, reason: 'model_missing', detail: messageFor(err) }
        if (code === 'company_unreachable') return { ok: false, reason: 'company_unreachable', detail: messageFor(err) }
        return { ok: false, reason: 'error', detail: messageFor(err) }
      }
    },
    /** POST /conversations/{id}/stop: answers are not streamed to the window yet, so there is nothing to stop. */
    stop: () => undefined,
    regenerate: (id: string) =>
      void change(
        'Not asked again',
        () => bridge().conversations.regenerate(id),
        async () => {
          await loadMessages(id)
          await Promise.all([refreshEvents(), refreshHealthQuietly()])
        },
      ),
    /** The backend does not offer local continuation of an interrupted answer through the bridge yet. */
    offerContinueLocally: (_id: string, _partialMessageId: string) => undefined,
  },

  /** GET /providers/status */
  providers: {
    status: () => ({ local_ready: s().health.engine === 'ready' || s().health.engine === 'idle_unloaded', company: s().health.company }),
  },

  /** GET /system/hardware, POST /system/benchmark */
  system: {
    hardware: () => s().hardware,
    /** Starts the AI model with the default one and times a short answer. The result is kept by the backend. */
    benchmark: async (): Promise<void> => {
      try {
        await bridge().models.benchmark()
      } catch (err) {
        reportFailure(err, 'Speed test not run')
      }
      await Promise.all([refreshModels().catch(() => undefined), refreshHealthQuietly()])
    },
    dismissFallbackNotice: () => s().dismissFallbackNotice(),
    /** POST /system/support-bundle: the system save dialog asks where, the backend zips the logs. */
    supportBundle: async (): Promise<{ ok: true; file_name: string; path: string } | { ok: false; cancelled: boolean; error: string }> => {
      try {
        const bundle = await bridge().system.supportBundle()
        if (!bundle) return { ok: false, cancelled: true, error: '' }
        return { ok: true, file_name: bundle.file_name, path: bundle.path }
      } catch (err) {
        return { ok: false, cancelled: false, error: messageFor(err) }
      }
    },
  },

  /** GET /models, POST /models/downloads, POST /models/import, DELETE /models/{id} */
  models: {
    installed: () => s().installedModels,
    /** From the AI model's publisher, resumable. Progress is polled into the store until it is checked and installed. */
    download: (entryId: string) =>
      void bridge()
        .models.download(entryId)
        .then(() => refreshDownloads())
        .catch((err: unknown) => reportFailure(err, 'Download not started')),
    pause: (entryId: string) =>
      void bridge()
        .models.pauseDownload(entryId)
        .then(() => refreshDownloads())
        .catch((err: unknown) => reportFailure(err, 'Download not paused')),
    resume: (entryId: string) =>
      void bridge()
        .models.resumeDownload(entryId)
        .then(() => refreshDownloads())
        .catch((err: unknown) => reportFailure(err, 'Download not carried on')),
    cancel: (entryId: string) =>
      void bridge()
        .models.cancelDownload(entryId)
        .then(() => refreshDownloads())
        .catch((err: unknown) => reportFailure(err, 'Download not cancelled')),
    /** Pick a .gguf file; it is installed only if it is this catalogue entry byte for byte. */
    importOffline: async (entryId: string): Promise<void> => {
      const file = await bridge().models.chooseFile()
      if (!file) return
      s().toast({ kind: 'info', title: 'Checking the AI model file', description: `${file.file_name} is checked against the list of AI models.` })
      const model = await change('AI model not installed', () => bridge().models.importFile(file.path, entryId), () =>
        Promise.all([refreshModels(), refreshEvents(), refreshSettings()]),
      )
      if (model) s().toast({ kind: 'success', title: `${model.name} installed`, description: 'AIOS checked it is the genuine, unmodified file.' })
    },
    remove: async (id: string): Promise<{ ok: true } | { ok: false; reason: string }> => {
      try {
        await bridge().models.remove(id)
        await Promise.all([refreshModels(), refreshEvents(), refreshSettings()])
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: messageFor(err) }
      }
    },
    setDefault: (id: string | null) => {
      s().setDefaultModel(id)
      void updateSettings({ default_model_id: id })
    },
  },

  /** GET /search?q= */
  search: async (q: string): Promise<SearchHit[]> => bridge().search.query(q),

  /** GET, PATCH /settings; the update check runs in Electron main's updater */
  settings: {
    get: () => s().settings,
    update: updateSettings,
    /** "Check now": a new version of AIOS and newly listed AI models. */
    checkForUpdates: async (): Promise<void> => {
      try {
        applySettings(await bridge().settings.checkForUpdates())
      } catch (err) {
        reportFailure(err, 'Update check failed')
      }
      // The bundled list of AI models stays in use when it cannot be checked; the update result is what was asked.
      await checkCatalogue()
    },
    /** POST /models/catalogue/check: ask which list of AI models the publisher offers (runs even while the daily check is off). */
    checkCatalogue,
    /** The desktop app installs an update when AIOS closes (Electron main's updater). */
    installUpdate: () => notInThisBuild('Installing an update from here'),
    dismissUpdateNotice: () => s().dismissUpdateNotice(),
  },

  /** Backup (decision D3). Proposed endpoints: POST /backup, backup_location in settings. Not in the backend yet. */
  backup: {
    setLocation: (_path: string | null) => notInThisBuild('Backup'),
    run: async () => {
      notInThisBuild('Backup')
      return { ok: false as const, error: 'Backup is not in this build yet.' }
    },
  },

  /** Recovery key (decision D4). Proposed: POST /recovery-key. Not in the backend yet. */
  recoveryKey: {
    createNew: async (): Promise<string | null> => {
      notInThisBuild('A new recovery key')
      return null
    },
  },

  /** POST /restore */
  restore: async (input: { backup_path: string; recovery_key: string }): Promise<RestoreResult> => {
    try {
      // The Restore screen asks before it gets here.
      const restored = await bridge().setup.restore({ backup_path: input.backup_path, recovery_key: input.recovery_key, confirmed: true })
      await refreshStatus()
      await refreshSettings()
      await refreshWorkspace()
      return { ok: true, epoch: restored.epoch ?? null }
    } catch (err) {
      return { ok: false, error: messageFor(err) }
    }
  },

  /** The system folder dialog for the backup to restore from. Null when cancelled. */
  chooseBackupFolder: async (): Promise<string | null> => (await bridge().setup.chooseBackupFolder())?.path ?? null,

  /** My secure knowledge. Proposed endpoints (not in MVP 9.3): GET /knowledge, POST /knowledge, DELETE /knowledge/{id}. Not in the backend yet. */
  knowledge: {
    add: () => notInThisBuild('My secure knowledge'),
    remove: (_id: string) => notInThisBuild('My secure knowledge'),
    retry: (_id: string) => notInThisBuild('My secure knowledge'),
  },

  /** GET /setup/status, POST /setup/store, POST /setup/complete */
  firstRun: {
    /** Creates the store; the key comes back exactly once. */
    issueRecoveryKey: async (): Promise<{ ok: true; key: string } | { ok: false; alreadyIssued: boolean; error: string }> => {
      try {
        const created = await bridge().setup.createStore()
        useStore.setState((st) => ({
          recoveryKey: created.recovery_key,
          stream: { ...st.stream, stream_id: created.stream_id, signer_key_id: created.signing_key_id },
        }))
        return { ok: true, key: created.recovery_key }
      } catch (err) {
        return { ok: false, alreadyIssued: errorCode(err) === 'store_exists', error: messageFor(err) }
      }
    },
    setProgress: (patch: { step?: number; keyShownUnconfirmed?: boolean }) => s().setSetupProgress(patch),
    complete: async (): Promise<boolean> => {
      try {
        const done = await bridge().setup.complete()
        await refreshStatus()
        await refreshWorkspace()
        useStore.setState((st) => ({ ui: { ...st.ui, firstRunComplete: true, lastProjectId: done.default_project_id } }))
        return true
      } catch (err) {
        reportFailure(err, 'Setup could not finish')
        return false
      }
    },
  },
}
