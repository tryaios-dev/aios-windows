import { EngineSettings } from "@aios/bridge-contract";
import type { Handler } from "./index.js";

/** Settings calls (D-06 Safe mode). Arguments are validated before they reach the backend. */
export const settingsHandlers: Record<string, Handler> = {
  "settings.engine": async (b) => EngineSettings.parse(await b.client.request("GET", "/settings/engine")),
  "settings.setEngine": async (b, input) =>
    EngineSettings.parse(await b.client.request("PUT", "/settings/engine", EngineSettings.parse(input))),
};
