import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { Archive, ArchiveRestore, FileDown, FileUp, Shield, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { selectProject, useStore } from '@/lib/store'
import type { Project } from '@/lib/types'
import { formatDateTime } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { CLASS_META, ClassChip, StatusDot } from '@/components/ui/chips'
import { Input, Switch } from '@/components/ui/fields'
import { Hash } from '@/components/ui/layout'
import { Ledger, PanelNote, SettingGroup, SettingPanel, SettingRow } from '@/features/settings/SettingRow'
import { DrawnCheck } from '@/features/settings/shared'
import { ChangeClassDialog, ClassLegend, CompanyAiDialog, DeleteProjectDialog, Disclosure, ReviewedCopyNote, SENSITIVITY_NOTE } from './ProjectDialogs'
import { ExportProjectDialog, ImportPackageDialog } from './PackageDialogs'

/**
 * Project settings tab (MVP 4.2, 4.6, M-04, M-09; tickets K-02, K-09, K-10).
 * Rendered inside ProjectLayout under the project header; takes the remaining
 * height and scrolls. Shares the setting-row language with Settings, and reuses
 * the dialogs from ProjectDialogs and PackageDialogs.
 */
export function ProjectSettingsView() {
  const { projectId } = useParams()
  const project = useStore(selectProject(projectId))
  const companyFlag = useStore((s) => s.sim.companyFlag)
  const [changeClass, setChangeClass] = useState(false)
  const [companyAi, setCompanyAi] = useState(false)
  const [exp, setExp] = useState(false)
  const [imp, setImp] = useState(false)
  const [del, setDel] = useState(false)

  // ProjectLayout redirects when the project is gone; render nothing in between.
  if (!project) return null

  return (
    <div className="scroll-stable min-h-0 flex-1 overflow-y-auto">
      {/* Starts on the same left edge as the project name above it. Fades in; nothing moves. */}
      <div className="flex w-full max-w-[46rem] animate-fade flex-col gap-9 px-5 py-7">
        <h2 className="sr-only">Project settings</h2>
        <NameGroup key={project.id} project={project} />
        <SensitivityGroup project={project} onChange={() => setChangeClass(true)} />
        {/* The company server exists only in lab builds; the pilot never sees this group. */}
        {companyFlag && <WhereItRunsGroup project={project} onRequestCompanyAi={() => setCompanyAi(true)} />}
        <MoveGroup onExport={() => setExp(true)} onImport={() => setImp(true)} />
        <ArchiveDeleteGroup project={project} onDelete={() => setDel(true)} />
        <RecordLedger project={project} />
      </div>

      <ChangeClassDialog open={changeClass} onOpenChange={setChangeClass} project={project} />
      <CompanyAiDialog open={companyAi} onOpenChange={setCompanyAi} project={project} />
      <ExportProjectDialog open={exp} onOpenChange={setExp} project={project} />
      <ImportPackageDialog open={imp} onOpenChange={setImp} />
      <DeleteProjectDialog open={del} onOpenChange={setDel} project={project} />
    </div>
  )
}

/* ---------------- 1. Name ---------------- */

function NameGroup({ project }: { project: Project }) {
  const [name, setName] = useState(project.name)
  const [synced, setSynced] = useState(project.name)
  const [saved, setSaved] = useState(false)
  const timer = useRef<number | null>(null)

  // Follow renames made elsewhere (header menu, sidebar) without an effect:
  // adjust the draft during render when the stored name changes.
  if (synced !== project.name) {
    setSynced(project.name)
    setName(project.name)
  }

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const trimmed = name.trim()
  const empty = trimmed.length === 0
  const changed = !empty && trimmed !== project.name

  const save = () => {
    if (!changed) return
    api.projects.rename(project.id, trimmed)
    setSaved(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <SettingGroup title="Name">
      <SettingPanel>
        <SettingRow
          htmlFor="project-settings-name"
          label="Project name"
          hint={empty ? <span className="text-deny">A project needs a name.</span> : 'Shown in the sidebar and used to name the file when you save this project.'}
          control={
            <form
              className="flex max-w-full items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                save()
              }}
            >
              <Input id="project-settings-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="w-60 min-w-0 shrink" autoComplete="off" aria-invalid={empty || undefined} />
              {/* One fixed width for both labels, so "Saved" does not nudge the field. */}
              <Button type="submit" variant={changed ? 'primary' : 'secondary'} className="w-[5.5rem]" disabled={!changed && !saved} leading={saved && !changed ? <DrawnCheck className="size-3.5 text-green" /> : undefined}>
                <span aria-live="polite">{saved && !changed ? 'Saved' : 'Save'}</span>
              </Button>
            </form>
          }
        />
      </SettingPanel>
    </SettingGroup>
  )
}

/* ---------------- 2. Sensitivity ---------------- */

function SensitivityGroup({ project, onChange }: { project: Project; onChange: () => void }) {
  const meta = CLASS_META[project.classification]
  return (
    <SettingGroup title="Sensitivity">
      <SettingPanel>
        <SettingRow
          align="start"
          label={<ClassChip value={project.classification} size="md" />}
          hint={meta.summary}
          control={
            <Button leading={<Shield className="size-3.5" />} onClick={onChange}>
              Change sensitivity
            </Button>
          }
        >
          {project.derived_from_project_id && <ReviewedCopyNote project={project} />}
        </SettingRow>
        <div className="bg-paper-raised px-5 py-4">
          <div className="label-mono mb-2">The three labels</div>
          <ClassLegend />
        </div>
        <PanelNote>{SENSITIVITY_NOTE}</PanelNote>
      </SettingPanel>
    </SettingGroup>
  )
}

/* ---------------- 3. Where conversations run (lab only) ---------------- */

function WhereItRunsGroup({ project, onRequestCompanyAi }: { project: Project; onRequestCompanyAi: () => void }) {
  const company = useStore((s) => s.health.company)

  const onCheckedChange = (checked: boolean) => {
    if (checked) {
      // The dialog performs the call on confirm; the switch stays off until then.
      onRequestCompanyAi()
      return
    }
    api.projects.setCompanyAi(project.id, false, true)
    useStore.getState().toast({ kind: 'info', title: 'New conversations will stay on this computer', description: 'Nothing was sent.' })
  }

  return (
    <SettingGroup title="Where conversations run">
      <SettingPanel>
        <SettingRow
          htmlFor="project-company-ai"
          label="Use Company AI for new conversations in this project"
          hint="New conversations are sent to the company server. Turning this on asks first. Turning it off never asks and sends nothing."
          control={<Switch id="project-company-ai" checked={project.company_ai_enabled} onCheckedChange={onCheckedChange} />}
        />
        <Ledger
          dense
          rows={[
            { k: 'Company server', v: company.model_name, hint: <span className="font-mono tracking-[0.02em]">{company.base_url}</span> },
            {
              k: 'Connection',
              v: (
                <span className="inline-flex items-center gap-1.5 text-ink-soft">
                  <StatusDot tone={company.reachable ? 'green' : 'deny'} label={company.reachable ? 'Connected' : 'Not connected'} />
                  {company.reachable ? 'It can be reached now.' : 'It cannot be reached at the moment. New conversations start on this computer.'}
                </span>
              ),
            },
          ]}
        />
        <PanelNote>Conversations you already have stay where they are. Moving one to the company server always asks first. Moving one back to this computer never asks.</PanelNote>
      </SettingPanel>
    </SettingGroup>
  )
}

/* ---------------- 4. Move this project to another computer ---------------- */

function MoveGroup({ onExport, onImport }: { onExport: () => void; onImport: () => void }) {
  return (
    <SettingGroup title="Move this project to another computer" description="A project file carries one project between computers that run AIOS.">
      <SettingPanel>
        <SettingRow
          label="Save this project as a file"
          hint="One file with your conversations and their summaries. Open it in AIOS on the other computer."
          control={
            <Button leading={<FileDown className="size-3.5" />} onClick={onExport}>
              Save as a file
            </Button>
          }
        />
        <SettingRow
          label="Add a project from a file"
          hint="Adds a project that was saved from AIOS. Nothing already here is changed."
          control={
            <Button leading={<FileUp className="size-3.5" />} onClick={onImport}>
              Add from a file
            </Button>
          }
        />
      </SettingPanel>
    </SettingGroup>
  )
}

/* ---------------- 5. Archive or delete ---------------- */

function ArchiveDeleteGroup({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const archive = () => {
    api.projects.archive(project.id, true)
    useStore.getState().toast({ kind: 'info', title: 'Project archived', description: 'You can still read and search it.', action: { label: 'Undo', onClick: () => api.projects.archive(project.id, false) } })
  }
  const restore = () => {
    api.projects.archive(project.id, false)
    useStore.getState().toast({ kind: 'success', title: 'Project restored', description: 'It is back in the main list.' })
  }
  return (
    <SettingGroup title="Archive or delete">
      <SettingPanel>
        <SettingRow
          label={project.archived ? 'Restore from archive' : 'Archive project'}
          hint={
            project.archived
              ? 'This project is archived. You can still read and search it. Restore it to start new conversations.'
              : 'Moves the project out of the main list. You can still read and search it. Nothing is deleted.'
          }
          control={
            project.archived ? (
              <Button leading={<ArchiveRestore className="size-3.5" />} onClick={restore}>
                Restore from archive
              </Button>
            ) : (
              <Button leading={<Archive className="size-3.5" />} onClick={archive}>
                Archive project
              </Button>
            )
          }
        />
        <SettingRow
          label="Delete project"
          hint="Removes the project and its conversations from this computer. It cannot be undone."
          control={
            // Quiet until pressed: the confirmation that follows carries the solid red button.
            <Button className="border-deny/30 text-deny hover:border-deny/50 hover:bg-deny-soft active:bg-deny-tint" leading={<Trash2 className="size-3.5" />} onClick={onDelete}>
              Delete project
            </Button>
          }
        />
      </SettingPanel>
    </SettingGroup>
  )
}

/* ---------------- 6. Record ---------------- */

function RecordLedger({ project }: { project: Project }) {
  return (
    <SettingGroup title="About this project">
      <SettingPanel>
        <Ledger
          dense
          rows={[
            { k: 'Created', v: formatDateTime(project.created_at), mono: true },
            { k: 'Last changed', v: formatDateTime(project.updated_at), mono: true },
          ]}
        />
        <div className="bg-paper-raised px-5 py-1.5">
          <Disclosure label="Details">
            <dl className="grid grid-cols-[minmax(132px,34%)_1fr] items-baseline gap-x-6 pb-2">
              <dt className="label-mono">Project ID</dt>
              <dd className="min-w-0">
                <Hash value={project.id} full />
              </dd>
            </dl>
          </Disclosure>
        </div>
      </SettingPanel>
    </SettingGroup>
  )
}
