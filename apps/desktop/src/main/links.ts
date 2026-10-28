import { dialog, shell } from "electron";

/** External links open only after the user confirms the destination. */
export async function openExternalConfirmed(url: string): Promise<boolean> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") return false;
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Open", "Cancel"],
    message: `Open ${parsed.host} in your browser?`,
  });
  if (response !== 0) return false;
  await shell.openExternal(parsed.toString());
  return true;
}
