import { api } from "@/bridge/api";
import { useStore } from "@/bridge/sim/store";
import type { InstalledModel } from "@/lib/types";
import { formatBytes } from "@/lib/format";
import { ConfirmDialog } from "@/components/ui/overlays";

/** Delete an installed model (MVP 4.3, I-04). Destructive; the evidence log keeps a deletion event. */
export function DeleteModelDialog({
  open,
  onOpenChange,
  model,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: InstalledModel;
}) {
  const isDefault = useStore((s) => s.settings.default_model_id === model.id);
  const nextDefaultName = useStore((s) =>
    s.settings.default_model_id === model.id ? (s.installedModels.find((m) => m.id !== model.id)?.name ?? null) : null,
  );
  const loadedNow = useStore((s) => s.health.loaded_model_id === model.id);
  const freed = formatBytes(model.size_bytes);

  const confirm = async () => {
    const result = await api.models.remove(model.id);
    onOpenChange(false);
    if (!result.ok) {
      useStore.getState().toast({ kind: "deny", title: `${model.name} was not deleted`, description: result.reason });
      return;
    }
    useStore.getState().toast({
      kind: "info",
      title: `${model.name} deleted`,
      description: `${freed} freed. A deletion event was recorded in the evidence log.`,
    });
  };

  const notes: string[] = [];
  if (isDefault)
    notes.push(
      nextDefaultName
        ? `It is the default for new conversations. ${nextDefaultName} becomes the default.`
        : "It is the only installed model. Chat is unavailable until you install another; everything else keeps working.",
    );
  if (loadedNow) notes.push("The engine has it loaded and unloads it first.");

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${model.name}?`}
      description={`This frees ${freed}. Conversations that used it keep their record; the next message in one of them asks which model to continue on.`}
      confirmLabel="Delete model"
      confirmVariant="destructive"
      onConfirm={confirm}
    >
      {notes.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-line bg-paper px-3 py-2.5 text-xs leading-4.5 text-ink-soft">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </ConfirmDialog>
  );
}
