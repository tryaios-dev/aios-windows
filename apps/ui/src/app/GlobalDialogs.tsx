import { useState } from "react";
import { useNavigate } from "react-router";
import { useStore } from "@/bridge/sim/store";
import { ConfirmDialog, Dialog } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { RadioCard, RadioGroup } from "@/components/ui/fields";
import { Callout } from "@/components/ui/feedback";
import { formatBytes } from "@/lib/format";

/** Dialogs the store can raise from anywhere: local continuation and the missing-model choice. */
export function GlobalDialogs() {
  return (
    <>
      <ContinueLocallyDialog />
      <ModelChoiceDialog />
    </>
  );
}

function ContinueLocallyDialog() {
  const prompt = useStore((s) => s.continueLocally);
  const answer = useStore((s) => s.answerContinueLocally);
  const conv = useStore((s) => s.conversations.find((c) => c.id === prompt?.conversation_id));
  const defaultModel = useStore((s) => s.installedModels.find((m) => m.id === s.settings.default_model_id));
  const open = !!prompt;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) answer(false);
      }}
      eyebrow="Company AI unreachable"
      title="Continue this conversation locally?"
      description={
        prompt?.partial_message_id
          ? `The connection to the company server was lost part-way through the answer. The partial answer is saved and marked. Continuing locally moves "${conv?.title ?? "this conversation"}" to ${defaultModel?.name ?? "the local model"} on this device; nothing is sent anywhere.`
          : `The company server is not reachable right now. Continuing locally moves "${conv?.title ?? "this conversation"}" to ${defaultModel?.name ?? "the local model"} on this device and sends your message there. Nothing moves until you choose.`
      }
      confirmLabel="Continue locally"
      cancelLabel="Stay on Company AI"
      onConfirm={() => answer(true)}
      disabled={!defaultModel}
    >
      {!defaultModel && (
        <Callout tone="caution">
          No local model is installed, so this conversation cannot continue locally yet. Install one from Models.
        </Callout>
      )}
    </ConfirmDialog>
  );
}

function ModelChoiceDialog() {
  const prompt = useStore((s) => s.modelChoice);
  const answer = useStore((s) => s.answerModelChoice);
  const installed = useStore((s) => s.installedModels);
  const defaultId = useStore((s) => s.settings.default_model_id);
  const [choice, setChoice] = useState<string | null>(null);
  const navigate = useNavigate();
  const valid = choice && installed.some((m) => m.id === choice) ? choice : null;
  const selected =
    valid ?? (defaultId && installed.some((m) => m.id === defaultId) ? defaultId : null) ?? installed[0]?.id ?? null;
  const open = !!prompt;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) answer(null);
      }}
      title="Which model should continue this conversation?"
      description={`${prompt?.deleted_model_name ?? "The model this conversation used"} is no longer installed. Nothing is sent until you choose.`}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => answer(null)}>
            Cancel
          </Button>
          {installed.length === 0 ? (
            <Button
              variant="primary"
              onClick={() => {
                answer(null);
                navigate("/models");
              }}
            >
              Open Models
            </Button>
          ) : (
            <Button variant="primary" onClick={() => answer(selected)} disabled={!selected}>
              Continue with this model
            </Button>
          )}
        </>
      }
    >
      {installed.length === 0 ? (
        <Callout tone="caution">
          No model is installed. Install one from Models, then send your message again. Your text is kept in the
          composer.
        </Callout>
      ) : (
        <RadioGroup
          key={prompt?.conversation_id}
          value={selected ?? undefined}
          onValueChange={setChoice}
          className="flex flex-col gap-2"
        >
          {installed.map((m) => (
            <RadioCard
              key={m.id}
              value={m.id}
              title={
                <span>
                  {m.name}
                  {m.id === defaultId && <span className="ml-2 text-xs font-normal text-ink-50">Default</span>}
                </span>
              }
              description={`${m.tier === "small" ? "Small" : "Medium"} tier · ${formatBytes(m.size_bytes)} · ${m.context_length.toLocaleString()} token context`}
            />
          ))}
        </RadioGroup>
      )}
    </Dialog>
  );
}
