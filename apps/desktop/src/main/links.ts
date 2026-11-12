import { BrowserWindow, dialog, shell } from "electron";
import { ExternalLink } from "@aios/bridge-contract";

/**
 * External links open only after the user confirms the destination (M-20, AC-11). The dialog
 * belongs to Electron main, so script running in the renderer cannot skip it. Only web links
 * without credentials pass; anything else is refused before the user is asked.
 */
export async function openExternalConfirmed(raw: unknown): Promise<boolean> {
  const url = new URL(ExternalLink.parse(raw));
  const owner = BrowserWindow.getFocusedWindow();
  const options = {
    type: "question" as const,
    buttons: ["Open link", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: "External link",
    message: `Open ${url.host} in your browser?`,
    detail: `${url.toString()}

This link came from a model answer. AIOS sends nothing from this conversation.`,
  };
  const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
  if (response !== 0) return false;
  await shell.openExternal(url.toString());
  return true;
}
