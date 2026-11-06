import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, ArrowRightLeft, Cpu, FileText, Pencil } from "lucide-react";
import { api } from "@/bridge/api";
import { COMPANY_MODEL_NAME, useStore, useStoreShallow } from "@/bridge/sim/store";
import type { Conversation, Message, Project } from "@/lib/types";
import { cn } from "@/lib/cn";
import { dayLabel, formatTime, relativeTime } from "@/lib/format";
import { catalogueEntry } from "@/bridge/sim/catalogue";
import { Button, IconButton } from "@/components/ui/button";
import { ClassChip } from "@/components/ui/chips";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { RenameDialog } from "@/components/app/RenameDialog";
import { FallbackNotice } from "@/components/app/FallbackNotice";
import { AssistantMessage, UserMessage } from "./MessageItem";
import { Composer } from "./Composer";

export function ChatPane({
  conversation,
  project,
  onBack,
}: {
  conversation: Conversation;
  project: Project;
  onBack?: (() => void) | undefined;
}) {
  const messages = useStoreShallow((s) => s.messages.filter((m) => m.conversation_id === conversation.id));
  const summary = useStore((s) => s.summaries.find((x) => x.conversation_id === conversation.id));

  // Desktop app: load this conversation's messages from the backend when it opens.
  useEffect(() => {
    void api.conversations.load(conversation.id);
  }, [conversation.id]);
  const installed = useStore((s) => s.installedModels);
  const generation = useStore((s) => s.generation);
  const health = useStore((s) => s.health);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [rename, setRename] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const highlightId = params.get("m");

  const noModel = installed.length === 0;
  const isCompany = conversation.current_provider === "company";
  const modelName = (m: Message) =>
    m.provider === "company"
      ? COMPANY_MODEL_NAME
      : (installed.find((x) => x.id === m.model_id)?.name ?? catalogueEntry(m.model_id)?.name ?? "no model");

  // Stay pinned to the bottom while streaming unless the user scrolled up.
  const lastContentLength = messages.length ? messages.at(-1)!.content.length : 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastContentLength, generation?.phase]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Jump to a message from search.
  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`m-${highlightId}`);
    if (el) {
      stickToBottom.current = false;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [highlightId, conversation.id]);

  // Dividers: summaries and provider moves are placed by position and time.
  const rendered = useMemo(() => {
    const items: Array<
      | { kind: "day"; key: string; label: string }
      | { kind: "summary"; key: string }
      | { kind: "move"; key: string; to: "local" | "company"; at: string }
      | { kind: "message"; key: string; message: Message }
    > = [];
    const moves = [...(conversation.moves ?? [])].sort((a, b) => a.at.localeCompare(b.at));
    let moveIdx = 0;
    let lastDay = "";
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      while (moveIdx < moves.length && moves[moveIdx]!.at <= m.created_at) {
        items.push({ kind: "move", key: `move-${moveIdx}`, to: moves[moveIdx]!.to, at: moves[moveIdx]!.at });
        moveIdx++;
      }
      const day = dayLabel(m.created_at);
      if (day !== lastDay) {
        items.push({ kind: "day", key: `day-${i}`, label: day });
        lastDay = day;
      }
      items.push({ kind: "message", key: m.id, message: m });
      if (summary && summary.covers_until_message_id === m.id) items.push({ kind: "summary", key: `summary-${m.id}` });
    }
    while (moveIdx < moves.length) {
      items.push({ kind: "move", key: `move-${moveIdx}`, to: moves[moveIdx]!.to, at: moves[moveIdx]!.at });
      moveIdx++;
    }
    return items;
  }, [messages, conversation.moves, summary]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const busy = !!generation && generation.conversation_id === conversation.id;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Conversation header */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-line-soft px-5">
        <div className="group flex min-w-0 items-center gap-2">
          {onBack && (
            <IconButton label="Back to conversations" size="sm" className="-ml-2" onClick={onBack}>
              <ArrowLeft />
            </IconButton>
          )}
          <h2 className="truncate text-sm font-medium text-ink">{conversation.title}</h2>
          <IconButton
            label="Rename conversation"
            size="sm"
            className="-ml-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => setRename(true)}
          >
            <Pencil />
          </IconButton>
          <ClassChip value={conversation.classification_effective} size="xs" />
          {conversation.classification_source === "review" && (
            <span className="font-mono text-2xs text-ink-50">reviewed copy</span>
          )}
          {conversation.classification_source === "import" && (
            <span className="font-mono text-2xs text-ink-50">imported</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-2xs text-ink-50">
          {summary && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="inline-flex items-center gap-1 rounded-sm px-1 hover:text-ink">
                  <FileText className="size-3" /> Summary in use
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-96">
                <div className="label-mono mb-1.5">
                  Background summary ·{" "}
                  {summary.provider === "local" ? "written locally" : "written on the company server"}
                </div>
                <p className="text-sm leading-5 text-ink-soft">{summary.content}</p>
                <p className="mt-2 text-2xs text-ink-50">
                  Stands in for older messages when the conversation outgrows the model's context budget. Written{" "}
                  {relativeTime(summary.created_at)}. Reasoning text is never included.
                </p>
              </PopoverContent>
            </Popover>
          )}
          <span className="font-mono">{messages.length} messages</span>
        </div>
      </div>

      {/* Notices */}
      <FallbackNotice className="mx-5 mt-3 max-w-[760px] self-center" />
      <span className="sr-only" role="status">
        {busy
          ? generation?.phase === "streaming"
            ? "Answering"
            : generation?.phase === "preparing"
              ? "Preparing context"
              : "Starting the engine"
          : ""}
      </span>
      {health.writer === "unavailable" && (
        <div className="border-b border-line-soft bg-paper px-5 py-1.5" role="status">
          <p className="mx-auto max-w-[760px] text-xs text-ink-50">
            <span className="font-medium text-brass-text">Evidence writer unavailable.</span> You can keep working; each
            answer is marked evidence pending and appended exactly once when the writer is back.
          </p>
        </div>
      )}

      {/* Thread */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5">
        <div className="mx-auto flex max-w-[760px] flex-col py-5">
          {messages.length === 0 ? (
            noModel ? null : (
              <EmptyState
                compact
                title={isCompany ? `Ask ${COMPANY_MODEL_NAME} on the company server` : "Ask the model on this machine"}
                description={
                  isCompany
                    ? "This conversation runs on Company AI because the project enables it for new conversations. Your messages go to the company server and nowhere else."
                    : "Drafts, summaries, questions. Your messages stay on this device and every answer is recorded in the evidence log as a commitment, never as content."
                }
                className="py-10"
              />
            )
          ) : (
            rendered.map((item) => {
              if (item.kind === "day") return <DayDivider key={item.key} label={item.label} />;
              if (item.kind === "summary")
                return <SummaryDivider key={item.key} at={summary!.created_at} provider={summary!.provider} />;
              if (item.kind === "move") return <MoveDivider key={item.key} to={item.to} at={item.at} />;
              const m = item.message;
              if (m.role === "user") return <UserMessage key={m.id} message={m} highlighted={highlightId === m.id} />;
              return (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  modelName={modelName(m)}
                  project={project}
                  isLast={lastAssistant?.id === m.id}
                  generating={busy}
                  phase={busy && generation?.message_id === m.id ? generation.phase : null}
                  onRegenerate={() => api.conversations.regenerate(conversation.id)}
                  onContinueLocally={() => api.conversations.offerContinueLocally(conversation.id, m.id)}
                  highlighted={highlightId === m.id}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Composer or the no-model state */}
      {noModel ? (
        <div className="border-t border-line-soft bg-white px-5 pb-5 pt-4">
          <div className="mx-auto max-w-[760px]">
            <Callout
              tone="neutral"
              title="No model installed"
              action={
                <Button
                  variant="primary"
                  size="sm"
                  leading={<Cpu className="size-3.5" />}
                  onClick={() => navigate("/models")}
                >
                  Install a model
                </Button>
              }
            >
              Chat needs a local model. Everything else works without one: your history, search, export and the evidence
              log.
            </Callout>
          </div>
        </div>
      ) : (
        <Composer conversation={conversation} disabled={project.archived} />
      )}

      <RenameDialog
        open={rename}
        onOpenChange={setRename}
        title="Rename conversation"
        label="Title"
        initial={conversation.title}
        onSubmit={(t) => api.conversations.rename(conversation.id, t)}
      />
    </div>
  );
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="my-3 flex items-center gap-3" role="separator">
      <span className="h-px flex-1 bg-line-soft" />
      <span className="label-mono">{label}</span>
      <span className="h-px flex-1 bg-line-soft" />
    </div>
  );
}

function SummaryDivider({ at, provider }: { at: string; provider: "local" | "company" }) {
  return (
    <div className="my-3 flex items-center gap-3" role="separator">
      <span className="h-px flex-1 border-t border-dashed border-line" />
      <span className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-paper px-2 py-0.5 text-2xs text-ink-50">
        <FileText className="size-3" />
        Messages above are summarised for the model · written {relativeTime(at)}{" "}
        {provider === "local" ? "locally" : "on the company server"}
      </span>
      <span className="h-px flex-1 border-t border-dashed border-line" />
    </div>
  );
}

function MoveDivider({ to, at }: { to: "local" | "company"; at: string }) {
  return (
    <div className="my-3 flex items-center gap-3" role="separator">
      <span className={cn("h-px flex-1", to === "company" ? "bg-ink/30" : "bg-green/40")} />
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-2xs font-medium",
          to === "company" ? "border-ink/30 bg-paper-deep text-ink" : "border-green/30 bg-green-wash text-green-dark",
        )}
      >
        <ArrowRightLeft className="size-3" />
        {to === "company"
          ? `Moved to Company AI · ${formatTime(at)} · history sent to the company server`
          : `Moved to Local · ${formatTime(at)} · nothing sent`}
      </span>
      <span className={cn("h-px flex-1", to === "company" ? "bg-ink/30" : "bg-green/40")} />
    </div>
  );
}
