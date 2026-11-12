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

/** The installed app takes its window icon from the packaged app (electron-builder icon). When run
 * from source, Electron would show its own icon, so point it at the brand icon. */
const windowIcon = (): { icon?: string } =>
  app.isPackaged ? {} : { icon: path.join(import.meta.dirname, "../../../../build/icons/icon.png") };

export async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    title: "AIOS",
    ...windowIcon(),
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
/** The A from the approved AIOS Soft Square wordmark (AIOS-Soft-Square-Brand, 512 x 512 canvas). */
const A_MARK =
  "M 0.718 294.25 C 0.498 293.837 11.645 268.075 25.491 237 C 39.336 205.925 68.065 141.378 89.333 93.563 C 110.601 45.748 128.987 5.578 130.191 4.296 C 134.106 0.129 137.371 -0.142 179.579 0.187 L 219.659 0.5 L 223.079 3.125 C 225.876 5.27 227.76 8.738 233.403 22.125 C 237.2 31.131 250.313 61.9 262.543 90.5 C 339.143 269.623 349 292.896 349 294.626 C 349 294.832 333.431 295 314.401 295 C 284.988 295 279.305 294.764 276.484 293.425 C 272.865 291.708 273.265 292.519 254.952 249.769 L 246.5 230.038 L 175.462 230.019 L 104.424 230 L 95.519 250.25 C 90.621 261.387 84.537 275.225 81.999 281 C 75.436 295.933 78.527 294.997 35.809 294.998 C 16.729 294.999 0.938 294.663 0.718 294.25 Z M 222.456 171.75 C 221.25 167.75 179.884 71.579 178.318 69.134 C 176.061 65.612 175.306 66.832 164.475 91.5 C 147.769 129.548 132.91 163.301 130.466 168.75 L 128.111 174 L 175.623 174 L 223.135 174 L 222.456 171.75 Z";

/** The app tile as on the desktop icon: the ink A on a white rounded square. */
const APP_TILE = `<svg width="48" height="48" viewBox="0 0 512 512" aria-hidden="true">
<rect width="512" height="512" rx="88" fill="#FFFFFF" stroke="rgba(22,33,27,.12)" stroke-width="8"/>
<g transform="translate(64 93.708) scale(1.1)"><path fill="#16211B" fill-rule="evenodd" d="${A_MARK}"/></g></svg>`;

export function startupPage(slow: boolean): string {
  const hint = slow ? "<p>This can take a minute the first time after installing.</p>" : "";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>AIOS</title><style>
body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#F6F5F1;color:#16211B}
@media (prefers-color-scheme:dark){body{background:#16211B;color:#F6F5F1}}
svg{margin-bottom:14px}
h1{font-size:18px;font-weight:600;margin:0 0 6px}p{font-size:13px;margin:0;opacity:.7}
</style></head><body>${APP_TILE}<h1>Starting AIOS…</h1>${hint}</body></html>`;
}

const pageUrl = (slow: boolean) => `data:text/html;charset=utf-8,${encodeURIComponent(startupPage(slow))}`;

/** Small window shown right after launch, so AIOS is never running without a window. */
export function createStartupWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 240,
    resizable: false,
    maximizable: false,
    minimizable: true,
    autoHideMenuBar: true,
    title: "AIOS",
    ...windowIcon(),
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
