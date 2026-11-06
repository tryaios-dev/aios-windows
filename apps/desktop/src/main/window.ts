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

/**
 * The only permission the window gets: writing text to the clipboard (Copy buttons for the
 * recovery key, answers, code, paths). Reading the clipboard, camera, notifications and every
 * other permission stay denied.
 */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(["clipboard-sanitized-write"]);

export const allowPermission = (permission: string): boolean => ALLOWED_PERMISSIONS.has(permission);

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
  const session = win.webContents.session;
  session.setPermissionRequestHandler((wc, perm, cb) => cb(wc === win.webContents && allowPermission(perm)));
  session.setPermissionCheckHandler((wc, perm) => wc === win.webContents && allowPermission(perm));

  const ui = app.isPackaged
    ? path.join(process.resourcesPath, "ui", "index.html")
    : path.join(import.meta.dirname, "../../../ui/dist/index.html");
  await win.loadFile(ui);
  win.once("ready-to-show", () => win.show());
  void shell; // external links go through links.ts with a confirmation dialog
  return win;
}
