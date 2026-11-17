// Opens one hidden window with the preferences passed in argv and reports what a page can reach.
// Run by renderer-node.test.ts with the real Electron binary (C-01).
const { app, BrowserWindow } = require("electron");

const prefs = JSON.parse(process.argv[process.argv.length - 1]);
const PROBE = `JSON.stringify({
  require: typeof require,
  process: typeof process,
  module: typeof module,
  Buffer: typeof Buffer,
  global: typeof global,
  electron: typeof window.electron,
})`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: prefs });
  await win.loadURL("data:text/html,<p>probe</p>");
  const seen = await win.webContents.executeJavaScript(PROBE);
  process.stdout.write(`PROBE ${seen}\n`);
  app.exit(0);
});
