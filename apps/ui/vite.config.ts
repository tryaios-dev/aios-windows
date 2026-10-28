import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Same policy as apps/desktop/src/main/window.ts: no network, no remote or inline script. */
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'";

/** Built app only. The Vite dev server needs an inline script and a websocket for reload. */
const strictCsp = (): Plugin => ({
  name: "aios-strict-csp",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
  ],
});

export default defineConfig({
  base: "./", // loaded with file:// by Electron
  plugins: [react(), strictCsp()],
  build: { outDir: "dist", sourcemap: false },
  test: { environment: "jsdom" },
});
