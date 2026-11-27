/**
 * Preload: exposes window.aios and nothing else. No token, no Node, no raw ipcRenderer.
 * Every method name here must be registered in main/ipc/ (unknown names are rejected).
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AiosBridge } from "@aios/bridge-contract";

// Results are validated with zod in main before they arrive here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (method: string, ...args: unknown[]): Promise<any> => ipcRenderer.invoke("aios:invoke", method, ...args);

const bridge: AiosBridge = {
  system: {
    health: () => invoke("system.health"),
    status: () => invoke("system.status"),
    info: () => invoke("system.info"),
    supportBundle: () => invoke("system.supportBundle"),
    openLink: (url) => invoke("system.openLink", url),
  },
  setup: {
    status: () => invoke("setup.status"),
    createStore: () => invoke("setup.createStore"),
    createProject: () => invoke("setup.createProject"),
    complete: () => invoke("setup.complete"),
    chooseBackupFolder: () => invoke("setup.chooseBackupFolder"),
    chooseBackupLocation: () => invoke("setup.chooseBackupLocation"),
    setBackupLocation: (folder) => invoke("setup.setBackupLocation", folder),
    backup: () => invoke("setup.backup"),
    newRecoveryKey: () => invoke("setup.newRecoveryKey"),
    saveRecoveryKey: (recoveryKey) => invoke("setup.saveRecoveryKey", recoveryKey),
    restore: (input) => invoke("setup.restore", input),
  },
  settings: {
    get: () => invoke("settings.get"),
    update: (patch) => invoke("settings.update", patch),
    network: () => invoke("settings.network"),
    checkForUpdates: () => invoke("settings.checkForUpdates"),
    checkCatalogue: () => invoke("settings.checkCatalogue"),
  },
  projects: {
    list: () => invoke("projects.list"),
    create: (input) => invoke("projects.create", input),
    update: (id, patch) => invoke("projects.update", id, patch),
    remove: (id) => invoke("projects.remove", id),
    reclassify: (id, to) => invoke("projects.reclassify", id, to),
    setCompanyAi: (id, enabled, confirmed) => invoke("projects.setCompanyAi", id, enabled, confirmed),
    exportPackage: (id, input) => invoke("projects.exportPackage", id, input),
    choosePackage: () => invoke("projects.choosePackage"),
    importPackage: (path) => invoke("projects.importPackage", path),
  },
  conversations: {
    list: (projectId) => invoke("conversations.list", projectId),
    create: (projectId, title) => invoke("conversations.create", projectId, title),
    update: (id, patch) => invoke("conversations.update", id, patch),
    remove: (id) => invoke("conversations.remove", id),
    setProvider: (id, to, confirmed, resourceId, modelId) =>
      invoke("conversations.setProvider", id, to, confirmed, resourceId, modelId),
    messages: (id) => invoke("conversations.messages", id),
    send: (id, text, knowledgeIds, allowed) => invoke("conversations.send", id, text, knowledgeIds, allowed),
    regenerate: (id, allowed) => invoke("conversations.regenerate", id, allowed),
    generation: (id) => invoke("conversations.generation", id),
    stop: (id) => invoke("conversations.stop", id),
    summary: (id) => invoke("conversations.summary", id),
    providers: () => invoke("conversations.providers"),
  },
  search: {
    query: (q) => invoke("search.query", q),
  },
  resources: {
    list: () => invoke("resources.list"),
    link: (id, monthlyLimit) => invoke("resources.link", id, monthlyLimit),
    unlink: (id) => invoke("resources.unlink", id),
  },
  skills: {
    list: () => invoke("skills.list"),
    install: (id) => invoke("skills.install", id),
    setEnabled: (id, enabled) => invoke("skills.setEnabled", id, enabled),
    remove: (id) => invoke("skills.remove", id),
    chooseFile: () => invoke("skills.chooseFile"),
    checkFile: (path) => invoke("skills.checkFile", path),
    installFile: (path) => invoke("skills.installFile", path),
  },
  knowledge: {
    list: () => invoke("knowledge.list"),
    chooseFiles: () => invoke("knowledge.chooseFiles"),
    chooseFolder: () => invoke("knowledge.chooseFolder"),
    addFiles: (paths, collection) => invoke("knowledge.addFiles", paths, collection),
    previewFolder: (folder) => invoke("knowledge.previewFolder", folder),
    addFolder: (folder) => invoke("knowledge.addFolder", folder),
    retry: (id) => invoke("knowledge.retry", id),
    remove: (id) => invoke("knowledge.remove", id),
    // A dropped file's place on disk; only the path string crosses to the backend, never the file.
    pathOf: (file) => {
      try {
        return webUtils.getPathForFile(file as File);
      } catch {
        return "";
      }
    },
  },
  evidence: {
    list: (projectId) => invoke("evidence.list", projectId),
    status: () => invoke("evidence.status"),
    stream: () => invoke("evidence.stream"),
    checkpoints: () => invoke("evidence.checkpoints"),
    export: (input) => invoke("evidence.export", input),
  },
  models: {
    catalogue: () => invoke("models.catalogue"),
    installed: () => invoke("models.installed"),
    chooseFile: () => invoke("models.chooseFile"),
    importFile: (path, entryId) => invoke("models.importFile", path, entryId),
    packageFiles: () => invoke("models.packageFiles"),
    installPackageFile: (fileName) => invoke("models.installPackageFile", fileName),
    download: (entryId) => invoke("models.download", entryId),
    downloads: () => invoke("models.downloads"),
    pauseDownload: (entryId) => invoke("models.pauseDownload", entryId),
    resumeDownload: (entryId) => invoke("models.resumeDownload", entryId),
    cancelDownload: (entryId) => invoke("models.cancelDownload", entryId),
    remove: (id) => invoke("models.remove", id),
    hardware: (refresh) => invoke("models.hardware", refresh),
    engine: () => invoke("models.engine"),
    startEngine: (modelId) => invoke("models.startEngine", modelId),
    benchmark: () => invoke("models.benchmark"),
  },
  voice: {
    status: () => invoke("voice.status"),
    downloadModel: () => invoke("voice.downloadModel"),
    start: (languages) => invoke("voice.start", languages),
    audio: (sessionId, pcm) => invoke("voice.audio", sessionId, pcm),
    finish: (sessionId) => invoke("voice.finish", sessionId),
    cancel: (sessionId) => invoke("voice.cancel", sessionId),
    recordingStart: (seconds, languages) => invoke("voice.recordingStart", seconds, languages),
    recordingAudio: (id, pcm) => invoke("voice.recordingAudio", id, pcm),
    recordingEnd: (id) => invoke("voice.recordingEnd", id),
    recordingProgress: (id) => invoke("voice.recordingProgress", id),
    recordingStop: (id) => invoke("voice.recordingStop", id),
    recordingTake: (id, target) => invoke("voice.recordingTake", id, target),
    recordingDiscard: (id) => invoke("voice.recordingDiscard", id),
  },
  media: {
    status: () => invoke("media.status"),
    list: (projectId) => invoke("media.list", projectId),
    create: (projectId, input) => invoke("media.create", projectId, input),
    get: (id) => invoke("media.get", id),
    content: (id) => invoke("media.content", id),
    cancel: (id) => invoke("media.cancel", id),
    save: (id) => invoke("media.save", id),
    remove: (id) => invoke("media.remove", id),
  },
};

contextBridge.exposeInMainWorld("aios", bridge);
