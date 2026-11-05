import { ipcMain } from "electron";
import { Channels } from "@aios/bridge-contract";
import type { BackendHandle } from "../backend/spawn.js";
import { chatHandlers, evidenceHandlers, searchHandlers } from "./chat.js";
import { modelsHandlers } from "./models.js";
import { projectsHandlers } from "./projects.js";
import { settingsHandlers } from "./settings.js";
import { setupHandlers } from "./setup.js";
import { systemHandlers } from "./system.js";

export type Handler = (backend: BackendHandle, ...args: unknown[]) => Promise<unknown>;

/** Every method the renderer may call. Unknown names are rejected. */
export const handlers: Record<string, Handler> = {
  ...systemHandlers,
  ...setupHandlers,
  ...settingsHandlers,
  ...projectsHandlers,
  ...chatHandlers,
  ...searchHandlers,
  ...evidenceHandlers,
  ...modelsHandlers,
};

/** One registry of allowed calls. */
export function registerIpc(backend: BackendHandle): void {
  ipcMain.handle(Channels.invoke, async (_event, method: unknown, ...args: unknown[]) => {
    if (typeof method !== "string" || !Object.hasOwn(handlers, method)) throw new Error("unknown_method");
    return handlers[method]!(backend, ...args);
  });
}
