import { useStore, selectModelName } from "@/bridge/sim/store";
import type { DotTone } from "@/components/ui/chips";

export interface EngineStatus {
  tone: DotTone;
  pulse: boolean;
  label: string;
  detail: string;
}

/** One place that turns /health into words the sidebar and settings share. */
export function useEngineStatus(): EngineStatus {
  const health = useStore((s) => s.health);
  const installed = useStore((s) => s.installedModels);
  const modelId = useStore((s) => s.health.loaded_model_id ?? s.settings.default_model_id);
  const modelName = useStore(selectModelName(modelId));
  const build = health.engine_build === "cpu" ? "CPU" : "GPU";

  if (installed.length === 0 || health.engine === "no_model")
    return {
      tone: "neutral",
      pulse: false,
      label: "No model installed",
      detail: "Chat is unavailable. Everything else works.",
    };
  switch (health.engine) {
    case "ready":
      return { tone: "green", pulse: false, label: "Local engine ready", detail: `${modelName} · ${build} build` };
    case "generating":
      return { tone: "green", pulse: true, label: "Generating", detail: `${modelName} · ${build} build` };
    case "loading":
      return {
        tone: "brass",
        pulse: true,
        label: "Starting engine",
        detail: `Loading ${modelName} on the ${build} build`,
      };
    case "failed":
      return { tone: "deny", pulse: false, label: "Engine stopped", detail: "Restarting on the CPU build" };
    case "idle_unloaded":
      return {
        tone: "neutral",
        pulse: false,
        label: "Engine idle",
        detail: `${modelName} unloaded to free memory. Starts on your next message.`,
      };
    case "not_started":
    default:
      return {
        tone: "neutral",
        pulse: false,
        label: "Engine not started",
        detail: `${modelName} starts on your first message.`,
      };
  }
}

export function useWriterStatus() {
  const writer = useStore((s) => s.health.writer);
  const pending = useStore((s) => s.health.evidence_pending);
  if (writer === "unavailable")
    return {
      tone: "brass" as DotTone,
      label: "Evidence writer unavailable",
      detail: pending
        ? `${pending} event${pending === 1 ? "" : "s"} waiting in the outbox`
        : "Events will queue in the outbox",
    };
  return { tone: "green" as DotTone, label: "Evidence recording", detail: "Every request is appended to the chain" };
}
