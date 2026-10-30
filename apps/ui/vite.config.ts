import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  base: "./", // loaded with file:// by Electron
  plugins: [react(), tailwindcss(), strictCsp()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: "dist", sourcemap: false },
  test: { environment: "jsdom" },
});
