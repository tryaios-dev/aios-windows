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
      evidence_writer: "not_started",
      version: "-",
    }),
  },
};

export const inElectron = () => window.aios !== undefined;
export const bridge = (): AiosBridge => window.aios ?? browserPreview;

export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: () => bridge().system.health(), refetchInterval: 10_000 });
