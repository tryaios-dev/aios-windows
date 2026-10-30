import type * as React from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router";
import { ChevronsLeft, ChevronsRight, Cpu, FolderPlus, Search, Settings2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Wordmark } from "@/components/ui/brand";
import { IconButton } from "@/components/ui/button";
import { ClassChip, StatusDot } from "@/components/ui/chips";
import { Kbd } from "@/components/ui/layout";
import { Tooltip } from "@/components/ui/overlays";
import { useWorkspaceStore } from "./store";
import { useEngineStatus, useWriterStatus, type StatusLine } from "./useEngineStatus";

export type SidebarMode = "full" | "rail";

/**
 * Left navigation: wordmark, search, projects, Models and Settings, and the
 * engine and evidence status strip. Search and "New project" are not wired yet.
 */
export function Sidebar({ mode = "full", onCollapse, onExpand }: { mode?: SidebarMode; onCollapse?: (() => void) | undefined; onExpand?: (() => void) | undefined }) {
  const collapsed = mode === "rail";
  const projects = useWorkspaceStore((s) => s.projects);
  const counts = useWorkspaceStore((s) => s.conversationCounts);
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const engine = useEngineStatus();
  const writer = useWriterStatus();

  const active = projects.filter((p) => !p.archived);
  const isSettings = location.pathname.startsWith("/settings");
  const isModels = location.pathname.startsWith("/models");

  return (
    <aside
      className={cn("flex h-full shrink-0 flex-col border-r border-line bg-paper-deep/70 transition-[width] duration-(--duration-panel) ease-(--ease-out)", collapsed ? "w-16" : "w-64")}
      aria-label="Navigation"
    >
      {/* Brand */}
      <div className={cn("flex h-14 items-center", collapsed ? "justify-center px-0" : "justify-between pl-4 pr-2")}>
        <button type="button" className="flex items-center rounded-md" onClick={() => navigate("/")} aria-label="Go to your last project">
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
            <IconButton label="Collapse sidebar" size="sm" onClick={onCollapse}>
              <ChevronsLeft />
            </IconButton>
          </Tooltip>
        )}
      </div>

      {/* Search */}
      <div className={cn("px-3 pb-2", collapsed && "px-2.5")}>
        {collapsed ? (
          <Tooltip content="Search all conversations (Ctrl K)" side="right">
            <button type="button" className="flex h-9 w-full items-center justify-center rounded-md border border-line bg-paper-raised text-ink-50 hover:bg-white hover:text-ink" aria-label="Search">
              <Search className="size-4" />
            </button>
          </Tooltip>
        ) : (
          <button
            type="button"
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
        <div className={cn("flex items-center justify-between pb-1 pt-2", collapsed ? "justify-center px-0" : "pl-2 pr-0.5")}>
          {!collapsed && <span className="label-mono">Projects</span>}
          <Tooltip content="New project" side="right">
            <IconButton label="New project" size="sm">
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
                    isActive ? "bg-white text-ink shadow-[0_1px_0_rgba(22,33,27,0.05)] ring-1 ring-line" : "text-ink-soft hover:bg-ink-6 hover:text-ink",
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <ClassChip value={p.classification} size="xs" labelled={false} />
                  <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{p.name}</span>
                  {!collapsed && <span className="font-mono text-2xs tabular text-ink-50">{counts[p.id] ?? 0}</span>}
                </NavLink>
              </Tooltip>
            );
          })}
          {active.length === 0 && !collapsed && <p className="px-2 py-3 text-xs text-ink-50">No projects yet. Create one to start a conversation.</p>}
        </nav>
      </div>

      {/* Secondary navigation */}
      <div className={cn("flex flex-col gap-0.5 border-t border-line-soft px-2 pt-2", collapsed && "items-center")}>
        <SideLink to="/models" icon={<Cpu />} label="Models" active={isModels} collapsed={collapsed} />
        <SideLink to="/settings" icon={<Settings2 />} label="Settings" active={isSettings} collapsed={collapsed} />
      </div>

      {/* Status strip */}
      <div className={cn("mt-2 border-t border-line-soft", collapsed ? "flex flex-col items-center gap-2 px-0 py-3" : "px-3 py-3")}>
        {collapsed ? (
          <>
            {[engine, writer].map((s) => (
              <Tooltip key={s.label} content={`${s.label}. ${s.detail}`} side="right">
                <span className="flex size-7 items-center justify-center rounded-md">
                  <StatusDot tone={s.tone} pulse={s.pulse} label={s.label} />
                </span>
              </Tooltip>
            ))}
            {onExpand && (
              <IconButton label="Expand sidebar" size="sm" onClick={onExpand}>
                <ChevronsRight />
              </IconButton>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <StatusRow status={engine} />
            <StatusRow status={writer} />
          </div>
        )}
      </div>
    </aside>
  );
}

function SideLink({ to, icon, label, active, collapsed }: { to: string; icon: React.ReactNode; label: string; active: boolean; collapsed: boolean }) {
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

function StatusRow({ status }: { status: StatusLine }) {
  return (
    <div className="flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left" role="status" aria-label={`${status.label}. ${status.detail}`}>
      <StatusDot tone={status.tone} pulse={status.pulse} className="mt-1.5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-ink">{status.label}</span>
        <span className="block truncate text-2xs leading-4 text-ink-50">{status.detail}</span>
      </span>
    </div>
  );
}
