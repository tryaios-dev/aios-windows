import { z } from "zod";
import { Catalogue, EngineStatus, Hardware, Id, InstalledModel } from "@aios/bridge-contract";
import { pickFile } from "./dialogs.js";
import type { Handler } from "./index.js";

export const modelsHandlers: Record<string, Handler> = {
  "models.catalogue": async (b) => Catalogue.parse(await b.client.request("GET", "/models/catalogue")),
  "models.installed": async (b) => z.array(InstalledModel).parse(await b.client.request("GET", "/models")),
  "models.chooseFile": async () => pickFile("Choose a model file", "GGUF model", ["gguf"]),
  "models.importFile": async (b, file, entryId) =>
    InstalledModel.parse(
      await b.client.request("POST", "/models/import", {
        path: z.string().min(1).max(1024).parse(file),
        entry_id: Id.nullable().parse(entryId),
      }),
    ),
  "models.download": async (b, entryId) => {
    await b.client.request("POST", `/models/download/${Id.parse(entryId)}`);
  },
  "models.remove": async (b, id) => {
    await b.client.request("DELETE", `/models/${Id.parse(id)}`);
  },
  "models.hardware": async (b, refresh) =>
    Hardware.parse(await b.client.request("GET", `/system/hardware?refresh=${z.boolean().parse(refresh)}`)),
  "models.engine": async (b) => EngineStatus.parse(await b.client.request("GET", "/engine/status")),
};
