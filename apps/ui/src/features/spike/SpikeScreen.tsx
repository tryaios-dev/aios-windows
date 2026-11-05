import * as React from "react";
import type { SpikeAnswer } from "@aios/bridge-contract";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { KeyValue, SectionLabel } from "@/components/ui/layout";
import { bridge } from "@/bridge";

/**
 * SPIKE-D04 (temporary): send one prompt to the local model and show the answer with its timings.
 * Proves installer -> Electron -> backend -> llama-server on a clean machine (M1) and gives the
 * week-1 benchmark figures. Replaced by the chat screen (K-01).
 */
const ERRORS: Record<string, string> = {
  no_model: "No model found. Copy a .gguf file into %LOCALAPPDATA%\\AIOS\\models and try again.",
  engine_failed: "The local engine did not start.",
  engine_error: "The local engine returned an error.",
  backend_unavailable: "The backend is not reachable.",
};

const seconds = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(2)} s`);

export function SpikeScreen() {
  const [prompt, setPrompt] = React.useState("In one sentence, what is a local AI model?");
  const [busy, setBusy] = React.useState(false);
  const [answer, setAnswer] = React.useState<SpikeAnswer | null>(null);

  const ask = async () => {
    setBusy(true);
    setAnswer(null);
    try {
      setAnswer(await bridge().spike.ask(prompt));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto bg-paper p-6">
      <SectionLabel>Local answer (temporary spike)</SectionLabel>
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
