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
  // Listen before loading: ready-to-show can fire before loadFile resolves.
  win.once("ready-to-show", () => win.show());
  await win.loadFile(ui);
  void shell; // external links go through links.ts with a confirmation dialog
  return win;
}

/** After this long still starting, the start-up window adds a line saying why it can take a while. */
export const SLOW_START_HINT_MS = 5_000;

/** The page shown while the backend starts: static text, no script, no preload. The second line
 * only appears once the start is slow (usually the first start after installing). */
export function startupPage(slow: boolean): string {
  const hint = slow ? "<p>This can take a minute the first time after installing.</p>" : "";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>AIOS</title><style>
body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#f6f6f4;color:#222}
@media (prefers-color-scheme:dark){body{background:#1c1c1c;color:#eee}}
h1{font-size:18px;font-weight:600;margin:0 0 6px}p{font-size:13px;margin:0;opacity:.7}
</style></head><body><h1>Starting AIOS…</h1>${hint}</body></html>`;
}

const pageUrl = (slow: boolean) => `data:text/html;charset=utf-8,${encodeURIComponent(startupPage(slow))}`;

/** Small window shown right after launch, so AIOS is never running without a window. */
export function createStartupWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 200,
    resizable: false,
    maximizable: false,
    minimizable: true,
    autoHideMenuBar: true,
    title: "AIOS",
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, javascript: false },
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void win.loadURL(pageUrl(false));
  const timer = setTimeout(() => {
    if (!win.isDestroyed()) void win.loadURL(pageUrl(true));
  }, SLOW_START_HINT_MS);
  win.once("closed", () => clearTimeout(timer));
  return win;
}
