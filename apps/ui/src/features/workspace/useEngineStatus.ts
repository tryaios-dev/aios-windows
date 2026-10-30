import type { DotTone } from "@/components/ui/chips";
import { useWorkspaceStore } from "./store";

export interface StatusLine {
  tone: DotTone;
  pulse: boolean;
  label: string;
  detail: string;
}

/** One place that turns engine health into the words the sidebar shows. */
export function useEngineStatus(): StatusLine {
  const { engine, engineBuild, model } = useWorkspaceStore((s) => s.health);
  const build = engineBuild === "cpu" ? "CPU" : "GPU";
  const name = model?.name ?? "The model";

  if (!model || engine === "no_model") return { tone: "neutral", pulse: false, label: "No model installed", detail: "Chat is unavailable. Everything else works." };
  switch (engine) {
    case "ready":
      return { tone: "green", pulse: false, label: "Local engine ready", detail: `${name} · ${build} build` };
    case "generating":
      return { tone: "green", pulse: true, label: "Generating", detail: `${name} · ${build} build` };
    case "loading":
      return { tone: "brass", pulse: true, label: "Starting engine", detail: `Loading ${name} on the ${build} build` };
    case "failed":
      return { tone: "deny", pulse: false, label: "Engine stopped", detail: "Restarting on the CPU build" };
    case "idle_unloaded":
      return { tone: "neutral", pulse: false, label: "Engine idle", detail: `${name} unloaded to free memory. Starts on your next message.` };
    case "not_started":
    default:
      return { tone: "neutral", pulse: false, label: "Engine not started", detail: `${name} starts on your first message.` };
  }
}

export function useWriterStatus(): StatusLine {
  const { writer, evidencePending } = useWorkspaceStore((s) => s.health);
  if (writer === "unavailable") {
    return {
      tone: "brass",
      pulse: false,
      label: "Evidence writer unavailable",
      detail: evidencePending ? `${evidencePending} event${evidencePending === 1 ? "" : "s"} waiting in the outbox` : "Events will queue in the outbox",
    };
  }
  return { tone: "green", pulse: false, label: "Evidence recording", detail: "Every request is appended to the chain" };
}
