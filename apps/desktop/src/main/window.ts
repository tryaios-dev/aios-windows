import { BrowserWindow, app, shell } from "electron";
import path from "node:path";

/** Strict CSP: no remote scripts, no inline script, no network from the renderer. */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.webContents.session.webRequest.onHeadersReceived((details, cb) =>
    cb({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [CSP] } }),
  );
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  const ui = app.isPackaged
    ? path.join(process.resourcesPath, "ui", "index.html")
    : path.join(import.meta.dirname, "../../../ui/dist/index.html");
  await win.loadFile(ui);
  win.once("ready-to-show", () => win.show());
  void shell; // external links go through links.ts with a confirmation dialog
  return win;
}
