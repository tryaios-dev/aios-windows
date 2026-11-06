import { useState, type ComponentType, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  Cpu,
  FileCheck,
  FileSignature,
  FileText,
  FolderOpen,
  ListChecks,
  MessagesSquare,
  PackageOpen,
  Replace,
  ScrollText,
  Tags,
} from "lucide-react";
import { api } from "@/bridge/api";
import { useStore, useStoreShallow } from "@/bridge/sim/store";
import type { ExportResult, ImportResult, Project } from "@/lib/types";
import { cn } from "@/lib/cn";
import { formatBytes, pluralise } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ClassChip } from "@/components/ui/chips";
import { Callout, Spinner } from "@/components/ui/feedback";
import { Hint, Input, Label } from "@/components/ui/fields";
import { Hash, KeyValue, Mono } from "@/components/ui/layout";
import { Dialog } from "@/components/ui/overlays";

/**
 * Project Package v1 dialogs (MVP 4.5, 9.5, AC-16; tickets J-01, J-02, K-09).
 *
 * Both dialogs keep their flow state inside the dialog content, so Radix
 * unmounting the content on close resets them without an effect. While a
 * package is being written or verified the dialog refuses to close.
 */

const EYEBROW = "Project Package v1";
const EXPORT_FOLDER = "C:\\Users\\pilot\\Documents\\AIOS exports";

/** Mirrors the file-name rule the export endpoint applies. */
function packageFileName(projectName: string) {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${slug || "project"}.aiosproj`;
}

function folderOf(path: string) {
  const i = path.lastIndexOf("\\");
  return i > 0 ? path.slice(0, i) : path;
}

/* ---------------- Shared pieces ---------------- */

function DialogBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4 px-6 pb-1">{children}</div>;
}

function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-2 px-6 pt-4">{children}</div>;
}

function ContentsList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="label-mono mb-2">{title}</div>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </section>
  );
}

function ContentsItem({
  icon: Icon,
  muted,
  children,
}: {
  icon: ComponentType<{ className?: string | undefined }>;
  muted?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <li className={cn("flex items-start gap-2.5 text-sm leading-5", muted ? "text-ink-50" : "text-ink-soft")}>
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", muted ? "text-ink-50" : "text-ink-50")} aria-hidden />
      <span>{children}</span>
    </li>
  );
}

function WorkingRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-line bg-paper px-3 py-2.5 animate-in"
      aria-live="polite"
    >
      <Spinner className="text-green" label={label} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block truncate text-xs text-ink-50">{detail}</span>
      </span>
    </div>
  );
}

function EvidenceLink({ seq, onOpen }: { seq: number | null; onOpen: () => void }) {
  if (seq === null)
    return <span className="text-xs text-ink-50">Queued for the evidence log (writer not in this build)</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex h-5 items-center gap-1 rounded-sm px-1 -ml-1 font-mono text-xs text-ink-soft transition-colors duration-(--duration-micro) hover:bg-ink-6 hover:text-ink"
      aria-label={`Open evidence event ${seq} in the timeline`}
    >
      <FileSignature className="size-3" aria-hidden />#{String(seq).padStart(4, "0")}
      <span className="ml-1 font-sans text-xs text-ink-50">Open in timeline</span>
    </button>
  );
}

/* ================================================================== */
/* Export                                                              */
/* ================================================================== */

export function ExportProjectDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project: Project;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && busy) return;
        onOpenChange(o);
      }}
      width="md"
      eyebrow={EYEBROW}
      hideClose={busy}
      bare
      title="Export project"
      description={
        <>
          One <Mono className="text-ink">.aiosproj</Mono> file that another AIOS installation can import. Model files
          stay where they are.
        </>
      }
    >
      <ExportFlow project={project} onBusy={setBusy} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

type ExportPhase =
  { kind: "idle"; error?: string | undefined } | { kind: "working" } | { kind: "done"; result: ExportResult };

function ExportFlow({
  project,
  onBusy,
  onClose,
}: {
  project: Project;
  onBusy: (b: boolean) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const counts = useStoreShallow((s) => {
    const ids = new Set(s.conversations.filter((c) => c.project_id === project.id).map((c) => c.id));
    return {
      conversations: ids.size,
      messages: s.messages.filter((m) => ids.has(m.conversation_id)).length,
      summaries: s.summaries.filter((x) => ids.has(x.conversation_id)).length,
    };
  });
  const [folder, setFolder] = useState(EXPORT_FOLDER);
  const [phase, setPhase] = useState<ExportPhase>({ kind: "idle" });
  const fileName = packageFileName(project.name);

  const run = async () => {
    setPhase({ kind: "working" });
    onBusy(true);
    try {
      const result = await api.projects.exportPackage(project.id);
      setPhase({ kind: "done", result });
    } catch (e) {
      setPhase({ kind: "idle", error: e instanceof Error ? e.message : "The package could not be written." });
    } finally {
      onBusy(false);
    }
  };

  const openEvidence = (seq: number) => {
    onClose();
    navigate(`/projects/${project.id}/evidence?seq=${seq}`);
  };

  if (phase.kind === "done") {
    const { result } = phase;
    return (
      <>
        <DialogBody>
          <Callout tone="success" title="Package written">
            Import it on another AIOS installation to continue the project there. The file carries the project's
            classification; keep it where that class allows.
          </Callout>
          <KeyValue
            dense
            rows={[
              { k: "File name", v: <Mono className="text-ink">{result.file_name}</Mono> },
              { k: "Location", v: <Mono className="break-all">{folderOf(result.path)}</Mono> },
              { k: "Size", v: <span className="tabular">{formatBytes(result.size_bytes)}</span> },
              { k: "Checksum", v: <Hash value={result.checksum} head={12} tail={8} />, hint: "checksums.txt" },
              {
                k: "Evidence event",
                v: (
                  <EvidenceLink
                    seq={result.evidence_seq}
                    onOpen={() => result.evidence_seq !== null && openEvidence(result.evidence_seq)}
                  />
                ),
                hint: "export",
              },
            ]}
          />
        </DialogBody>
        <DialogFooter>
          <Button
            leading={<FolderOpen className="size-3.5" />}
            onClick={() =>
              useStore.getState().toast({ kind: "info", title: "Folder opened", description: folderOf(result.path) })
            }
          >
            Show in folder
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </>
    );
  }

  const working = phase.kind === "working";

  return (
    <>
      <DialogBody>
        <ContentsList title="What the package contains">
          <ContentsItem icon={FileText}>
            Manifest with the package version, project name and classification
          </ContentsItem>
          <ContentsItem icon={MessagesSquare}>
            {pluralise(counts.conversations, "conversation")} and {pluralise(counts.messages, "message")}
          </ContentsItem>
          <ContentsItem icon={ScrollText}>{pluralise(counts.summaries, "summary", "summaries")}</ContentsItem>
          <ContentsItem icon={Tags}>Classification and provenance on every item</ContentsItem>
          <ContentsItem icon={ListChecks}>
            <Mono className="text-ink-soft">checksums.txt</Mono> covering every file
          </ContentsItem>
          <ContentsItem icon={Cpu} muted>
            Model files are never included
          </ContentsItem>
        </ContentsList>

        {working ? (
          <WorkingRow label="Writing package and checksums…" detail={`${fileName} to ${folder}`} />
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="export-folder">Destination</Label>
            <div className="flex items-center gap-2">
              <Input
                id="export-folder"
                mono
                readOnly
                value={folder}
                className="flex-1"
                aria-describedby="export-folder-hint"
              />
              <Button leading={<FolderOpen className="size-3.5" />} onClick={() => setFolder(EXPORT_FOLDER)}>
                Choose folder
              </Button>
            </div>
            <Hint>
              <span id="export-folder-hint">
                Written as <Mono>{fileName}</Mono>. The export is recorded in the evidence log as an export event; the
                log never holds content.
              </span>
            </Hint>
          </div>
        )}

        {phase.kind === "idle" && phase.error && (
          <Callout tone="deny" title="The package could not be written">
            {phase.error} Nothing was written. Check that the folder exists and you can write to it, then try again.
          </Callout>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={working}>
          Cancel
        </Button>
        <Button variant="primary" onClick={run} loading={working}>
          Export
        </Button>
      </DialogFooter>
    </>
  );
}

/* ================================================================== */
/* Import                                                              */
/* ================================================================== */

export function ImportPackageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && busy) return;
        onOpenChange(o);
      }}
      width="md"
      eyebrow={EYEBROW}
      hideClose={busy}
      bare
      title="Import a package"
      description="Adds a Project Package from another AIOS installation as a new project here. Nothing already on this installation is changed."
    >
      <ImportFlow onBusy={setBusy} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

interface PickedPackage {
  /** Desktop app: where the file is. The browser simulation has no files. */
  path?: string | undefined;
  file_name: string;
  size_bytes: number;
  version: string;
  exported_on: string;
  origin: string;
}

/** The prototype has no file system; choosing a package picks this sample. */
const SAMPLE_PACKAGE: PickedPackage = {
  file_name: "supplier-faq.aiosproj",
  size_bytes: 86 * 1024,
  version: "Project Package v1",
  exported_on: "19 Oct 2026",
  origin: "another installation",
};

type ImportPhase =
  { kind: "pick" } | { kind: "working" } | { kind: "done"; result: ImportResult } | { kind: "failed"; error: string };

function ImportFlow({ onBusy, onClose }: { onBusy: (b: boolean) => void; onClose: () => void }) {
  const navigate = useNavigate();
  const [file, setFile] = useState<PickedPackage | null>(null);
  const [phase, setPhase] = useState<ImportPhase>({ kind: "pick" });
  const importedId = phase.kind === "done" ? phase.result.project_id : undefined;
  const imported = useStore((s) => s.projects.find((p) => p.id === importedId));

  const run = async () => {
    if (!file) return;
    setPhase({ kind: "working" });
    onBusy(true);
    try {
      const outcome = await api.projects.importPackage(file.path);
      setPhase(outcome.ok ? { kind: "done", result: outcome.result } : { kind: "failed", error: outcome.error });
    } catch (e) {
      setPhase({ kind: "failed", error: e instanceof Error ? e.message : "The package could not be read." });
    } finally {
      onBusy(false);
    }
  };

  /** The system open dialog in the desktop app; the sample package in a browser. */
  const choose = async () => {
    const picked = await api.projects.choosePackage();
    if (picked === null && !api.backup.canChooseFolder()) {
      setFile(SAMPLE_PACKAGE);
      return;
    }
    if (picked)
      setFile({
        path: picked.path,
        file_name: picked.file_name,
        size_bytes: picked.size_bytes,
        version: "Project Package v1",
        exported_on: "",
        origin: "",
      });
  };

  const tryAnother = () => {
    setFile(null);
    setPhase({ kind: "pick" });
  };

  if (phase.kind === "done") {
    const { result } = phase;
    return (
      <>
        <DialogBody>
          <Callout tone="success" title={`Imported "${result.project_name}"`}>
            Added as a new project on this installation. Every item keeps the classification and provenance recorded in
            the package.
          </Callout>
          <KeyValue
            dense
            rows={[
              { k: "Conversations", v: <span className="tabular">{result.conversations}</span> },
              { k: "Messages", v: <span className="tabular">{result.messages}</span> },
              { k: "Summaries", v: <span className="tabular">{result.summaries}</span> },
              {
                k: "Classification",
                v: (
                  <span className="flex flex-wrap items-center gap-2">
                    <ClassChip value={imported?.classification ?? "internal"} />
                    <Mono>source: {imported?.classification_source ?? "import"}</Mono>
                  </span>
                ),
                hint: "as recorded",
              },
            ]}
          />
          {result.warnings.length > 0 && (
            <Callout tone="caution" title={pluralise(result.warnings.length, "warning")}>
              <ul className="flex flex-col gap-1">
                {result.warnings.map((w) => (
                  <li key={w} className="flex items-start gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-brass" aria-hidden />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          {result.remapped && (
            <Callout tone="neutral" compact>
              Identifiers were remapped because a project with these identifiers already exists; the originals are
              recorded in provenance.
            </Callout>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              navigate(`/projects/${result.project_id}`);
            }}
          >
            Open project
          </Button>
        </DialogFooter>
      </>
    );
  }

  const working = phase.kind === "working";
  const failed = phase.kind === "failed";

  return (
    <>
      <DialogBody>
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg border bg-paper px-3 py-2.5",
            file ? "border-line" : "border-dashed border-line-strong",
          )}
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-paper-raised text-ink-soft"
            aria-hidden
          >
            <PackageOpen className="size-4" />
          </span>
          <div className="min-w-0 flex-1" aria-live="polite">
            {file ? (
              <>
                <div className="truncate font-mono text-sm text-ink">{file.file_name}</div>
                <div className="mt-0.5 text-xs leading-4.5 text-ink-50">
                  <span className="tabular">{formatBytes(file.size_bytes, 0)}</span> ·{" "}
                  {file.path ? (
                    <span className="break-all">{file.path}</span>
                  ) : (
                    <>
                      {file.version} · exported {file.exported_on} from {file.origin}
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-ink">No package chosen</div>
                <div className="mt-0.5 text-xs leading-4.5 text-ink-50">
                  A <Mono>.aiosproj</Mono> file exported from AIOS.
                </div>
              </>
            )}
          </div>
          {!failed && (
            <Button size="sm" variant={file ? "ghost" : "secondary"} onClick={() => void choose()} disabled={working}>
              {file ? "Change" : "Choose package"}
            </Button>
          )}
        </div>

        {failed ? (
          <Callout tone="deny" title="Import failed">
            {phase.error}
            {!phase.error.includes("Nothing was imported") && " Nothing was imported."}
          </Callout>
        ) : working ? (
          <WorkingRow label="Verifying checksums…" detail="Nothing is written until every check passes." />
        ) : (
          <>
            <ContentsList title="Checked before anything is written">
              <ContentsItem icon={FileCheck}>Package version no newer than this installation's</ContentsItem>
              <ContentsItem icon={ListChecks}>Every checksum</ContentsItem>
              <ContentsItem icon={ScrollText}>Unknown fields kept</ContentsItem>
              <ContentsItem icon={Replace}>
                Identifier collisions remapped, with the originals recorded in provenance
              </ContentsItem>
              <ContentsItem icon={Tags}>Classification imported as recorded</ContentsItem>
            </ContentsList>
            <Hint>The import is recorded in the evidence log as an import event; the log never holds content.</Hint>
          </>
        )}
      </DialogBody>
      <DialogFooter>
        {failed ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" onClick={tryAnother}>
              Try another package
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={working}>
              Cancel
            </Button>
            <Button variant="primary" onClick={run} loading={working} disabled={!file}>
              Import
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
