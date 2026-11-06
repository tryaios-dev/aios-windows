import { z } from "zod";
import {
  Classification,
  ExportPackageInput,
  Id,
  PackageExport,
  PackageImport,
  Project,
  ProjectCreate,
  ProjectPatch,
  Reclassified,
} from "@aios/bridge-contract";
import { pickFile, pickSaveTarget } from "./dialogs.js";
import type { Handler } from "./index.js";

const path = (id: unknown) => `/projects/${Id.parse(id)}`;

export const projectsHandlers: Record<string, Handler> = {
  "projects.list": async (b) => z.array(Project).parse(await b.client.request("GET", "/projects")),
  "projects.create": async (b, input) =>
    Project.parse(await b.client.request("POST", "/projects", ProjectCreate.parse(input))),
  "projects.update": async (b, id, patch) =>
    Project.parse(await b.client.request("PATCH", path(id), ProjectPatch.parse(patch))),
  "projects.remove": async (b, id) => {
    await b.client.request("DELETE", path(id));
  },
  "projects.reclassify": async (b, id, to) =>
    Reclassified.parse(await b.client.request("POST", `${path(id)}/reclassify`, { to: Classification.parse(to) })),
  "projects.setCompanyAi": async (b, id, enabled, confirmed) =>
    Project.parse(
      await b.client.request("PUT", `${path(id)}/company-ai`, {
        enabled: z.boolean().parse(enabled),
        confirmed: z.boolean().parse(confirmed),
      }),
    ),
  "projects.exportPackage": async (b, id, input) => {
    const { file_name, confirmed } = ExportPackageInput.parse(input);
    const target = await pickSaveTarget("Export the project package", file_name, "aiosproj");
    if (!target) return null;
    return PackageExport.parse(await b.client.request("POST", `${path(id)}/export`, { path: target, confirmed }));
  },
  "projects.choosePackage": async () => pickFile("Choose a project package", "AIOS project package", ["aiosproj"]),
  "projects.importPackage": async (b, file) =>
    PackageImport.parse(
      await b.client.request("POST", "/projects/import", { path: z.string().min(1).max(1024).parse(file) }),
    ),
};
