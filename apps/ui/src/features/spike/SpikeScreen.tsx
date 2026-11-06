import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Health, SpikeAnswer } from "@aios/bridge-contract";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { KeyValue, SectionLabel } from "@/components/ui/layout";
import { bridge, useHealth } from "@/bridge";
import { platform } from "@/lib/platform";

/**
 * SPIKE-D04 (temporary): send one prompt to the local model and show the answer with its timings.
 * Proves installer -> Electron -> backend -> llama-server on a clean machine (M1) and gives the
 * week-1 benchmark figures. Replaced by the chat screen (K-01).
 */
const ERRORS: Record<string, string> = {
  no_model: `No model found. Copy a .gguf file into ${platform.folders.models} and try again.`,
  engine_failed: "The local engine did not start.",
  engine_error: "The local engine returned an error.",
  backend_unavailable: "The backend is not reachable.",
};

/** Engine state from GET /health (process manager, D-05). */
export function engineLine(h: Health): string {
  if (h.engine === "not_started") return h.engine_idle_unloaded ? "Unloaded after idle time; starts on the next question" : "Not started; starts on the first question";
  const where = h.engine_build === "vulkan" ? "GPU" : "CPU";
  const state = { starting: "Loading", ok: "Running", degraded: "Degraded", failed: "Stopped" }[h.engine];
  return h.engine === "failed" ? "Stopped; restarts on the next question" : `${state} on the ${where} build${h.engine_model ? ` · ${h.engine_model}` : ""}`;
}

const seconds = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(2)} s`);

export function SpikeScreen() {
  const [prompt, setPrompt] = React.useState("In one sentence, what is a local AI model?");
  const [busy, setBusy] = React.useState(false);
  const [answer, setAnswer] = React.useState<SpikeAnswer | null>(null);
  const health = useHealth().data;
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries();

  const ask = async () => {
    setBusy(true);
    setAnswer(null);
    try {
      setAnswer(await bridge().spike.ask(prompt));
    } finally {
      setBusy(false);
      refresh(); // show a CPU fallback right away, not on the next 10 s poll
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto bg-paper p-6">
      <SectionLabel>Local answer (temporary spike)</SectionLabel>
      {health && <KeyValue dense rows={[{ k: "Engine", v: engineLine(health) }]} />}
      {health?.engine_cpu_fallback && (
        <Callout tone="caution" title="Running on the CPU">
          The GPU engine failed, so AIOS switched to the CPU build for this session. Answers are slower. Settings → Engine → Safe mode keeps it on the CPU.
        </Callout>
      )}
      <textarea
        aria-label="Prompt"
        className="min-h-24 w-full rounded-md border border-line bg-paper-raised p-3 text-sm"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div>
        <Button variant="primary" loading={busy} disabled={busy || !prompt.trim()} onClick={() => void ask()}>
          Ask the local model
        </Button>
      </div>
      {answer?.error && (
        <Callout tone="deny" title="No answer">
          {ERRORS[answer.error] ?? answer.error}
        </Callout>
      )}
      {answer && !answer.error && (
        <>
          <p className="whitespace-pre-wrap text-sm" data-testid="spike-answer">
            {answer.text}
          </p>
          <KeyValue
            dense
            rows={[
              { k: "First words after", v: seconds(answer.firstTokenMs) },
              { k: "Total", v: seconds(answer.totalMs) },
              { k: "Tokens", v: answer.tokens ?? "–" },
              { k: "Tokens per second", v: answer.tokensPerSecond?.toFixed(1) ?? "–" },
            ]}
          />
        </>
      )}
    </div>
  );
}
