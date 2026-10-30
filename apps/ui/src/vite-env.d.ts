/// <reference types="vite/client" />
import type { AiosBridge } from "@aios/bridge-contract";

declare global {
  interface Window {
    aios?: AiosBridge;
  }
  /** apps/ui/package.json version, injected by vite.config.ts. */
  const __APP_VERSION__: string;
}
