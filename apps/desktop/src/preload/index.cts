/**
 * Preload: exposes window.aios and nothing else. No token, no Node, no raw ipcRenderer.
 * Every method name here must be registered in main/ipc/ (unknown names are rejected).
 */
import { contextBridge, ipcRenderer } from "electron";
import type { AiosBridge } from "@aios/bridge-contract";

// Results are validated with zod in main before they arrive here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (method: string, ...args: unknown[]): Promise<any> => ipcRenderer.invoke("aios:invoke", method, ...args);

const bridge: AiosBridge = {
  system: {
    health: () => invoke("system.health"),
  },
  setup: {
    status: () => invoke("setup.status"),
    createStore: () => invoke("setup.createStore"),
    complete: () => invoke("setup.complete"),
    chooseBackupFolder: () => invoke("setup.chooseBackupFolder"),
    restore: (input) => invoke("setup.restore", input),
  },
  settings: {
    get: () => invoke("settings.get"),
    update: (patch) => invoke("settings.update", patch),
    network: () => invoke("settings.network"),
    checkForUpdates: () => invoke("settings.checkForUpdates"),
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
    setProvider: (id, to, confirmed) => invoke("conversations.setProvider", id, to, confirmed),
    messages: (id) => invoke("conversations.messages", id),
    send: (id, text) => invoke("conversations.send", id, text),
    regenerate: (id) => invoke("conversations.regenerate", id),
    providers: () => invoke("conversations.providers"),
  },
  search: {
    query: (q) => invoke("search.query", q),
  },
  evidence: {
    list: (projectId) => invoke("evidence.list", projectId),
    status: () => invoke("evidence.status"),
    export: () => invoke("evidence.export"),
  },
  models: {
    catalogue: () => invoke("models.catalogue"),
    installed: () => invoke("models.installed"),
    chooseFile: () => invoke("models.chooseFile"),
    importFile: (path, entryId) => invoke("models.importFile", path, entryId),
    download: (entryId) => invoke("models.download", entryId),
    remove: (id) => invoke("models.remove", id),
    hardware: (refresh) => invoke("models.hardware", refresh),
    engine: () => invoke("models.engine"),
  },
};

contextBridge.exposeInMainWorld("aios", bridge);
