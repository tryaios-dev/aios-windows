import { fileURLToPath } from "node:url";
import { mergeConfig, transformWithEsbuild, type Plugin } from "vite";
import base from "./vite.config";

/**
 * End-to-end: the UI's own code, through the real preload and Electron main handlers, against a
 * real backend started for the test (`aios-backend serve-e2e`). Only Electron itself (its IPC
 * pipe and the system dialogs) is replaced, by e2e/electronStub.ts. Needs `uv sync` first.
 * Run with `pnpm test:e2e`.
 */
const stub = fileURLToPath(new URL("./e2e/electronStub.ts", import.meta.url));

/** Electron's preload is a .cts file; compile it like the other TypeScript sources. */
const cts = (): Plugin => ({
  name: "aios-e2e-cts",
  transform: (code, id) =>
    id.endsWith(".cts")
      ? transformWithEsbuild(code, id.replace(/\.cts$/, ".ts"), { loader: "ts", format: "esm" })
      : null,
});

export default mergeConfig(base, {
  plugins: [cts()],
  resolve: { alias: { electron: stub, "electron-updater": stub } },
  test: {
    environment: "jsdom",
    include: ["e2e/**/*.e2e.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    server: { deps: { inline: [/apps[\\/]desktop/] } },
  },
});
