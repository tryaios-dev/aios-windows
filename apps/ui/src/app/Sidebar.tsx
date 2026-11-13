import { useMemo, useState } from 'react'
import { NavLink, useLocation, useNavigate, useParams } from 'react-router'
import { Archive, ChevronDown, ChevronsLeft, ChevronsRight, FolderPlus, Plus, Search } from 'lucide-react'
import { ART } from '@/assets/icons'
import { cn } from '@/lib/cn'
import { useStore } from '@/lib/store'
import { useExtras } from '@/lib/extras'
import { backupStatus, KEYS } from '@/lib/words'
import { Wordmark } from '@/components/ui/brand'
import { IconButton } from '@/components/ui/button'
import { ClassChip } from '@/components/ui/chips'
import { Kbd } from '@/components/ui/layout'
import { Tooltip } from '@/components/ui/overlays'
import { useEngineStatus } from './useEngineStatus'
import { CreateProjectDialog } from '@/features/projects/ProjectDialogs'

export type SidebarMode = 'full' | 'rail' | 'sheet'

/** The catalogue entry that is a newer version of an installed model (src/data/catalogue.ts). */
const NEWER_MODEL_ID = 'qwen3-5-8b-q4km'

/**
 * Primary navigation: the six things AIOS is, then projects, then Settings.
 * Readiness and backup status are shown in Settings and on Home, not here.
 *
 * Each line wears the colour icon its page wears, so the menu and the pages
 * read as one set. Icons rest slightly muted and come to full colour on the
 * line you are on or pointing at. The current line is a white card with a
 * green marker; nothing in a row changes width between states.
 */
export function Sidebar({ mode = 'full', onCollapse, onExpand }: { mode?: SidebarMode; onCollapse?: () => void; onExpand?: () => void }) {
  const collapsed = mode === 'rail'
  const setCommandOpen = useStore((s) => s.setCommandOpen)
  const projects = useStore((s) => s.projects)
  const conversations = useStore((s) => s.conversations)
  const settings = useStore((s) => s.settings)
  const writerPaused = useStore((s) => s.health.writer === 'unavailable')
  const { projectId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const active = useMemo(() => projects.filter((p) => !p.archived), [projects])
  const archived = useMemo(() => projects.filter((p) => p.archived), [projects])
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of conversations) if (!c.archived) m[c.project_id] = (m[c.project_id] ?? 0) + 1
    return m
  }, [conversations])

  // "New" beside AI models: green, with a soft pulse three times, from the moment a newer model is listed until the page is opened; quiet after that until it is installed.
  const newModelOut = useStore((s) => s.sim.newModelOut)
  const newerInstalled = useStore((s) => s.installedModels.some((m) => m.id === NEWER_MODEL_ID))
  const modelsSeen = useExtras((s) => s.modelsSeen)
  const newModel = newModelOut && !newerInstalled
  const newModelUnseen = newModel && !modelsSeen

  const engine = useEngineStatus()
  const backup = backupStatus(settings)
  const settingsNote = settings.update_available ? 'An update is ready' : backup.tone !== 'ok' ? backup.label : engine.tone === 'deny' ? engine.label : null
  const path = location.pathname

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col transition-[width] duration-(--duration-panel) ease-(--ease-out)',
        // A warm paper column with a faint green light from the top-left corner, where the logo sits.
        mode === 'sheet' ? 'w-full bg-white' : 'border-r border-line bg-[radial-gradient(130%_42%_at_0%_0%,rgba(30,95,70,0.075),transparent_70%),linear-gradient(180deg,#f3f1ea_0%,#ebe9e1_100%)] shadow-[inset_-1px_0_0_rgba(255,255,255,0.6)]',
        collapsed ? 'w-16' : mode === 'sheet' ? '' : 'w-64',
      )}
      aria-label="Navigation"
    >
      {/* Brand */}
      <div className={cn('flex h-14 items-center', collapsed ? 'justify-center px-0' : 'justify-between pl-4 pr-2')}>
        <button className="flex items-center rounded-md" onClick={() => navigate('/')} aria-label="Go to Home">
          <Wordmark height={collapsed ? 11 : 16} />
        </button>
        {!collapsed && onCollapse && (
          <Tooltip content={<span>Collapse <Kbd className="ml-1 border-white/20 bg-white/10 text-paper">{KEYS.sidebar}</Kbd></span>}>
            <IconButton label="Collapse sidebar" size="sm" onClick={onCollapse}>
              <ChevronsLeft />
            </IconButton>
          </Tooltip>
        )}
      </div>

      {/* Search */}
      <div className={cn('px-3 pb-3', collapsed && 'px-3')}>
        {collapsed ? (
          <Tooltip content={`Search (${KEYS.search})`} side="right">
            <button onClick={() => setCommandOpen(true)} className="flex size-10 items-center justify-center rounded-lg border border-line bg-white/70 text-ink-50 shadow-[0_1px_2px_rgba(22,33,27,0.05)] transition-colors duration-(--duration-micro) hover:border-line-strong hover:bg-white hover:text-ink" aria-label="Search">
              <Search className="size-4" />
            </button>
          </Tooltip>
        ) : (
          <button
            onClick={() => setCommandOpen(true)}
            className="group/search flex h-10 w-full items-center gap-2.5 rounded-lg border border-line bg-white/70 pl-3 pr-2 text-left text-sm text-ink-50 shadow-[0_1px_2px_rgba(22,33,27,0.05)] transition-[background-color,border-color,color,box-shadow] duration-(--duration-micro) ease-(--ease-out) hover:border-line-strong hover:bg-white hover:text-ink hover:shadow-[0_2px_6px_rgba(22,33,27,0.07)]"
          >
            <Search className="size-4 transition-colors duration-(--duration-micro) group-hover/search:text-green" />
            <span className="flex-1">Search</span>
            <Kbd>{KEYS.search}</Kbd>
          </button>
        )}
      </div>

      {/*
        The top of the menu is where eyes start, so it carries the whole of AIOS in
        the order a person meets it: what I did, what my AI knows, the AI itself,
        and the two ways to make it more capable. One click each.
      */}
      <nav className={cn('flex flex-col gap-0.5 px-3', collapsed && 'items-center')} aria-label="Main">
        <SideLink to="/" icon={ART.home} label="Home" active={path === '/'} collapsed={collapsed} />
        <SideLink to="/activity" icon={ART.activity} label="Activity" active={path === '/activity'} collapsed={collapsed} dot={writerPaused} dotLabel="Recording is paused" />
        <SideLink to="/knowledge" icon={ART.knowledge} label="My secure knowledge" active={path.startsWith('/knowledge')} collapsed={collapsed} />
        <SideLink to="/models" icon={ART.model} label="AI models" active={path.startsWith('/models')} collapsed={collapsed} tag={newModel ? { label: 'New', fresh: newModelUnseen, title: newModelUnseen ? 'A newer AI model is out' : 'A newer AI model is available' } : undefined} />
        <SideLink to="/skills" icon={ART.skills} label="Add skills to my AI" active={path.startsWith('/skills')} collapsed={collapsed} />
        <SideLink to="/resources" icon={ART.resources} label="Add resources to my AI" active={path.startsWith('/resources')} collapsed={collapsed} />
      </nav>

      {/* Projects */}
      <div aria-hidden className="mx-3 mt-3 h-px shrink-0 bg-line" />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        <div className={cn('flex items-center justify-between pb-1.5 pt-3', collapsed ? 'justify-center px-0' : 'pl-2 pr-0.5')}>
          {!collapsed && (
            <span className="flex items-center gap-2">
              <span className="label-mono">Projects</span>
              {active.length > 0 && <span className="font-mono text-2xs tabular text-ink-50">{active.length}</span>}
            </span>
          )}
          <Tooltip content="New project" side="right">
            <IconButton label="New project" size="sm" onClick={() => setCreateOpen(true)}>
              <FolderPlus />
            </IconButton>
          </Tooltip>
        </div>
        <nav className="flex flex-col gap-0.5" aria-label="Projects">
          {active.map((p) => {
            const isActive = p.id === projectId
            return (
              <Tooltip key={p.id} content={collapsed ? p.name : undefined} side="right">
                <NavLink
                  to={`/projects/${p.id}`}
                  title={collapsed ? undefined : p.name}
                  className={cn(
                    ROW,
                    collapsed ? 'size-10 justify-center' : 'h-9 w-full px-2',
                    isActive ? ROW_ON : ROW_OFF,
                  )}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center">
                    <ClassChip value={p.classification} size="xs" labelled={false} />
                  </span>
                  <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{p.name}</span>
                  {!collapsed && <Count on={isActive}>{counts[p.id] ?? 0}</Count>}
                </NavLink>
              </Tooltip>
            )
          })}
          {active.length === 0 && !collapsed && <p className="px-2 py-3 text-xs leading-4.5 text-ink-50">No projects yet. A project keeps related conversations together.</p>}
          {!collapsed && (
            <button type="button" onClick={() => setCreateOpen(true)} className={cn(ROW, 'group h-9 w-full px-2 text-left text-ink-50 hover:bg-white/60 hover:text-ink')}>
              <span className="flex size-6 shrink-0 items-center justify-center">
                <span className="flex size-[18px] items-center justify-center rounded-sm border border-dashed border-line-strong transition-colors duration-(--duration-micro) group-hover:border-green group-hover:text-green">
                  <Plus className="size-3" strokeWidth={2.25} aria-hidden />
                </span>
              </span>
              New project
            </button>
          )}
        </nav>

        {archived.length > 0 && (
          <div className="mt-3">
            {collapsed ? (
              <Tooltip content={`${archived.length} archived`} side="right">
                <button onClick={() => { onExpand?.(); setShowArchived(true) }} className="flex size-10 items-center justify-center rounded-lg text-ink-50 transition-colors duration-(--duration-micro) hover:bg-white/60 hover:text-ink" aria-label="Archived projects">
                  <Archive className="size-4" />
                </button>
              </Tooltip>
            ) : (
              <>
                <button onClick={() => setShowArchived((v) => !v)} className="flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-left text-xs text-ink-50 transition-colors duration-(--duration-micro) hover:bg-white/60 hover:text-ink" aria-expanded={showArchived}>
                  <ChevronDown className={cn('size-3.5 transition-transform duration-(--duration-micro)', !showArchived && '-rotate-90')} />
                  <span className="label-mono">Archived</span>
                  <span className="ml-auto font-mono text-2xs text-ink-50">{archived.length}</span>
                </button>
                {showArchived && (
                  <nav className="mt-0.5 flex flex-col gap-0.5" aria-label="Archived projects">
                    {archived.map((p) => (
                      <NavLink key={p.id} to={`/projects/${p.id}`} className={({ isActive }) => cn(ROW, 'h-9 px-2', isActive ? ROW_ON : 'text-ink-50 hover:bg-white/60 hover:text-ink')}>
                        <span className="flex size-6 shrink-0 items-center justify-center">
                          <ClassChip value={p.classification} size="xs" labelled={false} className="opacity-60" />
                        </span>
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

      {/* Settings */}
      <div aria-hidden className="mx-3 h-px shrink-0 bg-line" />
      <div className={cn('flex flex-col gap-0.5 px-3 pt-2', collapsed && 'items-center')}>
        <SideLink to="/settings" icon={ART.settings} label="Settings" active={path.startsWith('/settings')} collapsed={collapsed} dot={settingsNote !== null} dotLabel={settingsNote ?? undefined} />
      </div>

      {/* Readiness and backup status live in Settings and on Home. Here Settings carries a dot when either needs you. */}
      {collapsed && onExpand ? (
        <div className="flex flex-col items-center py-2">
          <IconButton label="Expand sidebar" size="sm" onClick={onExpand}>
            <ChevronsRight />
          </IconButton>
        </div>
      ) : (
        <div className="h-3" />
      )}

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </aside>
  )
}

interface SideTag {
  label: string
  /** Not yet seen: solid green with a soft pulse. Seen: a quiet outline. */
  fresh: boolean
  title: string
}

/** One row of the menu, shared by the main lines and the projects so they line up and behave alike. */
const ROW = 'relative flex items-center gap-2.5 rounded-lg text-sm font-medium transition-[background-color,color,box-shadow] duration-(--duration-micro) ease-(--ease-out)'
const ROW_ON = 'bg-white text-ink shadow-[0_1px_2px_rgba(22,33,27,0.07),0_0_0_1px_var(--color-line)]'
const ROW_OFF = 'text-ink-soft hover:bg-white/60 hover:text-ink'

/** How many conversations a project holds. */
function Count({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <span className={cn('flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 font-mono text-2xs tabular transition-colors duration-(--duration-micro)', on ? 'bg-green-wash text-green-dark' : 'bg-ink-6 text-ink-50')}>{children}</span>
}

function SideLink({ to, icon, label, active, collapsed, dot, dotLabel, tag }: { to: string; /** A colour icon from `ART`. */ icon: string; label: string; active: boolean; collapsed: boolean; dot?: boolean; dotLabel?: string; tag?: SideTag }) {
  const inner = (
    <NavLink
      to={to}
      end
      className={cn(
        ROW,
        'group',
        collapsed ? 'size-10 justify-center' : 'h-9 w-full px-2',
        active ? ROW_ON : ROW_OFF,
        // A green marker on the current destination, the same one Settings uses for its sections.
        !collapsed && 'before:absolute before:top-2.5 before:bottom-2.5 before:-left-px before:w-0.5 before:rounded-full before:bg-green before:opacity-0 before:transition-opacity before:duration-(--duration-micro)',
        active && 'before:opacity-100',
      )}
      aria-current={active ? 'page' : undefined}
    >
      <span className="flex size-6 shrink-0 items-center justify-center">
        <img
          src={icon}
          alt=""
          aria-hidden
          draggable={false}
          className={cn('size-5 transition-[filter,opacity,transform] duration-(--duration-panel) ease-(--ease-out) group-hover:scale-110', active ? '' : 'opacity-85 saturate-[0.7] group-hover:opacity-100 group-hover:saturate-100')}
        />
      </span>
      <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{label}</span>
      {tag &&
        (collapsed ? (
          <span className={cn('absolute right-1 top-1 size-2 rounded-full', tag.fresh ? 'bg-green' : 'bg-ink-30')} role="img" aria-label={tag.title} />
        ) : (
          <span
            title={tag.title}
            className={cn(
              'relative inline-flex h-[18px] shrink-0 items-center rounded-full px-1.5 text-2xs font-semibold leading-none tracking-wide transition-colors duration-(--duration-panel)',
              tag.fresh ? 'bg-green text-white' : 'border border-green/40 text-green',
            )}
          >
            {tag.fresh && <span aria-hidden className="tag-pulse absolute inset-0 rounded-full bg-green" />}
            <span className="relative">{tag.label}</span>
            <span className="sr-only">. {tag.title}</span>
          </span>
        ))}
      {dot && <span className={cn('size-1.5 rounded-full bg-brass', collapsed && 'absolute right-1.5 top-1.5')} aria-label={dotLabel} role="img" />}
    </NavLink>
  )
  return collapsed ? <Tooltip content={tag ? `${label} · ${tag.title}` : label} side="right">{inner}</Tooltip> : inner
}
