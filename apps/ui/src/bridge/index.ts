/** The ONLY module that touches window.aios. Everything else uses these hooks or `bridge()`. */
import { useQuery } from "@tanstack/react-query";
import type { AiosBridge } from "@aios/bridge-contract";

const notInElectron = async (): Promise<never> => {
  throw new Error("not_in_electron");
};

/** Every method of a bridge group fails with `not_in_electron`. */
const unavailable = <T extends object>(): T => new Proxy({}, { get: () => notInElectron }) as T;

/** In a plain browser (`pnpm dev:ui`) there is no Electron preload, so window.aios is missing.
 * This stub keeps the UI rendering for layout work; `api.ts` uses the simulated store instead. */
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
    status: notInElectron,
    info: notInElectron,
    supportBundle: notInElectron,
    openLink: notInElectron,
  },
  setup: unavailable(),
  settings: unavailable(),
  projects: unavailable(),
  conversations: unavailable(),
  search: unavailable(),
  evidence: unavailable(),
  models: unavailable(),
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
