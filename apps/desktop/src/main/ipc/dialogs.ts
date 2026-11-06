import { BrowserWindow, app, dialog, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import { statSync } from "node:fs";
import path from "node:path";
import { PickedFile } from "@aios/bridge-contract";

const parent = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

/** System open dialog for one file. Null when cancelled. Main reads only the size. */
export async function pickFile(title: string, name: string, extensions: string[]): Promise<PickedFile | null> {
  const options: OpenDialogOptions = { title, properties: ["openFile"], filters: [{ name, extensions }] };
  const win = parent();
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const file = result.canceled ? undefined : result.filePaths[0];
  if (!file) return null;
  return PickedFile.parse({ path: file, file_name: path.basename(file), size_bytes: statSync(file).size });
}

/** System save dialog. Null when cancelled. */
export async function pickSaveTarget(title: string, fileName: string, extension: string): Promise<string | null> {
  const options: SaveDialogOptions = {
    title,
    defaultPath: path.join(app.getPath("documents"), path.basename(fileName)),
    filters: [{ name: extension, extensions: [extension] }],
  };
  const win = parent();
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  return result.filePath.toLowerCase().endsWith(`.${extension}`) ? result.filePath : `${result.filePath}.${extension}`;
}
