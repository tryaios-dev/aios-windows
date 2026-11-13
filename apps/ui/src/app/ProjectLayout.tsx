import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { Archive, ArchiveRestore, Building2, FileDown, FileUp, MessageSquarePlus, MoreHorizontal, Pencil, Shield, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { selectProject, useStore } from '@/lib/store'
import { Button, IconButton } from '@/components/ui/button'
import { Badge, CLASS_META, ClassChip } from '@/components/ui/chips'
import { RouteTabs } from '@/components/ui/layout'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui/overlays'
import { Callout } from '@/components/ui/feedback'
import { ChangeClassDialog, DeleteProjectDialog, RenameDialog } from '@/features/projects/ProjectDialogs'
import { ExportProjectDialog, ImportPackageDialog } from '@/features/projects/PackageDialogs'

export function ProjectLayout() {
  const { projectId } = useParams()
  const project = useStore(selectProject(projectId))
  const setLastProject = useStore((s) => s.setLastProject)
  const companyFlag = useStore((s) => s.sim.companyFlag)
  const convCount = useStore((s) => s.conversations.filter((c) => c.project_id === projectId && !c.archived).length)
  const activityCount = useStore((s) => s.events.filter((e) => e.project_id === projectId || e.project_id === undefined).length)
  const navigate = useNavigate()
  const location = useLocation()
  const [rename, setRename] = useState(false)
  const [changeClass, setChangeClass] = useState(false)
  const [del, setDel] = useState(false)
  const [exp, setExp] = useState(false)
  const [imp, setImp] = useState(false)

  useEffect(() => {
    if (project && !project.archived) setLastProject(project.id)
  }, [project, setLastProject])

  if (!project) return <Navigate to="/" replace />

  const base = `/projects/${project.id}`
  const tab = location.pathname.endsWith('/activity') ? 'activity' : location.pathname.endsWith('/settings') ? 'settings' : 'conversations'

  const newConversation = () => {
    const conv = api.conversations.create(project.id)
    navigate(`${base}/c/${conv.id}`)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col border-b border-line-soft bg-paper px-5 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-lg font-semibold leading-7 text-ink">{project.name}</h1>
            <Tooltip content={CLASS_META[project.classification].summary}>
              <button onClick={() => setChangeClass(true)} className="rounded-sm" aria-label={`Sensitivity: ${CLASS_META[project.classification].label}. Change`}>
                <ClassChip value={project.classification} size="md" />
              </button>
            </Tooltip>
            {companyFlag && project.company_ai_enabled && (
              <Tooltip content="New conversations in this project use the company server while it can be reached">
                <span>
                  <Badge tone="ink" icon={<Building2 />}>Company server for new conversations</Badge>
                </span>
              </Tooltip>
            )}
            {project.archived && <Badge tone="neutral" icon={<Archive />}>Archived</Badge>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!project.archived && (
              <Button variant="primary" size="sm" leading={<MessageSquarePlus className="size-3.5" />} onClick={newConversation}>
                New conversation
              </Button>
            )}
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="Project actions">
                  <MoreHorizontal />
                </IconButton>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<Pencil />} onSelect={() => setRename(true)}>Rename</MenuItem>
                <MenuItem icon={<Shield />} onSelect={() => setChangeClass(true)}>Change sensitivity</MenuItem>
                <MenuSeparator />
                <MenuItem icon={<FileDown />} onSelect={() => setExp(true)}>Save as a file</MenuItem>
                <MenuItem icon={<FileUp />} onSelect={() => setImp(true)}>Add a project from a file</MenuItem>
                <MenuSeparator />
                {project.archived ? (
                  <MenuItem icon={<ArchiveRestore />} onSelect={() => api.projects.archive(project.id, false)}>Restore from archive</MenuItem>
                ) : (
                  <MenuItem icon={<Archive />} onSelect={() => { api.projects.archive(project.id, true); useStore.getState().toast({ kind: 'info', title: 'Project archived', description: 'You can still read and search it.', action: { label: 'Undo', onClick: () => api.projects.archive(project.id, false) } }) }}>Archive project</MenuItem>
                )}
                <MenuItem icon={<Trash2 />} destructive onSelect={() => setDel(true)}>Delete project</MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
        <RouteTabs
          className="mt-1"
          items={[
            { label: 'Conversations', active: tab === 'conversations', onSelect: () => navigate(base), count: convCount },
            { label: 'Activity', active: tab === 'activity', onSelect: () => navigate(`${base}/activity`), count: activityCount },
            { label: 'Settings', active: tab === 'settings', onSelect: () => navigate(`${base}/settings`) },
          ]}
        />
      </header>
      {project.archived && (
        <div className="border-b border-line-soft bg-paper px-5 py-2">
          <Callout tone="neutral" compact action={<Button size="sm" onClick={() => api.projects.archive(project.id, false)}>Restore project</Button>}>
            This project is archived. You can still read and search it. Restore it to start new conversations.
          </Callout>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>

      <RenameDialog open={rename} onOpenChange={setRename} title="Rename project" label="Project name" initial={project.name} onSubmit={(n) => api.projects.rename(project.id, n)} />
      <ChangeClassDialog open={changeClass} onOpenChange={setChangeClass} project={project} />
      <DeleteProjectDialog open={del} onOpenChange={setDel} project={project} />
      <ExportProjectDialog open={exp} onOpenChange={setExp} project={project} />
      <ImportPackageDialog open={imp} onOpenChange={setImp} />
    </div>
  )
}
