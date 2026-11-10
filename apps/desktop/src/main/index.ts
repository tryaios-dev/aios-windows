import { app, BrowserWindow, dialog } from "electron";
import { startBackend, stopBackend } from "./backend/spawn.js";
import { registerIpc } from "./ipc/index.js";
import { currentPlatform } from "./platform/index.js";
import { onSecondInstance, runStartup } from "./startup.js";
import { createMainWindow, createStartupWindow } from "./window.js";
import { initUpdater } from "./updater.js";
import { log } from "./logging.js";

// A second launch only wakes the running copy (second-instance below) and exits. app.quit() is
// not immediate, so it must not reach the start-up below: that would flash "Starting AIOS…"
// and start a second backend.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

let startupWindow: BrowserWindow | undefined;
let started = false;
let quitting = false;

function showStarting(): BrowserWindow {
  if (!startupWindow || startupWindow.isDestroyed()) startupWindow = createStartupWindow();
  return startupWindow;
}

app.on("before-quit", () => {
  quitting = true;
});

app.on("second-instance", () => {
  if (!app.isReady()) return;
  onSecondInstance(BrowserWindow.getAllWindows(), () => void (started ? createMainWindow() : showStarting()));
});

app.whenReady().then(async () => {
  if (!primary) return;
  // The installed app runs only on an OS AIOS ships for (Windows). Development builds may run
  // elsewhere so the code can be worked on, but they are never shipped.
  if (app.isPackaged && !currentPlatform().shipped) {
    dialog.showErrorBox("AIOS", "This version of AIOS runs on Windows only.");
    app.quit();
    return;
  }
  const backend = await runStartup({
    showStarting: () => void showStarting(),
    startBackend: () => startBackend(),
    stopBackend,
    openApp: async (b) => {
      registerIpc(b);
      const main = await createMainWindow();
      started = true;
      const closeStartup = () => {
        startupWindow?.close();
        startupWindow = undefined;
      };
      if (main.isVisible()) closeStartup();
      else main.once("show", closeStartup);
    },
    askRetryOrQuit: async (code) => {
      const { response } = await dialog.showMessageBox(showStarting(), {
        type: "error",
        title: "AIOS",
        message: "AIOS could not start",
        detail: `The background service did not respond. Try again; if it keeps failing, restart the computer.\n\nCode: ${code}`,
        buttons: ["Retry", "Quit"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      return response === 0 ? "retry" : "quit";
    },
    quit: () => app.quit(),
    quitting: () => quitting,
  });
  if (!backend) return;
  initUpdater(backend); // respects the update check switch in Settings
  log("app.ready", { port: backend.apiPort });
});

app.on("window-all-closed", async () => {
  await stopBackend();
  app.quit();
});
