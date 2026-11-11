import { z } from "zod";
import { AllowlistEntry, CatalogueCheck, Settings, SettingsPatch } from "@aios/bridge-contract";
import { checkForUpdate } from "../updater.js";
import type { Handler } from "./index.js";

export const settingsHandlers: Record<string, Handler> = {
  "settings.get": async (b) => Settings.parse(await b.client.request("GET", "/settings")),
  "settings.update": async (b, patch) =>
    Settings.parse(await b.client.request("PATCH", "/settings", SettingsPatch.parse(patch))),
  "settings.network": async (b) => z.array(AllowlistEntry).parse(await b.client.request("GET", "/system/network")),
  "settings.checkForUpdates": async (b) => Settings.parse(await checkForUpdate(b, true)),
  "settings.checkCatalogue": async (b) =>
    CatalogueCheck.parse(await b.client.request("POST", "/models/catalogue/check", { manual: true })),
};
