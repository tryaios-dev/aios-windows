/**
 * Endpoint façade. One function per MVP 9.3 local API endpoint, mapped onto the
 * prototype store. In the real application these become invoke channels on the
 * preload bridge; the renderer never holds a port or a token (SR-08).
 */
import { useStore } from './store'
import { useExtras, type IncomingFile } from './extras'
import type { Classification, ProviderType, Settings } from './types'

const s = () => useStore.getState()

export const api = {
  /** GET /health */
  health: () => s().health,

  /** GET /projects, POST /projects, PATCH /projects/{id}, DELETE /projects/{id} */
  projects: {
    list: () => s().projects,
    create: (input: { name: string; classification: Classification }) => s().createProject(input),
    rename: (id: string, name: string) => s().renameProject(id, name),
    archive: (id: string, archived = true) => s().archiveProject(id, archived),
    remove: (id: string) => s().deleteProject(id),
    /** Reclassify: lowering creates a reviewed copy with provenance (M-04). */
    reclassify: (id: string, to: Classification) => s().reclassifyProject(id, to),
    setCompanyAi: (id: string, enabled: boolean, confirmed: boolean) => s().setProjectCompanyAi(id, enabled, confirmed),
    /** POST /projects/{id}/export */
    exportPackage: (id: string) => s().exportProject(id),
    /** POST /projects/import */
    importPackage: () => s().importProject(),
    /** GET /projects/{id}/evidence */
    evidence: (id: string) => s().events.filter((e) => e.project_id === id),
    /** POST /projects/{id}/evidence/export */
    exportEvidence: (scope: { project_id: string } | { from: string; to: string }) => s().exportEvidence(scope),
  },

  /** GET, POST, PATCH, DELETE /projects/{id}/conversations */
  conversations: {
    list: (projectId: string) => s().conversations.filter((c) => c.project_id === projectId),
    create: (projectId: string, title?: string) => s().createConversation(projectId, title),
    rename: (id: string, title: string) => s().renameConversation(id, title),
    archive: (id: string, archived = true) => s().archiveConversation(id, archived),
    remove: (id: string) => s().deleteConversation(id),
    setModel: (id: string, modelId: string) => s().setConversationModel(id, modelId),
    /** POST /conversations/{id}/provider, with the confirmation rules (M-09). */
    setProvider: (id: string, to: ProviderType, confirmed: boolean) => s().moveConversation(id, to, confirmed),
    /** GET /conversations/{id}/messages */
    messages: (id: string) => s().messages.filter((m) => m.conversation_id === id),
    /** POST /conversations/{id}/messages (streams over server-sent events) */
    send: (id: string, text: string) => s().sendMessage(id, text),
    /** POST /conversations/{id}/stop */
    stop: () => s().stopGeneration(),
    regenerate: (id: string) => s().regenerate(id),
    /** Offer local continuation for an interrupted Company answer (M-09). */
    offerContinueLocally: (id: string, partialMessageId: string) => s().offerContinueLocally(id, partialMessageId),
  },

  /** GET /providers/status */
  providers: {
    status: () => ({ local_ready: s().health.engine === 'ready' || s().health.engine === 'idle_unloaded', company: s().health.company }),
  },

  /** GET /system/hardware, GET /system/network */
  system: {
    hardware: () => s().hardware,
    benchmark: () => s().runBenchmark(),
    dismissFallbackNotice: () => s().dismissFallbackNotice(),
  },

  /** GET /models, POST /models/download, POST /models/import, DELETE /models/{id} */
  models: {
    installed: () => s().installedModels,
    download: (entryId: string) => s().startDownload(entryId),
    pause: (entryId: string) => s().pauseDownload(entryId),
    resume: (entryId: string) => s().resumeDownload(entryId),
    cancel: (entryId: string) => s().cancelDownload(entryId),
    importOffline: (entryId: string) => s().importModel(entryId),
    remove: (id: string) => s().deleteModel(id),
    setDefault: (id: string | null) => s().setDefaultModel(id),
  },

  /** GET /search?q= */
  search: (q: string) => s().search(q),

  /** GET, PUT /settings */
  settings: {
    get: () => s().settings,
    update: (patch: Partial<Settings>) => s().updateSettings(patch),
    checkForUpdates: () => s().checkForUpdates(),
    installUpdate: () => s().installUpdate(),
    dismissUpdateNotice: () => s().dismissUpdateNotice(),
  },

  /** Backup (decision D3). New endpoints proposed: POST /backup, PUT /settings backup_location. */
  backup: {
    setLocation: (path: string | null) => s().setBackupLocation(path),
    run: () => s().backupNow(),
  },

  /** Recovery key (decision D4). Proposed: POST /recovery-key issues a new key for a working installation. */
  recoveryKey: {
    createNew: () => s().reissueRecoveryKey(),
  },

  /** POST /restore */
  restore: (input: { backup_path: string; recovery_key: string; has_package: boolean }) => s().restore(input),

  /**
   * My secure knowledge. Proposed endpoints (not in MVP 9.3): GET /knowledge,
   * POST /knowledge (copies the chosen files in, then reads them), DELETE /knowledge/{id}.
   * Originals are never moved or changed.
   */
  knowledge: {
    list: () => useExtras.getState().knowledge,
    add: (files: IncomingFile[], from: { collection: string; origin: string }) => useExtras.getState().addKnowledge(files, from),
    remove: (id: string) => useExtras.getState().removeKnowledge(id),
    retry: (id: string) => useExtras.getState().retryKnowledge(id),
  },

  /** Skills. Proposed endpoints: GET /skills, POST /skills/{id}/install, DELETE /skills/{id}. */
  skills: {
    install: (id: string) => useExtras.getState().installSkill(id),
    remove: (id: string) => useExtras.getState().removeSkill(id),
    setEnabled: (id: string, enabled: boolean) => useExtras.getState().setSkillEnabled(id, enabled),
  },

  /** Resources. Proposed endpoints: GET /resources, POST /resources/{id}/link, DELETE /resources/{id}/link. Linking sends nothing. */
  resources: {
    link: (id: string, monthlyLimit: number | null) => useExtras.getState().linkResource(id, monthlyLimit),
    unlink: (id: string) => useExtras.getState().unlinkResource(id),
  },

  /** First-run helpers (recovery key issuance happens at store creation). */
  firstRun: {
    issueRecoveryKey: () => s().issueRecoveryKey(),
    setProgress: (patch: { step?: number; keyShownUnconfirmed?: boolean }) => s().setSetupProgress(patch),
    complete: (input: { installedModelId: string | null }) => s().completeFirstRun(input),
  },
}
