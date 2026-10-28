import { app, BrowserWindow } from "electron";
import { startBackend, stopBackend } from "./backend/spawn.js";
import { registerIpc } from "./ipc/index.js";
import { createMainWindow } from "./window.js";
import { initUpdater } from "./updater.js";
import { log } from "./logging.js";

if (!app.requestSingleInstanceLock()) app.quit();

app.on("second-instance", () => BrowserWindow.getAllWindows()[0]?.focus());

app.whenReady().then(async () => {
  const backend = await startBackend();
  registerIpc(backend);
  await createMainWindow();
  initUpdater(app.isPackaged); // updates only for the installed app
  log("app.ready", { port: backend.apiPort });
});

app.on("window-all-closed", async () => {
  await stopBackend();
  app.quit();
});
