import { ipcMain } from "electron";
import { Channels } from "@aios/bridge-contract";
import type { BackendHandle } from "../backend/spawn.js";
import { systemHandlers } from "./system.js";

export type Handler = (backend: BackendHandle, ...args: unknown[]) => Promise<unknown>;

/** One registry of allowed calls. Unknown method names are rejected. */
export function registerIpc(backend: BackendHandle): void {
  const handlers: Record<string, Handler> = { ...systemHandlers };
  ipcMain.handle(Channels.invoke, async (_event, method: unknown, ...args: unknown[]) => {
    if (typeof method !== "string" || !Object.hasOwn(handlers, method)) throw new Error("unknown_method");
    return handlers[method]!(backend, ...args);
  });
}
