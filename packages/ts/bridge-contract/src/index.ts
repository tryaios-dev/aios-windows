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
  evidence_writer: ComponentState,
  version: z.string(),
});
export type Health = z.infer<typeof Health>;

export interface AiosBridge {
  system: {
    health(): Promise<Health>;
  };
}

/** IPC channel names; main registers exactly these. */
export const Channels = {
  invoke: "aios:invoke",
} as const;
