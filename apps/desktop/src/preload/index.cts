/**
 * Preload: exposes window.aios and nothing else. No token, no Node, no raw ipcRenderer.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { AiosBridge, EngineSettings } from "@aios/bridge-contract";

const invoke = (method: string, ...args: unknown[]) => ipcRenderer.invoke("aios:invoke", method, ...args);

const bridge: AiosBridge = {
  system: {
    health: () => invoke("system.health"),
  },
  settings: {
    engine: () => invoke("settings.engine"),
    setEngine: (settings: EngineSettings) => invoke("settings.setEngine", settings),
  },
  spike: {
    ask: (prompt: string) => invoke("spike.ask", prompt), // SPIKE-D04 (temporary)
  },
};

contextBridge.exposeInMainWorld("aios", bridge);
