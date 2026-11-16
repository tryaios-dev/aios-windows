import { BrowserWindow, dialog } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  BackupFolder,
  BackupLocation,
  BackupResult,
  Completed,
  NewRecoveryKey,
  RestoreInput,
  Restored,
  SetupStatus,
  StoreCreated,
} from "@aios/bridge-contract";
import type { Handler } from "./index.js";

/** First run, backup and restore. The recovery key passes through main once and is never logged. */
export const setupHandlers: Record<string, Handler> = {
  "setup.status": async (b) => SetupStatus.parse(await b.client.request("GET", "/setup/status")),
  "setup.createStore": async (b) => StoreCreated.parse(await b.client.request("POST", "/setup/store")),
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
