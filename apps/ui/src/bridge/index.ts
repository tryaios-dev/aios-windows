/** The ONLY module that touches window.aios. Everything else uses these hooks. */
import { useQuery } from "@tanstack/react-query";
import type { AiosBridge } from "@aios/bridge-contract";

/** In a plain browser (`pnpm --filter @aios/ui dev`) there is no Electron preload, so
 * window.aios is missing. We fall back to a stub so the UI still renders for layout work. */
const browserPreview: AiosBridge = {
  system: {
    health: async () => ({
      backend: "browser-preview",
      database: "ok",
      engine: "not_started",
      engine_build: null,
      engine_model: null,
      engine_cpu_fallback: false,
      engine_idle_unloaded: false,
      evidence_writer: "not_started",
      version: "-",
    }),
  },
  spike: {
    ask: async () => ({
      text: "",
      error: "backend_unavailable",
      firstTokenMs: null,
      totalMs: 0,
      tokens: null,
      tokensPerSecond: null,
    }),
  },
};

export const inElectron = () => window.aios !== undefined;
export const bridge = (): AiosBridge => window.aios ?? browserPreview;

export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: () => bridge().system.health(), refetchInterval: 10_000 });
