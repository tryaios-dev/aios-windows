import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { Menu as MenuIcon, Search } from 'lucide-react'
import { useStore } from '@/lib/store'
import { BP, useMediaQuery } from '@/lib/useMediaQuery'
import { Wordmark } from '@/components/ui/brand'
import { IconButton } from '@/components/ui/button'
import { Sheet } from '@/components/ui/overlays'
import { Sidebar } from './Sidebar'
import { CommandPalette } from '@/features/search/CommandPalette'

/** The application frame: sidebar on the left, the active view on the right. */
export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const setCommandOpen = useStore((s) => s.setCommandOpen)
  const collapsed = useStore((s) => s.ui.sidebarCollapsed)
  const setCollapsed = useStore((s) => s.setSidebarCollapsed)
  const rail = useMediaQuery(BP.rail)
  const compact = useMediaQuery(BP.compact)
  const [menuOpen, setMenuOpen] = useState(false)

  // Close the sheet sidebar after navigating on small screens.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  // Global shortcuts: ⌘K search, ⌘, settings, ⌘\ toggle sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen(true)
      } else if (e.key === ',') {
        e.preventDefault()
        navigate('/settings')
      } else if (e.key === '\\') {
        e.preventDefault()
        setCollapsed(!collapsed)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, setCommandOpen, collapsed, setCollapsed])

  return (
    <div className="flex h-full w-full flex-col bg-paper text-ink">
      {compact && (
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-paper-deep/70 px-2">
          <div className="flex items-center gap-1">
            <IconButton label="Open navigation" onClick={() => setMenuOpen(true)}>
              <MenuIcon />
            </IconButton>
            <button className="flex items-center rounded-md px-1" onClick={() => navigate('/')} aria-label="Go to Home">
              <Wordmark height={14} />
            </button>
          </div>
          <IconButton label="Search" onClick={() => setCommandOpen(true)}>
            <Search />
          </IconButton>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
      {compact ? (
        <Sheet open={menuOpen} onOpenChange={setMenuOpen} side="left" title="Navigation" width="w-[288px]" bare>
          <Sidebar mode="sheet" />
        </Sheet>
      ) : (
        <Sidebar mode={rail ? 'rail' : collapsed ? 'rail' : 'full'} onExpand={rail ? undefined : () => setCollapsed(false)} onCollapse={rail ? undefined : () => setCollapsed(true)} />
      )}
      {/*
        The frame never animates. Each page mounts in place: its header is
        there on the first frame and its body fades in without moving
        (see PageBody). An earlier version faded and slid the whole view on
        every navigation, which read as a flicker and a jump.
      */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
      </div>
      <CommandPalette />
    </div>
  )
}
