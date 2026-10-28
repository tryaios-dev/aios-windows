/// <reference types="vite/client" />
import type { AiosBridge } from "@aios/bridge-contract";

declare global {
  interface Window {
    aios?: AiosBridge;
  }
}
