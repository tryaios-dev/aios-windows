import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Building2 } from "lucide-react";
import { api } from "@/bridge/api";
import { isLowering, useStore } from "@/bridge/sim/store";
import type { Classification, Project } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { CLASS_META, ClassChip } from "@/components/ui/chips";
import { Checkbox, Field, Hint, Input, Label, RadioCard, RadioGroup } from "@/components/ui/fields";
import { Callout } from "@/components/ui/feedback";
import { ConfirmDialog, Dialog } from "@/components/ui/overlays";
export { RenameDialog } from "@/components/app/RenameDialog";

const CLASSES: Classification[] = ["restricted", "internal", "public"];

/** Radio cards for picking a class. Shared by create and change-class. */
export function ClassPicker({
  value,
  onChange,
  current,
}: {
  value: Classification;
  onChange: (c: Classification) => void;
  current?: Classification | undefined;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as Classification)}
      className="flex flex-col gap-2"
      aria-label="Classification"
    >
      {CLASSES.map((c) => {
        const meta = CLASS_META[c];
        return (
          <RadioCard
            key={c}
            value={c}
            title={
              <span className="flex items-center gap-2">
                <ClassChip value={c} />
                {c === "restricted" && <span className="text-xs font-normal text-ink-50">Default</span>}
                {current === c && <span className="text-xs font-normal text-ink-50">Current</span>}
              </span>
            }
            description={meta.summary}
          />
        );
      })}
    </RadioGroup>
  );
}

/* ---------------- Create project ---------------- */

export function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [cls, setCls] = useState<Classification>("restricted");

  useEffect(() => {
    if (open) {
      setName("");
      setCls("restricted");
    }
  }, [open]);

  const submit = async () => {
    const project = await api.projects.create({ name, classification: cls });
    onOpenChange(false);
    if (project) navigate(`/projects/${project.id}`);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New project"
      description="A project keeps its conversations together and gives every one of them a classification."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>
            Create project
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void submit();
        }}
      >
        <Field label="Name" htmlFor="project-name">
          <Input
            id="project-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="For example, Harbourline lease review"
            maxLength={80}
          />
        </Field>
        <Field
          label="Classification"
          hint="Recorded on every conversation, message and summary in the project. You can lower it later, which creates a reviewed copy."
        >
          <ClassPicker value={cls} onChange={setCls} />
        </Field>
      </form>
    </Dialog>
  );
}

/* ---------------- Change classification ---------------- */

export function ChangeClassDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project: Project;
}) {
  const navigate = useNavigate();
  const toast = useStore((s) => s.toast);
  const [cls, setCls] = useState<Classification>(project.classification);
  const [ack, setAck] = useState(false);
  const convCount = useStore((s) => s.conversations.filter((c) => c.project_id === project.id).length);

  useEffect(() => {
    if (open) {
      setCls(project.classification);
      setAck(false);
    }
  }, [open, project.classification]);

  const lowering = isLowering(project.classification, cls);
  const changed = cls !== project.classification;

  const submit = async () => {
    const outcome = await api.projects.reclassify(project.id, cls);
    onOpenChange(false);
    if (!outcome) return;
    const { project: result, reviewedCopy } = outcome;
    if (reviewedCopy) {
      toast({
        kind: "success",
        title: "Reviewed copy created",
        description: `"${result.name}" is ${CLASS_META[cls].label}. "${project.name}" is unchanged.`,
        action: { label: "Open the copy", href: `/projects/${result.id}` },
      });
      navigate(`/projects/${result.id}`);
    } else {
      toast({
        kind: "success",
        title: `Project is now ${CLASS_META[cls].label}`,
        description:
          "New conversations take the new class. Existing items keep the class recorded when they were created.",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change classification"
      description={
        <span>
          Currently <ClassChip value={project.classification} className="align-middle" /> on {project.name}.
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!changed || (lowering && !ack)}>
            {lowering ? "Create reviewed copy" : "Change classification"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ClassPicker value={cls} onChange={setCls} current={project.classification} />
        {changed && lowering && (
          <Callout tone="caution" title="Lowering a class never rewrites existing records">
            <p>
              AIOS creates a reviewed copy of this project classified {CLASS_META[cls].label}, with provenance pointing
              back here. The {convCount} conversation{convCount === 1 ? "" : "s"} in "{project.name}" stay{" "}
              {CLASS_META[project.classification].label} and are not changed.
            </p>
            <div className="mt-3 flex items-start gap-2.5 text-sm text-ink">
              <Checkbox id="class-ack" checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />
              <Label htmlFor="class-ack" className="cursor-pointer font-normal">
                I have reviewed the content and it is suitable for {CLASS_META[cls].label}.
              </Label>
            </div>
          </Callout>
        )}
        {changed && !lowering && (
          <Callout tone="info" title="Raising applies to the project in place">
            New conversations record {CLASS_META[cls].label}. Existing conversations, messages and summaries keep the
            class they were created with, so the record stays honest.
          </Callout>
        )}
        <Hint>Classes are recorded and shown; not enforced in this version.</Hint>
      </div>
    </Dialog>
  );
}

/* ---------------- Company AI for new conversations ---------------- */

export function CompanyAiDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project: Project;
}) {
  const company = useStore((s) => s.health.company);
  const toast = useStore((s) => s.toast);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Disclosure boundary"
      title="Use Company AI for new conversations in this project"
      description={
        <span>
          Conversation content will be sent to the company server at{" "}
          <span className="font-mono text-xs text-ink">{company.base_url.replace("https://", "")}</span>. Existing
          conversations stay where they are until you move them yourself.
        </span>
      }
      confirmLabel="Use Company AI"
      onConfirm={() => {
        api.projects.setCompanyAi(project.id, true, true);
        onOpenChange(false);
        toast({
          kind: "info",
          title: "Company AI is on for new conversations",
          description: `New conversations in "${project.name}" run on ${company.model_name} while the server is reachable.`,
        });
      }}
    >
      <div className="flex items-center gap-3 rounded-lg border border-line bg-paper px-3 py-2.5 text-sm">
        <span className="flex size-8 items-center justify-center rounded-md bg-ink text-paper">
          <Building2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">{company.model_name} on the company server</div>
          <div className="text-xs text-ink-50">
            {company.reachable ? "Reachable now" : "Not reachable at the moment; conversations will start on Local"}
          </div>
        </div>
        <ClassChip value={project.classification} />
      </div>
      <p className="mt-3 text-xs leading-4.5 text-ink-50">
        This is recorded in the evidence log as a provider change. Turning it off later never asks and sends nothing.
      </p>
    </ConfirmDialog>
  );
}

/* ---------------- Delete / archive ---------------- */

export function DeleteProjectDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project: Project;
}) {
  const navigate = useNavigate();
  const toast = useStore((s) => s.toast);
  const convCount = useStore((s) => s.conversations.filter((c) => c.project_id === project.id).length);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete "${project.name}"?`}
      description={`${convCount} conversation${convCount === 1 ? "" : "s"} and their summaries will be removed from this device. The evidence log keeps a deletion event; it never stores content, so nothing can be recovered from it.`}
      confirmLabel="Delete project"
      confirmVariant="destructive"
      onConfirm={() => {
        api.projects.remove(project.id);
        onOpenChange(false);
        toast({
          kind: "info",
          title: "Project deleted",
          description: "A deletion event was recorded in the evidence log.",
        });
        navigate("/");
      }}
    />
  );
}

/** Compact class explainer used in project settings and the create dialog. */
export function ClassLegend({ className }: { className?: string | undefined }) {
  return (
    <div className={cn("grid gap-2 sm:grid-cols-3", className)}>
      {CLASSES.map((c) => (
        <div key={c} className="rounded-lg border border-line bg-paper px-3 py-2.5">
          <ClassChip value={c} />
          <p className="mt-1.5 text-xs leading-4.5 text-ink-soft">{CLASS_META[c].summary}</p>
        </div>
      ))}
    </div>
  );
}

export function ReviewedCopyNote({ project }: { project: Project }) {
  const original = useStore((s) => s.projects.find((p) => p.id === project.derived_from_project_id));
  const navigate = useNavigate();
  if (!project.derived_from_project_id) return null;
  return (
    <Callout tone="neutral" compact>
      <span className="flex flex-wrap items-center gap-1.5">
        Reviewed copy of{" "}
        {original ? (
          <button
            className="inline-flex items-center gap-1 font-medium text-ink hover:underline"
            onClick={() => navigate(`/projects/${original.id}`)}
          >
            {original.name} <ArrowRight className="size-3" />
          </button>
        ) : (
          <span className="font-mono text-xs">{project.derived_from_project_id.slice(0, 8)}</span>
        )}
        . Provenance is recorded on every item.
      </span>
    </Callout>
  );
}
