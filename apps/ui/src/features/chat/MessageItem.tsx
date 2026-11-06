import { useState } from "react";
import { useNavigate } from "react-router";
import { Check, Copy, FileSignature, History, RefreshCw, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import type { Message, Project } from "@/lib/types";
import { Badge, ProviderBadge } from "@/components/ui/chips";
import { useCopy } from "@/components/ui/layout";
import { Button, IconButton } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/overlays";
import { Markdown } from "./Markdown";

export function UserMessage({ message, highlighted }: { message: Message; highlighted?: boolean | undefined }) {
  return (
    <div
      className={cn(
        "group flex justify-end gap-3 py-2",
        highlighted && "rounded-lg ring-2 ring-green/40 ring-offset-4",
      )}
      id={`m-${message.id}`}
    >
      <span className="self-end pb-1 font-mono text-2xs text-ink-50 opacity-0 transition-opacity group-hover:opacity-100">
        {formatTime(message.created_at)}
      </span>
      <div className="max-w-[min(72%,640px)] whitespace-pre-wrap rounded-lg rounded-br-sm border border-line bg-paper px-3.5 py-2.5 text-md leading-6 text-ink">
        {message.content}
      </div>
    </div>
  );
}

export function AssistantMessage({
  message,
  modelName,
  project,
  isLast,
  generating,
  onRegenerate,
  onContinueLocally,
  highlighted,
  phase,
}: {
  message: Message;
  modelName: string;
  project: Project;
  isLast: boolean;
  generating: boolean;
  onRegenerate: () => void;
  onContinueLocally: () => void;
  highlighted?: boolean | undefined;
  phase?: "loading_engine" | "preparing" | "streaming" | null;
}) {
  const { copied, copy } = useCopy();
  const navigate = useNavigate();
  const [showPrevious, setShowPrevious] = useState(false);
  const streaming = message.status === "streaming";
  const empty = message.content.length === 0;

  return (
    <div
      className={cn("group relative py-2", highlighted && "rounded-lg ring-2 ring-green/40 ring-offset-4")}
      id={`m-${message.id}`}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <ProviderBadge provider={message.provider} model={modelName} />
        <span className="font-mono text-2xs text-ink-50">{formatTime(message.created_at)}</span>
        {message.status === "stopped" && (
          <Badge tone="neutral" icon={<Square />}>
            Stopped
          </Badge>
        )}
        {message.status === "partial" && <Badge tone="brass">Answer interrupted. Saved as partial.</Badge>}
        {message.status === "error" && <Badge tone="deny">Failed</Badge>}
        {message.continued_from && (
          <Tooltip content="The company answer above was interrupted. This continues it on the local model; nothing was sent anywhere.">
            <span>
              <Badge tone="green">Continued locally</Badge>
            </span>
          </Tooltip>
        )}
        {message.evidence_pending && (
          <Tooltip content="The evidence writer has not acknowledged this event yet. It waits in the outbox and is appended exactly once when the writer is back.">
            <span>
              <Badge tone="brass" icon={<FileSignature />}>
                Evidence pending
              </Badge>
            </span>
          </Tooltip>
        )}
        {!message.evidence_pending && message.evidence_seq && (
          <Tooltip content="Open this request in the evidence timeline. The log holds commitments to the input and output, never the content.">
            <button
              onClick={() => navigate(`/projects/${project.id}/evidence?seq=${message.evidence_seq}`)}
              className="inline-flex h-5 items-center gap-1 rounded-sm px-1 font-mono text-2xs text-ink-50 transition-colors hover:bg-ink-6 hover:text-ink"
            >
              <FileSignature className="size-3" />#{String(message.evidence_seq).padStart(4, "0")}
            </button>
          </Tooltip>
        )}
        {message.previous_versions && message.previous_versions.length > 0 && (
          <Popover open={showPrevious} onOpenChange={setShowPrevious}>
            <PopoverTrigger asChild>
              <button className="inline-flex h-5 items-center gap-1 rounded-sm px-1 text-2xs text-ink-50 transition-colors hover:bg-ink-6 hover:text-ink">
                <History className="size-3" />
                Regenerated · show previous
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-h-80 w-[480px] overflow-y-auto">
              <div className="label-mono mb-2">Previous answer</div>
              <Markdown content={message.previous_versions.at(-1)!} className="text-sm" />
            </PopoverContent>
          </Popover>
        )}
      </div>

      {message.preparing || (phase === "loading_engine" && empty) ? (
        <PreparingIndicator
          label={phase === "loading_engine" ? "Starting the engine" : "Preparing context"}
          detail={
            phase === "loading_engine"
              ? "Loading the model into memory. This happens once per session."
              : "A long conversation takes the CPU a moment to read before the first word."
          }
        />
      ) : empty && streaming ? (
        <ThinkingDots />
      ) : (
        <div className={cn("max-w-[760px]", streaming && "caret")}>
          <Markdown content={message.content} />
        </div>
      )}

      {message.status === "partial" && message.continuation_offered && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-brass/40 bg-brass-soft px-3 py-2 text-sm text-ink">
          <span className="flex-1">
            The connection dropped before the answer finished. Continue it locally on this device?
          </span>
          <Button size="sm" variant="primary" onClick={onContinueLocally}>
            Continue locally
          </Button>
        </div>
      )}

      {!streaming && !empty && (
        <div className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Tooltip content={copied ? "Copied" : "Copy answer"}>
            <IconButton label="Copy answer" size="sm" onClick={() => copy(message.content)}>
              {copied ? <Check className="text-green" /> : <Copy />}
            </IconButton>
          </Tooltip>
          {isLast && (
            <Tooltip content="Ask the model again. The previous answer stays available.">
              <IconButton label="Regenerate answer" size="sm" onClick={onRegenerate} disabled={generating}>
                <RefreshCw />
              </IconButton>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex h-6 items-center gap-1 pl-0.5" role="status" aria-label="Waiting for the first words">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-ink-30 motion-safe:animate-[pulse_1.2s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </div>
  );
}

export function PreparingIndicator({ label, detail }: { label: string; detail: string }) {
  return (
    <div
      className="flex max-w-[520px] items-center gap-3 rounded-lg border border-line bg-paper px-3 py-2.5"
      role="status"
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <span className="absolute size-4 animate-ping rounded-full bg-green/30" />
        <span className="size-2 rounded-full bg-green" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink-50">{detail}</span>
      </span>
    </div>
  );
}
