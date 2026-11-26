/**
 * Endpoint façade: the seam between screens and the backend. One function per MVP 9.3 local API
 * endpoint. Every call goes to the backend through `window.aios` (`@/bridge`), and `@/bridge/live`
 * loads the backend's answers into the store the screens read. The renderer never holds a port or
 * a token (SR-08).
 *
 * Not in the backend yet, so refused with a plain message and nothing changed: resources.
 */
import { errorCode, type FolderPreview, type MediaCreate, type MediaItem, type PackageFile, type SkillFileCheck } from '@aios/bridge-contract'
import { bridge } from '@/bridge'
import {
  applySettings,
  applyStatus,
  change,
  loadMessages,
  messageFor,
  notInThisBuild,
  refreshConversation,
  refreshConversations,
  refreshDownloads,
  refreshEvents,
  refreshHealthQuietly,
  refreshKnowledge,
  refreshModels,
  refreshProjects,
  refreshSkills,
  refreshResources,
  refreshSettings,
  refreshStatus,
  refreshWorkspace,
  reportFailure,
  toConversation,
  toKnowledgeDoc,
  toProject,
  watchAnswer,
} from '@/bridge/live'
import { useStore } from './store'
import { useExtras } from './extras'
import { askAllowOnce } from './allowOnce'
import { kindOf } from '@/data/knowledge'
import type {
  BackupResult,
  Classification,
  Conversation,
  EvidenceExportResult,
  ExportResult,
  ImportResult,
  KnowledgeDoc,
  Project,
  ProviderType,
  SearchHit,
  Settings,
} from './types'

const s = () => useStore.getState()

export type SendResult =
  | { ok: true }
  | { ok: false; reason: 'no_model' | 'too_large' | 'busy' | 'company_unreachable' | 'model_missing' | 'not_allowed' | 'error'; detail?: string }
export type RestoreResult = { ok: true; epoch: number | null } | { ok: false; error: string }
export type ImportOutcome = { ok: true; result: ImportResult } | { ok: false; error: string }

/** The settings a person can change; the rest are results of checks. */
export type SettingsChange = Partial<Pick<Settings, 'update_check' | 'catalogue_check' | 'safe_mode_cpu' | 'default_model_id' | 'voice_languages'>>

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

/**
 * The signed Activity record of an answer is written a few seconds after the answer (the evidence
 * writer). Look again a few times, so "Not recorded yet" turns into "See in Activity" by itself
 * instead of waiting for the next click.
 */
const EVIDENCE_LOOKS_MS = [1500, 3000, 6000, 10000]
function settleEvidence(id: string, step = 0): void {
  const pending = () => s().messages.some((m) => m.conversation_id === id && m.evidence_pending)
  if (step >= EVIDENCE_LOOKS_MS.length || !pending()) return
  setTimeout(() => {
    void Promise.all([loadMessages(id), refreshEvents()])
      .catch(() => undefined)
      .finally(() => settleEvidence(id, step + 1))
  }, EVIDENCE_LOOKS_MS[step])
}

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

/** The last part of a path, whichever separator it uses. */
const nameOf = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

const PLACEHOLDER = 'adding:'
/** One brief moment as "being read", so the page can sum up the addition once it has ended. */
const SETTLE_MS = 60

/**
 * Add documents: they show as being copied while the backend copies and reads them, then the
 * library is reloaded. `names`: the files on their way in, when known (a folder is listed after).
 */
async function addKnowledge(names: string[], call: () => Promise<Parameters<typeof toKnowledgeDoc>[0][]>, collection?: string): Promise<void> {
  const at = new Date().toISOString()
  const before = new Set(useExtras.getState().knowledge.map((d) => d.id))
  const waiting = names.map((name, i) => ({
    id: `${PLACEHOLDER}${at}:${i}`,
    name,
    kind: kindOf(name),
    size_bytes: 0,
    collection: collection ?? 'Added one by one',
    origin: '',
    added_at: at,
    status: 'copying' as const,
  }))
  const without = (list: KnowledgeDoc[]) => list.filter((d) => !d.id.startsWith(PLACEHOLDER))
  if (waiting.length) useExtras.setState((x) => ({ knowledge: [...waiting, ...x.knowledge] }))
  try {
    const docs = (await call()).map(toKnowledgeDoc)
    const fresh = docs.filter((d) => !before.has(d.id))
    if (!fresh.length) {
      useExtras.setState((x) => ({ knowledge: without(x.knowledge) }))
      s().toast({ kind: 'info', title: 'Already in your secure knowledge', description: 'AIOS keeps one copy of each file.' })
      return
    }
    const ids = new Set(fresh.map((d) => d.id))
    const rest = (list: KnowledgeDoc[]) => without(list).filter((d) => !ids.has(d.id))
    useExtras.setState((x) => ({ knowledge: [...fresh.map((d) => ({ ...d, status: 'reading' as const })), ...rest(x.knowledge)] }))
    await new Promise((resolve) => window.setTimeout(resolve, SETTLE_MS))
    useExtras.setState((x) => ({ knowledge: [...fresh, ...rest(x.knowledge)] }))
    await Promise.all([refreshKnowledge(), refreshEvents()])
  } catch (err) {
    useExtras.setState((x) => ({ knowledge: without(x.knowledge) }))
    throw err
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
    /** The answer to "Which AI model should carry on?": the conversation continues on it. */
    chooseModel: async (id: string, modelId: string) => {
      const saved = await change('AI model not changed', () => bridge().conversations.update(id, { model_id: modelId }), afterConversation(id))
      if (saved) s().answerModelChoice(modelId) // a failure shows its reason and the dialog stays
    },
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
    send: async (id: string, text: string, knowledgeIds: string[] = []): Promise<SendResult> => {
      // A linked cloud AI model asks every time ("Allow once"); nothing is sent until it is allowed.
      const toResource = s().conversations.find((c) => c.id === id)?.current_provider === 'resource'
      const allowed = toResource ? await askAllowOnce(id) : false
      if (toResource && !allowed) return { ok: false, reason: 'not_allowed', detail: 'Nothing was sent.' }
      // The words appear as they are written; the stored messages replace them when it ends.
      const endLive = watchAnswer(id, text)
      try {
        await bridge().conversations.send(id, text, knowledgeIds, allowed)
        endLive()
        // refreshHealth: a graphics-card-to-processor fallback during this answer shows its notice now (D-06).
        await Promise.all([loadMessages(id), afterConversation(id)(), refreshHealthQuietly()])
        settleEvidence(id)
        return { ok: true }
      } catch (err) {
        endLive()
        await Promise.all([loadMessages(id), refreshEvents()]).catch(() => undefined) // a refusal is recorded
        const code = errorCode(err)
        if (code === 'message_too_large') return { ok: false, reason: 'too_large', detail: messageFor(err) }
        if (code === 'no_model') return { ok: false, reason: 'no_model', detail: messageFor(err) }
        if (code === 'model_missing') {
          // The conversation's AI model was removed. Another one never answers without asking (K-06):
          // the dialog asks which one carries on, and the message stays in the box.
          const removed = s().conversations.find((c) => c.id === id)?.model_id ?? ''
          useStore.setState({ modelChoice: { conversation_id: id, deleted_model_name: removed, pending_text: text } })
          return { ok: false, reason: 'model_missing', detail: messageFor(err) }
        }
        if (code === 'company_unreachable') return { ok: false, reason: 'company_unreachable', detail: messageFor(err) }
        return { ok: false, reason: 'error', detail: messageFor(err) }
      }
    },
    /** POST /conversations/{id}/stop for the answer being written now; the words so far are kept. */
    stop: () => {
      const answering = s().generation?.conversation_id
      if (!answering) return
      void bridge()
        .conversations.stop(answering)
        .catch((err: unknown) => {
          if (errorCode(err) !== 'not_generating') reportFailure(err, 'Not stopped')
        })
    },
    regenerate: async (id: string) => {
      const toResource = s().conversations.find((c) => c.id === id)?.current_provider === 'resource'
      const allowed = toResource ? await askAllowOnce(id, true) : false
      if (toResource && !allowed) return
      const endLive = watchAnswer(id, null)
      void change(
        'Not asked again',
        () => bridge().conversations.regenerate(id, allowed),
        async () => {
          endLive()
          await loadMessages(id)
          await Promise.all([refreshEvents(), refreshHealthQuietly()])
          settleEvidence(id)
        },
      ).finally(endLive)
    },
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
    /** Model files that came with the installer (offline package, MVP 10.1); none outside the desktop app. */
    packageFiles: async (): Promise<PackageFile[]> => bridge().models.packageFiles().catch(() => []),
    /**
     * Offline package (MVP 10.1): each model file that came with the installer is checked like an import
     * (size, fingerprint, review) and installed; one that fails is removed and the reason shown. True when
     * `entryId` is installed from it, so nothing needs downloading.
     */
    installFromPackage: async (entryId: string): Promise<boolean> => {
      const files = await api.models.packageFiles()
      let wanted = false
      for (const file of files) {
        const model = await change(`${file.file_name} was not installed`, () => bridge().models.installPackageFile(file.file_name), async () => undefined)
        if (model?.id === entryId) wanted = true
        if (model) s().toast({ kind: 'success', title: `${model.name} installed`, description: 'From the installer package. AIOS checked it is the genuine, unmodified file.' })
      }
      if (files.length) await Promise.all([refreshModels(), refreshEvents(), refreshSettings()])
      return wanted
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

  /** Backup (decision D3): PUT /backup/location, POST /backup. */
  backup: {
    /** The system folder dialog, then the folder is saved as where backups go. */
    chooseLocation: async (): Promise<void> => {
      try {
        const folder = await bridge().setup.chooseBackupLocation()
        if (folder) applyStatus(await bridge().setup.setBackupLocation(folder))
      } catch (err) {
        reportFailure(err, 'Backup folder not saved')
      }
    },
    /** "Set up later": no backup folder (PUT /backup/location with null). */
    setUpLater: async (): Promise<void> => {
      try {
        applyStatus(await bridge().setup.setBackupLocation(null))
      } catch (err) {
        reportFailure(err, 'Backup folder not saved')
      }
    },
    /** Back up now: a new folder in the chosen location that restore accepts as it is. */
    run: async (): Promise<{ ok: true; result: BackupResult } | { ok: false; error: string }> => {
      try {
        const done = await bridge().setup.backup()
        await Promise.all([refreshStatus(), refreshEvents()])
        return { ok: true, result: { path: done.path, size_bytes: done.size_bytes, at: done.at, conversations: done.conversations } }
      } catch (err) {
        await refreshStatus().catch(() => undefined)
        return { ok: false, error: messageFor(err) }
      }
    },
  },

  /** Recovery key (decision D4): POST /recovery-key. The key is shown once and kept nowhere. */
  recoveryKey: {
    createNew: async (): Promise<string | null> => {
      try {
        const created = await bridge().setup.newRecoveryKey()
        await Promise.all([refreshStatus(), refreshEvents()])
        return created.recovery_key
      } catch (err) {
        reportFailure(err, 'No new recovery key')
        return null
      }
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

  /** Add resources to my AI: GET /resources, POST /resources/{id}/link, DELETE /resources/{id}. The API key
   * is read from the clipboard by Electron main; this window never sees it (invariant 3). */
  resources: {
    link: (id: string, monthlyLimit: number | null) =>
      change('Not linked', () => bridge().resources.link(id, monthlyLimit), () => Promise.all([refreshResources(), refreshEvents()])),
    unlink: (id: string) => change('Not unlinked', () => bridge().resources.unlink(id), () => Promise.all([refreshResources(), refreshEvents(), refreshConversations()])),
  },

  /** Add skills to my AI: GET /skills, POST /skills/{id}, PUT /skills/{id}/enabled, DELETE /skills/{id}, POST /skills/file. */
  skills: {
    install: (id: string) => change('Skill not added', () => bridge().skills.install(id), () => Promise.all([refreshSkills(), refreshEvents()])),
    setEnabled: (id: string, enabled: boolean) => {
      // The switch moves at once; the backend's answer follows.
      useExtras.setState((x) => ({ installedSkills: x.installedSkills.map((k) => (k.id === id ? { ...k, enabled } : k)) }))
      return change('Skill not changed', () => bridge().skills.setEnabled(id, enabled), refreshSkills)
    },
    remove: (id: string) => change('Skill not removed', () => bridge().skills.remove(id), () => Promise.all([refreshSkills(), refreshEvents()])),
    /** The system file dialog; null when cancelled. */
    chooseFile: async (): Promise<string | null> => {
      try {
        return await bridge().skills.chooseFile()
      } catch (err) {
        reportFailure(err, 'Skill file not chosen')
        return null
      }
    },
    /** What the file holds, read by the backend. Nothing is added yet. */
    checkFile: async (path: string): Promise<SkillFileCheck | null> => {
      try {
        return await bridge().skills.checkFile(path)
      } catch (err) {
        reportFailure(err, 'Skill file not read')
        return null
      }
    },
    installFile: (path: string) => change('Skill not added', () => bridge().skills.installFile(path), () => Promise.all([refreshSkills(), refreshEvents()])),
  },

  /**
   * My secure knowledge: GET /knowledge, POST /knowledge, POST /knowledge/folder,
   * POST /knowledge/{id}/retry, DELETE /knowledge/{id}. Files are copied into the encrypted store;
   * the originals are never moved or changed.
   */
  knowledge: {
    /** The system file dialog, then the chosen files are copied in and read. */
    addFiles: async (): Promise<void> => {
      try {
        const paths = await bridge().knowledge.chooseFiles()
        if (paths?.length) await addKnowledge(paths.map((p) => nameOf(p)), () => bridge().knowledge.addFiles(paths))
      } catch (err) {
        reportFailure(err, 'Files not added')
      }
    },
    /** The system folder dialog, then what adding it would copy. Nothing is added yet. */
    chooseFolder: async (): Promise<FolderPreview | null> => {
      try {
        const folder = await bridge().knowledge.chooseFolder()
        return folder ? await bridge().knowledge.previewFolder(folder) : null
      } catch (err) {
        reportFailure(err, 'Folder not read')
        return null
      }
    },
    /** Everything in the folder comes in as one collection. */
    addFolder: async (preview: FolderPreview): Promise<void> => {
      const fresh = preview.files.filter((f) => !f.already).map((f) => f.name)
      try {
        await addKnowledge(fresh, () => bridge().knowledge.addFolder(preview.path), preview.name)
      } catch (err) {
        reportFailure(err, 'Folder not added')
      }
    },
    /** Files and folders dropped on the page: loose files together, each folder as its own collection. */
    addDropped: async (batches: { collection: string; path?: string; files: { name: string; path?: string }[] }[]): Promise<void> => {
      const known = batches.flatMap((b) => (b.path ? [] : b.files.filter((f) => f.path)))
      if (!known.length && !batches.some((b) => b.path)) {
        s().toast({ kind: 'info', title: 'Nothing to add', description: 'AIOS could not find those files on this computer.' })
        return
      }
      try {
        if (known.length) {
          const paths = known.map((f) => f.path!)
          await addKnowledge(known.map((f) => f.name), () => bridge().knowledge.addFiles(paths))
        }
        for (const batch of batches) if (batch.path) await addKnowledge([], () => bridge().knowledge.addFolder(batch.path!), batch.collection)
      } catch (err) {
        reportFailure(err, 'Not added')
      }
    },
    /** Where a dropped file is on this computer (desktop app); "" when it is not known. */
    pathOf: (file: File): string => {
      try {
        return bridge().knowledge.pathOf(file)
      } catch {
        return ''
      }
    },
    // A failed reload of the activity record must not report a removal that happened as failed.
    remove: (id: string) =>
      change('Document not removed', () => bridge().knowledge.remove(id), () => Promise.all([refreshKnowledge(), refreshEvents().catch(() => undefined)])),
    retry: async (id: string): Promise<void> => {
      // Shown as being read while AIOS reads the encrypted copy again.
      useExtras.setState((x) => ({ knowledge: x.knowledge.map((d) => (d.id === id ? { ...d, status: 'reading' as const, problem: undefined } : d)) }))
      try {
        const doc = toKnowledgeDoc(await bridge().knowledge.retry(id))
        useExtras.setState((x) => ({ knowledge: x.knowledge.map((d) => (d.id === id ? doc : d)) }))
      } catch (err) {
        await refreshKnowledge().catch(() => undefined)
        reportFailure(err, 'Not read again')
      }
    },
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
        // The storage was created while setting up (or before AIOS was closed) and its key is not
        // in this window any more: the keys are wrapped again under a new key, shown once.
        if (errorCode(err) === 'store_exists') {
          try {
            const fresh = await bridge().setup.newRecoveryKey()
            useStore.setState({ recoveryKey: fresh.recovery_key })
            return { ok: true, key: fresh.recovery_key }
          } catch (again) {
            return { ok: false, alreadyIssued: true, error: messageFor(again) }
          }
        }
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

  /**
   * Pictures and videos made on the company's GPU server (R-7). The screen keeps its own list
   * (`features/media/useMedia`); these calls report failures as toasts and return undefined.
   */
  media: {
    status: () => bridge().media.status(),
    list: (projectId: string) => bridge().media.list(projectId),
    get: (id: string) => bridge().media.get(id),
    content: (id: string) => bridge().media.content(id),
    /** `confirmation_required` is returned, not shown, so the screen can ask first. */
    create: async (projectId: string, input: MediaCreate): Promise<{ ok: true; item: MediaItem } | { ok: false; code: string }> => {
      try {
        const item = await bridge().media.create(projectId, input)
        void refreshEvents()
        return { ok: true, item }
      } catch (err) {
        const code = errorCode(err)
        if (code !== 'confirmation_required') reportFailure(err, input.kind === 'video' ? 'Video not started' : 'Picture not started')
        return { ok: false, code }
      }
    },
    cancel: (id: string) => change('Not stopped', () => bridge().media.cancel(id), refreshEvents),
    save: async (id: string): Promise<boolean> => {
      const saved = await change('Not saved', () => bridge().media.save(id), refreshEvents)
      if (saved) s().toast({ kind: 'success', title: 'Saved', description: saved.path })
      return !!saved
    },
    remove: async (id: string): Promise<boolean> => {
      const done = await change('Not deleted', async () => {
        await bridge().media.remove(id)
        return true
      }, refreshEvents)
      return !!done
    },
  },
}
