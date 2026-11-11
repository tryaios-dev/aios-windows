import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowUp, Building2, ChevronDown, Cpu, Lock, MonitorSmartphone, Square } from "lucide-react";
import { api } from "@/bridge/api";
import { COMPANY_MODEL_NAME, useStore } from "@/bridge/sim/store";
import type { Conversation } from "@/lib/types";
import { cn } from "@/lib/cn";
import { estimateTokens, formatTokens } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Kbd } from "@/components/ui/layout";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Tooltip,
} from "@/components/ui/overlays";
import { MoveToCompanyDialog } from "./ChatDialogs";

export function Composer({ conversation, disabled }: { conversation: Conversation; disabled?: boolean | undefined }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const generation = useStore((s) => s.generation);
  const installed = useStore((s) => s.installedModels);
  const companyFlag = useStore((s) => s.health.company.enabled);
  const company = useStore((s) => s.health.company);
  const pendingText = useStore((s) => s.continueLocally?.pending_text ?? s.modelChoice?.pending_text);
  const busy = !!generation && generation.conversation_id === conversation.id;
  const otherBusy = !!generation && generation.conversation_id !== conversation.id;
  const isCompany = conversation.current_provider === "company";
  const currentModel = installed.find((m) => m.id === conversation.model_id);
  const modelLabel = isCompany ? COMPANY_MODEL_NAME : (currentModel?.name ?? "Choose a model");

  // Keep text the user tried to send if a dialog interrupted it.
  useEffect(() => {
    if (pendingText && !text) setText(pendingText);
  }, [pendingText]);

  // Auto-grow up to ~8 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 8 * 24 + 16)}px`;
  }, [text]);

  useEffect(() => {
    ref.current?.focus();
  }, [conversation.id]);

  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!text.trim() || busy || otherBusy || disabled || sending) return;
    setSending(true);
    const result = await api.conversations.send(conversation.id, text).finally(() => setSending(false));
    if (result.ok) {
      setText("");
      setError(null);
    } else if (result.reason === "too_large") {
      setError(result.detail ?? "This message is too long for the model.");
    } else if (result.reason === "company_unreachable" || result.reason === "model_missing") {
      // A dialog takes over; the text stays in the composer.
      setError(null);
    } else if (result.reason === "error") {
      setError(result.detail ?? "The message could not be sent.");
    } else if (result.reason === "no_model") {
      navigate("/models");
    }
  };

  const tokens = estimateTokens(text);

  return (
    <div className="border-t border-line-soft bg-white px-5 pb-4 pt-3">
      <div className="mx-auto max-w-[760px]">
        {error && (
          <Callout tone="deny" compact className="mb-3" title="Message too long for a single request">
            {error}
          </Callout>
        )}
        <div
          className={cn(
            "rounded-xl border border-line bg-paper-raised shadow-[0_1px_0_rgba(255,255,255,0.8)] transition-[border-color,box-shadow] duration-(--duration-micro) focus-within:border-green focus-within:ring-2 focus-within:ring-green/15",
            disabled && "opacity-60",
          )}
        >
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={
              isCompany
                ? `Message ${COMPANY_MODEL_NAME} on the company server`
                : currentModel
                  ? `Message ${currentModel.name}`
                  : "Choose a model to start"
            }
            disabled={disabled}
            rows={1}
            aria-label="Message"
            className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-md leading-6 text-ink placeholder:text-ink-50 focus:outline-none disabled:cursor-not-allowed"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex min-w-0 items-center gap-1">
              {/* Model selector */}
              <Menu>
                <MenuTrigger asChild>
                  <button
                    className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-soft transition-colors hover:bg-ink-6 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isCompany || busy || disabled}
                    aria-label={`Model for this conversation: ${modelLabel}`}
                  >
                    <Cpu className="size-3.5 shrink-0" />
                    <span className="truncate">{modelLabel}</span>
                    {!isCompany && <ChevronDown className="size-3 shrink-0 text-ink-50" />}
                  </button>
                </MenuTrigger>
                <MenuContent align="start" className="w-72">
                  <MenuLabel>Model for this conversation</MenuLabel>
                  <MenuRadioGroup
                    value={conversation.model_id ?? ""}
                    onValueChange={(v) => api.conversations.setModel(conversation.id, v)}
                  >
                    {installed.map((m) => (
                      <MenuRadioItem key={m.id} value={m.id}>
                        <span className="flex flex-col">
                          <span>{m.name}</span>
                          <span className="text-xs text-ink-50">
                            {m.tier === "small" ? "Small" : "Medium"} tier · {m.context_length.toLocaleString()} token
                            context
                          </span>
                        </span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                  <MenuSeparator />
                  <MenuItem onSelect={() => navigate("/models")}>Manage models</MenuItem>
                  <p className="px-2 pb-1.5 pt-1 text-2xs leading-4 text-ink-50">
                    Takes effect on the next message. The answer badge always shows which model replied.
                  </p>
                </MenuContent>
              </Menu>

              <span className="h-4 w-px bg-line-soft" />

              {/* Provider control */}
              {companyFlag ? (
                <Menu>
                  <MenuTrigger asChild>
                    <button
                      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-soft transition-colors hover:bg-ink-6 hover:text-ink disabled:opacity-60"
                      disabled={busy || disabled}
                      aria-label={`Provider for this conversation: ${isCompany ? "Company AI" : "Local"}`}
                    >
                      {isCompany ? <Building2 className="size-3.5" /> : <MonitorSmartphone className="size-3.5" />}
                      <span>{isCompany ? "Company AI" : "Local"}</span>
                      <ChevronDown className="size-3 text-ink-50" />
                    </button>
                  </MenuTrigger>
                  <MenuContent align="start" className="w-80">
                    <MenuLabel>Where this conversation runs</MenuLabel>
                    {isCompany ? (
                      <MenuItem
                        icon={<MonitorSmartphone />}
                        onSelect={() => api.conversations.setProvider(conversation.id, "local", true)}
                      >
                        <span className="flex flex-col">
                          <span>Move to Local</span>
                          <span className="text-xs text-ink-50">
                            Never asks. History stays on this device from here on.
                          </span>
                        </span>
                      </MenuItem>
                    ) : (
                      <MenuItem icon={<Building2 />} onSelect={() => setMoveOpen(true)} disabled={!company.reachable}>
                        <span className="flex flex-col">
                          <span>Move to Company AI…</span>
                          <span className="text-xs text-ink-50">
                            {company.reachable
                              ? "Asks first. The history is sent to the company server."
                              : "Company server not reachable right now."}
                          </span>
                        </span>
                      </MenuItem>
                    )}
                  </MenuContent>
                </Menu>
              ) : (
                <Tooltip content="Every answer comes from the model on this machine. Nothing is sent anywhere.">
                  <span className="inline-flex h-7 items-center gap-1.5 px-2 text-xs text-ink-50">
                    <Lock className="size-3" />
                    Stays on this device
                  </span>
                </Tooltip>
              )}
            </div>

            <div className="flex items-center gap-2">
              {tokens > 200 && <span className="font-mono text-2xs text-ink-50">~{formatTokens(tokens)} tokens</span>}
              {busy ? (
                <Button
                  size="sm"
                  variant="secondary"
                  leading={<Square className="size-3 fill-current" />}
                  onClick={() => api.conversations.stop()}
                >
                  Stop
                </Button>
              ) : (
                <Tooltip content={otherBusy ? "Another conversation is generating" : "Send (Enter)"}>
                  <button
                    onClick={send}
                    disabled={!text.trim() || otherBusy || disabled}
                    aria-label="Send message"
                    className="inline-flex size-8 items-center justify-center rounded-md bg-green text-white transition-[background-color,transform] duration-(--duration-micro) hover:bg-green-deep active:translate-y-px disabled:bg-ink-12 disabled:text-ink-50"
                  >
                    <ArrowUp className="size-4" strokeWidth={2.5} />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
        <div className="mt-2 hidden items-center justify-between px-1 text-2xs text-ink-50 sm:flex">
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> send <span className="mx-1">·</span> <Kbd>⇧↵</Kbd> new line
          </span>
          {isCompany && <span>Answers come from the company server.</span>}
        </div>
      </div>
      <MoveToCompanyDialog open={moveOpen} onOpenChange={setMoveOpen} conversation={conversation} />
    </div>
  );
}
