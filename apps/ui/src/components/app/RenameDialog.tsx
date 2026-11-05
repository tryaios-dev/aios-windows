import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/fields";
import { Dialog } from "@/components/ui/overlays";

/** Rename a project or a conversation. Shared by the project header, project settings and chat. */
export function RenameDialog({
  open,
  onOpenChange,
  title,
  label,
  initial,
  onSubmit,
  placeholder,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  label: string;
  initial: string;
  onSubmit: (name: string) => void;
  placeholder?: string | undefined;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  const submit = () => {
    if (!value.trim()) return;
    onSubmit(value.trim());
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!value.trim() || value.trim() === initial}>
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={label} htmlFor="rename-input">
          <Input
            id="rename-input"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            maxLength={80}
            onFocus={(e) => e.target.select()}
          />
        </Field>
      </form>
    </Dialog>
  );
}
