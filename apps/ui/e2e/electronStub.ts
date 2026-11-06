/**
 * Stands in for `electron` in the end-to-end test (vitest.e2e.config.ts aliases it). The IPC
 * pipe forwards to main's real handlers; dialogs return the files the test queued.
 */
export const io = {
  dispatch: undefined as undefined | ((method: string, args: unknown[]) => Promise<unknown>),
  nextOpen: [] as string[],
  nextSave: [] as string[],
  documents: "",
};

export const contextBridge = {
  exposeInMainWorld: (key: string, value: unknown) => {
    (window as unknown as Record<string, unknown>)[key] = value;
  },
};

/** Electron's IPC pipe: structured clone in, the handler's result (or its error) out. */
export const ipcRenderer = {
  invoke: async (_channel: string, method: string, ...args: unknown[]) =>
    structuredClone(await io.dispatch!(method, structuredClone(args))),
};

export const ipcMain = { handle: () => undefined };
export const app = { isPackaged: false, getVersion: () => "0.1.0", getPath: () => io.documents };
export const BrowserWindow = { getFocusedWindow: () => null, getAllWindows: () => [] };

export const dialog = {
  showOpenDialog: async () => {
    const file = io.nextOpen.shift();
    return file ? { canceled: false, filePaths: [file] } : { canceled: true, filePaths: [] };
  },
  showSaveDialog: async () => {
    const file = io.nextSave.shift();
    return file ? { canceled: false, filePath: file } : { canceled: true };
  },
};

/** `electron-updater` is never used in the test; the update check runs only in the packaged app. */
export default { autoUpdater: { on: () => undefined } };
