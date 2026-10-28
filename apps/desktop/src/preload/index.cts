/**
 * Preload: exposes window.aios and nothing else. No token, no Node, no raw ipcRenderer.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { AiosBridge } from "@aios/bridge-contract";

const invoke = (method: string, ...args: unknown[]) => ipcRenderer.invoke("aios:invoke", method, ...args);

const bridge: AiosBridge = {
  system: {
    health: () => invoke("system.health"),
  },
};

contextBridge.exposeInMainWorld("aios", bridge);
