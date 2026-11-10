import { useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router";
import { Archive, ChevronDown, ChevronsLeft, ChevronsRight, Cpu, FlaskConical, FolderPlus, Search, Settings2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useStore } from "@/bridge/sim/store";
import { Wordmark } from "@/components/ui/brand";
import { IconButton } from "@/components/ui/button";
import { ClassChip, StatusDot } from "@/components/ui/chips";
import { Kbd } from "@/components/ui/layout";
import { Tooltip } from "@/components/ui/overlays";
import { useEngineStatus, useWriterStatus } from "@/components/app/useEngineStatus";
import { CreateProjectDialog } from "@/features/projects";

export type SidebarMode = "full" | "rail" | "sheet";

export function Sidebar({
  mode = "full",
  onCollapse,
  onExpand,
}: {
  mode?: SidebarMode | undefined;
  onCollapse?: (() => void) | undefined;
  onExpand?: (() => void) | undefined;
}) {
  const collapsed = mode === "rail";
  const setCollapsed = (v: boolean) => (v ? onCollapse?.() : onExpand?.());
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const projects = useStore((s) => s.projects);
  const conversations = useStore((s) => s.conversations);
  const updateAvailable = useStore((s) => !!s.settings.update_available);
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const active = useMemo(() => projects.filter((p) => !p.archived), [projects]);
  const archived = useMemo(() => projects.filter((p) => p.archived), [projects]);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of conversations) if (!c.archived) m[c.project_id] = (m[c.project_id] ?? 0) + 1;
    return m;
  }, [conversations]);

  const engine = useEngineStatus();
  const writer = useWriterStatus();

  const isSettings = location.pathname.startsWith("/settings");
  const isModels = location.pathname.startsWith("/models");
  const isSpike = location.pathname.startsWith("/spike"); // SPIKE-D04

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col bg-paper-deep/70 transition-[width] duration-(--duration-panel) ease-(--ease-out)",
        mode === "sheet" ? "w-full bg-white" : "border-r border-line",
        collapsed ? "w-16" : mode === "sheet" ? "" : "w-64",
      )}
      aria-label="Navigation"
    >
      {/* Brand */}
      <div className={cn("flex h-14 items-center", collapsed ? "justify-center px-0" : "justify-between pl-4 pr-2")}>
        <button
          className="flex items-center rounded-md"
          onClick={() => navigate("/")}
          aria-label="Go to your last project"
        >
          <Wordmark height={collapsed ? 11 : 16} />
        </button>
        {!collapsed && onCollapse && (
          <Tooltip
            content={
              <span>
                Collapse sidebar <Kbd className="ml-1 border-white/20 bg-white/10 text-paper">Ctrl \</Kbd>
              </span>
            }
          >
            <IconButton label="Collapse sidebar" size="sm" onClick={() => setCollapsed(true)}>
              <ChevronsLeft />
            </IconButton>
          </Tooltip>
        )}
      </div>

      {/* Search */}
      <div className={cn("px-3 pb-2", collapsed && "px-2.5")}>
        {collapsed ? (
          <Tooltip content="Search all conversations (Ctrl K)" side="right">
            <button
              onClick={() => setCommandOpen(true)}
              className="flex h-9 w-full items-center justify-center rounded-md border border-line bg-paper-raised text-ink-50 hover:bg-white hover:text-ink"
              aria-label="Search"
            >
              <Search className="size-4" />
            </button>
          </Tooltip>
        ) : (
          <button
            onClick={() => setCommandOpen(true)}
            className="flex h-9 w-full items-center gap-2 rounded-md border border-line bg-paper-raised pl-2.5 pr-1.5 text-left text-sm text-ink-50 transition-colors duration-(--duration-micro) hover:border-line-strong hover:bg-white hover:text-ink"
          >
            <Search className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate whitespace-nowrap">Search conversations</span>
            <Kbd className="shrink-0 px-0.5 tracking-tighter">Ctrl K</Kbd>
          </button>
        )}
      </div>

      {/* Projects */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <div
          className={cn(
            "flex items-center justify-between pb-1 pt-2",
            collapsed ? "justify-center px-0" : "pl-2 pr-0.5",
          )}
        >
          {!collapsed && <span className="label-mono">Projects</span>}
          <Tooltip content="New project" side="right">
            <IconButton label="New project" size="sm" onClick={() => setCreateOpen(true)}>
              <FolderPlus />
            </IconButton>
          </Tooltip>
        </div>
        <nav className="flex flex-col gap-0.5" aria-label="Projects">
          {active.map((p) => {
            const isActive = p.id === projectId;
            return (
              <Tooltip key={p.id} content={collapsed ? p.name : undefined} side="right">
                <NavLink
                  to={`/projects/${p.id}`}
                  className={cn(
                    "group flex items-center gap-2 rounded-md text-sm transition-colors duration-(--duration-micro)",
                    collapsed ? "h-9 justify-center px-0" : "h-8 px-2",
                    isActive
                      ? "bg-white text-ink shadow-[0_1px_0_rgba(22,33,27,0.05)] ring-1 ring-line"
                      : "text-ink-soft hover:bg-ink-6 hover:text-ink",
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <ClassChip value={p.classification} size="xs" labelled={false} />
                  <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{p.name}</span>
                  {!collapsed && (
                    <span className={cn("font-mono text-2xs tabular", isActive ? "text-ink-50" : "text-ink-50")}>
                      {counts[p.id] ?? 0}
                    </span>
                  )}
                </NavLink>
              </Tooltip>
            );
          })}
          {active.length === 0 && !collapsed && (
            <p className="px-2 py-3 text-xs text-ink-50">No projects yet. Create one to start a conversation.</p>
          )}
        </nav>

        {archived.length > 0 && (
          <div className="mt-3">
            {collapsed ? (
              <Tooltip content={`${archived.length} archived project${archived.length === 1 ? "" : "s"}`} side="right">
                <button
                  onClick={() => {
                    setCollapsed(false);
                    setShowArchived(true);
                  }}
                  className="flex h-9 w-full items-center justify-center rounded-md text-ink-50 hover:bg-ink-6 hover:text-ink"
                  aria-label="Archived projects"
                >
                  <Archive className="size-4" />
                </button>
              </Tooltip>
            ) : (
              <>
                <button
                  onClick={() => setShowArchived((v) => !v)}
                  className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs text-ink-50 hover:bg-ink-6 hover:text-ink"
                  aria-expanded={showArchived}
                >
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform duration-(--duration-micro)",
                      !showArchived && "-rotate-90",
                    )}
                  />
                  <span className="label-mono">Archived</span>
                  <span className="ml-auto font-mono text-2xs text-ink-50">{archived.length}</span>
                </button>
                {showArchived && (
                  <nav className="mt-0.5 flex flex-col gap-0.5" aria-label="Archived projects">
                    {archived.map((p) => (
                      <NavLink
                        key={p.id}
                        to={`/projects/${p.id}`}
                        className={({ isActive }) =>
                          cn(
                            "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-ink-50 hover:bg-ink-6 hover:text-ink",
                            isActive && "bg-white text-ink ring-1 ring-line",
                          )
                        }
                      >
                        <ClassChip value={p.classification} size="xs" labelled={false} className="opacity-60" />
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      </NavLink>
                    ))}
                  </nav>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Secondary navigation */}
      <div className={cn("flex flex-col gap-0.5 border-t border-line-soft px-2 pt-2", collapsed && "items-center")}>
        <SideLink to="/spike" icon={<FlaskConical />} label="Local answer (spike)" active={isSpike} collapsed={collapsed} /> {/* SPIKE-D04 */}
        <SideLink to="/models" icon={<Cpu />} label="Models" active={isModels} collapsed={collapsed} />
        <SideLink
          to="/settings"
          icon={<Settings2 />}
          label="Settings"
          active={isSettings}
          collapsed={collapsed}
          dot={updateAvailable}
          dotLabel="Update available"
        />
      </div>

      {/* Status strip */}
      <div
        className={cn(
          "mt-2 border-t border-line-soft",
          collapsed ? "flex flex-col items-center gap-2 px-0 py-3" : "px-3 py-3",
        )}
      >
        {collapsed ? (
          <>
            <Tooltip content={`${engine.label}. ${engine.detail}`} side="right">
              <span className="flex size-7 items-center justify-center rounded-md">
                <StatusDot tone={engine.tone} pulse={engine.pulse} label={engine.label} />
              </span>
            </Tooltip>
            <Tooltip content={`${writer.label}. ${writer.detail}`} side="right">
              <span className="flex size-7 items-center justify-center rounded-md">
                <StatusDot tone={writer.tone} label={writer.label} />
              </span>
            </Tooltip>
            {onExpand && (
              <IconButton label="Expand sidebar" size="sm" onClick={() => setCollapsed(false)}>
                <ChevronsRight />
              </IconButton>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <StatusRow
              tone={engine.tone}
              pulse={engine.pulse}
              label={engine.label}
              detail={engine.detail}
              onClick={() => navigate("/settings/health")}
            />
            <StatusRow
              tone={writer.tone}
              label={writer.label}
              detail={writer.detail}
              onClick={() => navigate("/settings/health")}
            />
          </div>
        )}
      </div>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </aside>
  );
}

function SideLink({
  to,
  icon,
  label,
  active,
  collapsed,
  dot,
  dotLabel,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  dot?: boolean | undefined;
  dotLabel?: string | undefined;
}) {
  const inner = (
    <NavLink
      to={to}
      className={cn(
        "relative flex items-center gap-2.5 rounded-md text-sm transition-colors duration-(--duration-micro)",
        collapsed ? "size-9 justify-center" : "h-8 w-full px-2",
        active ? "bg-white text-ink ring-1 ring-line" : "text-ink-soft hover:bg-ink-6 hover:text-ink",
      )}
      aria-current={active ? "page" : undefined}
    >
      <span className="[&>svg]:size-4">{icon}</span>
      <span className={collapsed ? "sr-only" : "flex-1"}>{label}</span>
      {dot && (
        <span
          className={cn("size-1.5 rounded-full bg-brass", collapsed && "absolute right-1.5 top-1.5")}
          aria-label={dotLabel}
          role="img"
        />
      )}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={label} side="right">
      {inner}
    </Tooltip>
  ) : (
    inner
  );
}

function StatusRow({
  tone,
  pulse,
  label,
  detail,
  onClick,
}: {
  tone: React.ComponentProps<typeof StatusDot>["tone"];
  pulse?: boolean | undefined;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-ink-6"
      aria-label={`${label}. ${detail}. Open health`}
    >
      <StatusDot tone={tone} pulse={pulse} className="mt-1.5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-ink">{label}</span>
        <span className="block truncate text-2xs leading-4 text-ink-50">{detail}</span>
      </span>
    </button>
  );
}
