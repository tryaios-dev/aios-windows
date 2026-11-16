/** The ONLY module that touches window.aios. Everything else uses these hooks or `bridge()`. */
import { useQuery } from "@tanstack/react-query";
import type { AiosBridge } from "@aios/bridge-contract";
import { simBridge } from "./sim";

export const inElectron = () => window.aios !== undefined;
/**
 * The way to the backend. Desktop app: `window.aios`, the real backend through Electron main.
 * Plain browser (`pnpm dev:ui`): the simulated backend with sample data in `./sim`, so the design can
 * be worked on without Electron. The desktop app never uses the simulation.
 */
export const bridge = (): AiosBridge => window.aios ?? simBridge;

/**
 * Open a link from an answer (M-20). Desktop app: Electron main shows its own confirmation, which
 * nothing in the page can skip. Browser preview: the caller's dialog has already asked.
 */
export async function openExternal(url: string): Promise<void> {
  if (window.aios) {
    await window.aios.system.openLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: () => bridge().system.health(), refetchInterval: 10_000 });
