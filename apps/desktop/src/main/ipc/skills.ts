import { BrowserWindow, dialog } from "electron";
import type { OpenDialogOptions } from "electron";
import { z } from "zod";
import { Id, InstalledSkill, SkillFileCheck, Skills } from "@aios/bridge-contract";
import type { Handler } from "./index.js";

const skill = (id: unknown) => `/skills/${encodeURIComponent(Id.parse(id))}`;
const filePath = z.string().min(1).max(1024);

/** Add skills to my AI. A skill file is only read by the backend, after the person chose it. */
export const skillsHandlers: Record<string, Handler> = {
  "skills.list": async (b) => Skills.parse(await b.client.request("GET", "/skills")),
  "skills.install": async (b, id) => InstalledSkill.parse(await b.client.request("POST", skill(id))),
  "skills.setEnabled": async (b, id, enabled) =>
    InstalledSkill.parse(
      await b.client.request("PUT", `${skill(id)}/enabled`, { enabled: z.boolean().parse(enabled) }),
    ),
  "skills.remove": async (b, id) => {
    await b.client.request("DELETE", skill(id));
  },
  "skills.chooseFile": async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options: OpenDialogOptions = {
      title: "Choose a skill file",
      properties: ["openFile"],
      filters: [{ name: "AIOS skill", extensions: ["aios-skill"] }],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  "skills.checkFile": async (b, file) =>
    SkillFileCheck.parse(await b.client.request("POST", "/skills/file/check", { path: filePath.parse(file) })),
  "skills.installFile": async (b, file) =>
    InstalledSkill.parse(await b.client.request("POST", "/skills/file", { path: filePath.parse(file) })),
};
