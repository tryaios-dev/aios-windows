import { app, BrowserWindow, dialog } from "electron";
import { startBackend, stopBackend } from "./backend/spawn.js";
import { registerIpc } from "./ipc/index.js";
import { currentPlatform } from "./platform/index.js";
import { createMainWindow } from "./window.js";
import { initUpdater } from "./updater.js";
import { log } from "./logging.js";

if (!app.requestSingleInstanceLock()) app.quit();

app.on("second-instance", () => BrowserWindow.getAllWindows()[0]?.focus());

app.whenReady().then(async () => {
  // The installed app runs only on an OS AIOS ships for (Windows). Development builds may run
  // elsewhere so the code can be worked on, but they are never shipped.
  if (app.isPackaged && !currentPlatform().shipped) {
    dialog.showErrorBox("AIOS", "This version of AIOS runs on Windows only.");
    app.quit();
    return;
  }
  const backend = await startBackend();
  registerIpc(backend);
  await createMainWindow();
  initUpdater(backend); // respects the update check switch in Settings
  log("app.ready", { port: backend.apiPort });
});

app.on("window-all-closed", async () => {
  await stopBackend();
  app.quit();
});
