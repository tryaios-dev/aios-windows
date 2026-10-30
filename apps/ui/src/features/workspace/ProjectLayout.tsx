import { useEffect } from "react";
import { Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { Archive, FileDown, FileUp, MessageSquarePlus, MoreHorizontal, Pencil, Shield, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { CLASS_META, ClassChip } from "@/components/ui/chips";
import { RouteTabs } from "@/components/ui/layout";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from "@/components/ui/overlays";
import { selectProject, useWorkspaceStore } from "./store";

/**
 * A project's frame: name, classification chip, "New conversation", the
 * actions menu, and the Conversations / Evidence / Project settings tabs.
 * The actions are listed but disabled until their dialogs are built.
 */
export function ProjectLayout() {
  const { projectId } = useParams();
  const project = useWorkspaceStore(selectProject(projectId));
  const setLastProject = useWorkspaceStore((s) => s.setLastProject);
  const convCount = useWorkspaceStore((s) => (projectId ? (s.conversationCounts[projectId] ?? 0) : 0));
  const evidenceCount = useWorkspaceStore((s) => (projectId ? (s.evidenceCounts[projectId] ?? 0) : 0));
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (project && !project.archived) setLastProject(project.id);
  }, [project, setLastProject]);

  if (!project) return <Navigate to="/" replace />;

  const base = `/projects/${project.id}`;
  const tab = location.pathname.endsWith("/evidence") ? "evidence" : location.pathname.endsWith("/settings") ? "settings" : "conversations";
  const meta = CLASS_META[project.classification];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col border-b border-line-soft bg-paper px-5 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-lg font-semibold leading-7 text-ink">{project.name}</h1>
            <Tooltip content={meta.summary}>
              <span className="rounded-sm" aria-label={`Classification ${meta.label}`}>
                <ClassChip value={project.classification} size="md" />
              </span>
            </Tooltip>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!project.archived && (
              <Button variant="primary" size="sm" leading={<MessageSquarePlus className="size-3.5" />}>
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
                <MenuItem icon={<Pencil />} disabled>
                  Rename
                </MenuItem>
                <MenuItem icon={<Shield />} disabled>
                  Change classification
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<FileDown />} disabled>
                  Export Project Package
                </MenuItem>
                <MenuItem icon={<FileUp />} disabled>
                  Import Project Package
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Archive />} disabled>
                  Archive project
                </MenuItem>
                <MenuItem icon={<Trash2 />} destructive disabled>
                  Delete project
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
        <RouteTabs
          className="mt-1"
          items={[
            { label: "Conversations", active: tab === "conversations", onSelect: () => navigate(base), count: convCount },
            { label: "Evidence", active: tab === "evidence", onSelect: () => navigate(`${base}/evidence`), count: evidenceCount },
            { label: "Project settings", active: tab === "settings", onSelect: () => navigate(`${base}/settings`) },
          ]}
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
