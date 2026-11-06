import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { Archive, ArchiveRestore, Check, FileDown, FileUp, Lock, Shield, Trash2 } from "lucide-react";
import { api } from "@/bridge/api";
import { selectProject, useStore } from "@/bridge/sim/store";
import type { Project } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { CLASS_META, ClassChip, StatusDot } from "@/components/ui/chips";
import { Input, Switch } from "@/components/ui/fields";
import { Hash } from "@/components/ui/layout";
import { Ledger, PanelNote, SettingGroup, SettingPanel, SettingRow } from "@/components/app/SettingRow";
import {
  ChangeClassDialog,
  ClassLegend,
  CompanyAiDialog,
  DeleteProjectDialog,
  ReviewedCopyNote,
} from "./ProjectDialogs";
import { ExportProjectDialog, ImportPackageDialog } from "./PackageDialogs";

/**
 * Project settings tab (MVP 4.2, 4.6, M-04, M-09; tickets K-02, K-09, K-10).
 * Rendered inside ProjectLayout under the project header; takes the remaining
 * height and scrolls. Shares the setting-row language with Settings, and reuses
 * the dialogs from ProjectDialogs and PackageDialogs.
 */
export function ProjectSettingsView() {
  const { projectId } = useParams();
  const project = useStore(selectProject(projectId));
  const [changeClass, setChangeClass] = useState(false);
  const [companyAi, setCompanyAi] = useState(false);
  const [exp, setExp] = useState(false);
  const [imp, setImp] = useState(false);
  const [del, setDel] = useState(false);

  // ProjectLayout redirects when the project is gone; render nothing in between.
  if (!project) return null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex w-full max-w-2xl flex-col gap-8 px-6 py-6 animate-rise">
        <h2 className="sr-only">Project settings</h2>
        <NameGroup key={project.id} project={project} />
        <ClassificationGroup project={project} onChange={() => setChangeClass(true)} />
        <ProviderGroup project={project} onRequestCompanyAi={() => setCompanyAi(true)} />
        <PackageGroup onExport={() => setExp(true)} onImport={() => setImp(true)} />
        <ArchiveDeleteGroup project={project} onDelete={() => setDel(true)} />
        <RecordLedger project={project} />
      </div>

      <ChangeClassDialog open={changeClass} onOpenChange={setChangeClass} project={project} />
      <CompanyAiDialog open={companyAi} onOpenChange={setCompanyAi} project={project} />
      <ExportProjectDialog open={exp} onOpenChange={setExp} project={project} />
      <ImportPackageDialog open={imp} onOpenChange={setImp} />
      <DeleteProjectDialog open={del} onOpenChange={setDel} project={project} />
    </div>
  );
}

/* ---------------- 1. Name ---------------- */

function NameGroup({ project }: { project: Project }) {
  const [name, setName] = useState(project.name);
  const [synced, setSynced] = useState(project.name);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | null>(null);

  // Follow renames made elsewhere (header menu, sidebar) without an effect:
  // adjust the draft during render when the stored name changes.
  if (synced !== project.name) {
    setSynced(project.name);
    setName(project.name);
  }

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const trimmed = name.trim();
  const changed = trimmed.length > 0 && trimmed !== project.name;

  const save = () => {
    if (!changed) return;
    api.projects.rename(project.id, trimmed);
    setSaved(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaved(false), 1600);
  };

  return (
    <SettingGroup title="Name">
      <SettingPanel>
        <SettingRow
          htmlFor="project-settings-name"
          label="Project name"
          hint="Shown in the sidebar, on every conversation and in the file name of an export."
          control={
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <span className="flex w-5 items-center justify-end" aria-live="polite">
                {saved && <Check className="size-3.5 text-green animate-in" aria-label="Saved" role="img" />}
              </span>
              <Input
                id="project-settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className="w-56"
                autoComplete="off"
              />
              <Button type="submit" variant="primary" disabled={!changed}>
                Save
              </Button>
            </form>
          }
        />
      </SettingPanel>
    </SettingGroup>
  );
}

/* ---------------- 2. Classification ---------------- */

function ClassificationGroup({ project, onChange }: { project: Project; onChange: () => void }) {
  const meta = CLASS_META[project.classification];
  return (
    <SettingGroup title="Classification">
      <SettingPanel>
        <SettingRow
          align="start"
          label={<ClassChip value={project.classification} size="md" />}
          hint={meta.detail}
          control={
            <Button leading={<Shield className="size-3.5" />} onClick={onChange}>
              Change classification
            </Button>
          }
        >
          {project.derived_from_project_id && <ReviewedCopyNote project={project} />}
        </SettingRow>
        <div className="bg-paper-raised px-4 py-3">
          <ClassLegend />
        </div>
        <PanelNote>Recorded on every conversation, message and summary; not enforced in this version.</PanelNote>
      </SettingPanel>
    </SettingGroup>
  );
}

/* ---------------- 3. Where conversations run ---------------- */

function ProviderGroup({ project, onRequestCompanyAi }: { project: Project; onRequestCompanyAi: () => void }) {
  const companyFlag = useStore((s) => s.sim.companyFlag);
  const company = useStore((s) => s.health.company);

  const onCheckedChange = (checked: boolean) => {
    if (checked) {
      // The dialog performs the call on confirm; the switch stays off until then.
      onRequestCompanyAi();
      return;
    }
    api.projects.setCompanyAi(project.id, false, true);
    useStore
      .getState()
      .toast({ kind: "info", title: "Company AI is off for new conversations", description: "Nothing was sent." });
  };

  return (
    <SettingGroup title="Where conversations run">
      <SettingPanel>
        {!companyFlag ? (
          <PanelNote tone="green" icon={<Lock />} className="bg-white py-3 text-sm leading-5">
            <span className="font-medium text-ink">Local only.</span> The company provider is not enabled on this
            installation; every answer comes from the model on this machine.
          </PanelNote>
        ) : (
          <>
            <SettingRow
              htmlFor="project-company-ai"
              label="Use Company AI for new conversations in this project"
              hint="Conversation content will be sent to the company server. Turning this on asks first; turning it off never asks and sends nothing."
              control={
                <Switch
                  id="project-company-ai"
                  checked={project.company_ai_enabled}
                  onCheckedChange={onCheckedChange}
                />
              }
            />
            <Ledger
              dense
              rows={[
                {
                  k: "Company server",
                  v: company.model_name,
                  hint: <span className="font-mono tracking-[0.02em]">{company.base_url}</span>,
                },
                {
                  k: "Reachable",
                  v: (
                    <span className="inline-flex items-center gap-1.5 text-ink-soft">
                      <StatusDot
                        tone={company.reachable ? "green" : "deny"}
                        label={company.reachable ? "Reachable" : "Not reachable"}
                      />
                      {company.reachable
                        ? "Reachable now"
                        : "Not reachable at the moment; new conversations start on Local"}
                    </span>
                  ),
                },
              ]}
            />
            <PanelNote>
              New conversations use Company AI while it is reachable. Existing conversations stay where they are. Moving
              a conversation to Company AI always asks; moving one back to Local never asks.
            </PanelNote>
          </>
        )}
      </SettingPanel>
    </SettingGroup>
  );
}

/* ---------------- 4. Project Package ---------------- */

function PackageGroup({ onExport, onImport }: { onExport: () => void; onImport: () => void }) {
  return (
    <SettingGroup
      title="Project Package"
      description="Project Package v1 moves a project between AIOS installations as one file."
    >
      <SettingPanel>
        <SettingRow
          label="Export this project as a Project Package"
          hint="One .aiosproj file with the manifest, conversations, messages, summaries, classification and provenance on every item, and checksums. Model files are never included."
          control={
            <Button leading={<FileDown className="size-3.5" />} onClick={onExport}>
              Export Project Package
            </Button>
          }
        />
        <SettingRow
          label="Import a package into this installation"
          hint="Adds the package as a new project. Every checksum is verified before anything is written; colliding identifiers are remapped and the originals kept in provenance."
          control={
            <Button leading={<FileUp className="size-3.5" />} onClick={onImport}>
              Import Project Package
            </Button>
          }
        />
      </SettingPanel>
    </SettingGroup>
  );
}

/* ---------------- 5. Archive or delete ---------------- */

function ArchiveDeleteGroup({ project, onDelete }: { project: Project; onDelete: () => void }) {
  return (
    <SettingGroup title="Archive or delete">
      <SettingPanel>
        <SettingRow
          label={project.archived ? "Restore from archive" : "Archive project"}
          hint={
            project.archived
              ? "This project is archived. Reading and search still work; restore it to start new conversations."
              : "Moves the project out of the main list. Reading and search still work, and nothing is deleted."
          }
          control={
            project.archived ? (
              <Button
                leading={<ArchiveRestore className="size-3.5" />}
                onClick={() => api.projects.archive(project.id, false)}
              >
                Restore from archive
              </Button>
            ) : (
              <Button leading={<Archive className="size-3.5" />} onClick={() => api.projects.archive(project.id, true)}>
                Archive project
              </Button>
            )
          }
        />
        <SettingRow
          label="Delete project"
          hint="Deleting removes the project, its conversations and summaries from this device. The evidence log keeps a deletion event and never holds content, so nothing can be recovered from it."
          control={
            <Button variant="destructive" leading={<Trash2 className="size-3.5" />} onClick={onDelete}>
              Delete project
            </Button>
          }
        />
      </SettingPanel>
    </SettingGroup>
  );
}

/* ---------------- 6. Record ---------------- */

function RecordLedger({ project }: { project: Project }) {
  return (
    <Ledger
      dense
      className="border-t border-line-soft"
      rows={[
        { k: "Created", v: formatDateTime(project.created_at), mono: true },
        { k: "Updated", v: formatDateTime(project.updated_at), mono: true },
        { k: "Project id", v: <Hash value={project.id} full /> },
      ]}
    />
  );
}
