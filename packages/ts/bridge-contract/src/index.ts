/**
 * The window.aios bridge: the renderer's only door to the system.
 * Main validates every call against these schemas before it reaches the backend.
 * Add a feature here first, then in main (ipc/) and preload, then in the UI.
 */
import { z } from "zod";

const ComponentState = z.enum(["not_started", "starting", "ok", "degraded", "failed"]);

export const Health = z.object({
  backend: z.string(),
  database: z.enum(["ok", "locked", "error"]),
  engine: ComponentState,
  /** Build of the starting or running engine. */
  engine_build: z.enum(["cpu", "vulkan"]).nullable(),
  /** Model file of the starting or running engine. */
  engine_model: z.string().nullable(),
  /** The GPU build failed this session; the engine runs on the CPU build (tell the user). */
  engine_cpu_fallback: z.boolean(),
  /** Unloaded after the idle period; the next message starts it again. */
  engine_idle_unloaded: z.boolean(),
  evidence_writer: ComponentState,
  version: z.string(),
});
export type Health = z.infer<typeof Health>;

/** SPIKE-D04 (temporary): one local answer. Removed when the chat screen (K-01) uses the gateway (G-01). */
export const SpikePrompt = z.string().trim().min(1).max(4000);
export const SpikeAnswer = z.object({
  text: z.string(),
  /** Short code, never a backend error body: no_model, engine_failed, engine_error, backend_unavailable. */
  error: z.string().nullable(),
  firstTokenMs: z.number().nullable(),
  totalMs: z.number(),
  tokens: z.number().int().nullable(),
  tokensPerSecond: z.number().nullable(),
});
export type SpikeAnswer = z.infer<typeof SpikeAnswer>;

export interface AiosBridge {
  system: {
    health(): Promise<Health>;
  };
  /** SPIKE-D04 (temporary). */
  spike: {
    ask(prompt: string): Promise<SpikeAnswer>;
  };
}

/** IPC channel names; main registers exactly these. */
export const Channels = {
  invoke: "aios:invoke",
} as const;
