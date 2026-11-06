import { Building2 } from "lucide-react";
import { api } from "@/bridge/api";
import { useStore } from "@/bridge/sim/store";
import type { Conversation } from "@/lib/types";
import { ClassChip } from "@/components/ui/chips";
import { ConfirmDialog } from "@/components/ui/overlays";

/** The exact confirmation from MVP 11.3. Moving back to Local never shows a dialog. */
export function MoveToCompanyDialog({
  open,
  onOpenChange,
  conversation,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conversation: Conversation;
}) {
  const company = useStore((s) => s.health.company);
  const toast = useStore((s) => s.toast);
  const count = useStore((s) => s.messages.filter((m) => m.conversation_id === conversation.id).length);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Disclosure boundary"
      title="Move this conversation to Company AI?"
      description="This conversation's history will be sent to the company AI server."
      confirmLabel="Send history and move"
      cancelLabel="Keep on Local"
      onConfirm={() => {
        api.conversations.setProvider(conversation.id, "company", true);
        onOpenChange(false);
        toast({
          kind: "info",
          title: "Moved to Company AI",
          description: `A divider marks the move and a provider change was recorded in the evidence log.`,
        });
      }}
    >
      <div className="flex items-center gap-3 rounded-lg border border-line bg-paper px-3 py-2.5 text-sm">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-ink text-paper">
          <Building2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">
            {company.model_name} at {company.base_url.replace("https://", "")}
          </div>
          <div className="text-xs text-ink-50">
            {count} message{count === 1 ? "" : "s"} and any summary travel with it. The conversation stays on Company AI
            until you move it back. Moving back never asks.
          </div>
        </div>
        <ClassChip value={conversation.classification_effective} />
      </div>
    </ConfirmDialog>
  );
}
