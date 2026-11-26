import { BrowserWindow, dialog } from "electron";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BackupFolder,
  BackupLocation,
  BackupResult,
  Completed,
  NewRecoveryKey,
  RecoveryKeyText,
  RestoreInput,
  Restored,
  SetupStatus,
  StoreCreated,
} from "@aios/bridge-contract";
import { pickSaveTarget } from "./dialogs.js";
import type { Handler } from "./index.js";

/** What the saved file says: the key in its two rows, and what it is for. */
export function recoveryKeyFile(key: string, savedOn: Date): string {
  const groups = key.split("-");
  const rows = [groups.slice(0, 4), groups.slice(4)].map((row) => row.join("-")).filter(Boolean);
  return [
    "AIOS recovery key",
    "",
    ...rows,
    "",
    "With this key and a backup, your AIOS data can be opened on another computer.",
    "Keep it somewhere safe, and not next to your backups.",
    `Saved on ${savedOn.toISOString().slice(0, 10)}.`,
    "",
  ].join("\r\n");
}

/** First run, backup and restore. The recovery key passes through main once and is never logged. */
export const setupHandlers: Record<string, Handler> = {
  "setup.status": async (b) => SetupStatus.parse(await b.client.request("GET", "/setup/status")),
  "setup.createStore": async (b) => StoreCreated.parse(await b.client.request("POST", "/setup/store")),
  /**
   * "Save as a file" (test findings, issue 10). Written once, straight to the place the person
   * picked: no temporary file, no copy, and the key is never logged (a bad key is refused
   * without echoing it).
   */
  "setup.saveRecoveryKey": async (_b, recoveryKey) => {
    const parsed = RecoveryKeyText.safeParse(recoveryKey);
    if (!parsed.success) throw new Error("invalid_recovery_key");
    const target = await pickSaveTarget("Save your recovery key", "AIOS recovery key.txt", "txt");
    if (!target) return false;
    await writeFile(target, recoveryKeyFile(parsed.data, new Date()), { encoding: "utf8", flag: "w" });
    return true;
  },
  "setup.createProject": async (b) => Completed.parse(await b.client.request("POST", "/setup/project")),
  "setup.complete": async (b) => Completed.parse(await b.client.request("POST", "/setup/complete")),
  "setup.restore": async (b, input) =>
    Restored.parse(await b.client.request("POST", "/restore", RestoreInput.parse(input))),
  "setup.chooseBackupFolder": async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options: Electron.OpenDialogOptions = {
      title: "Choose the backup of your AIOS data folder",
      properties: ["openDirectory"],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const folder = result.canceled ? undefined : result.filePaths[0];
    if (!folder) return null;
    return BackupFolder.parse({
      path: folder,
      has_recovery_package: existsSync(path.join(folder, "recovery.pkg")),
      has_database: existsSync(path.join(folder, "chats.db")),
    });
  },
  /** Where backups go: a folder the user picks (a USB drive or a shared folder is safest). */
  "setup.chooseBackupLocation": async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options: Electron.OpenDialogOptions = {
      title: "Choose where to keep your AIOS backups",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  "setup.setBackupLocation": async (b, folder) =>
    SetupStatus.parse(await b.client.request("PUT", "/backup/location", { path: BackupLocation.parse(folder) })),
  "setup.backup": async (b) => BackupResult.parse(await b.client.request("POST", "/backup")),
  "setup.newRecoveryKey": async (b) => NewRecoveryKey.parse(await b.client.request("POST", "/recovery-key")),
};
