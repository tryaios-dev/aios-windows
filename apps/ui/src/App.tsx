import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router'
import { useStore } from '@/lib/store'
import { WindowFrame } from '@/app/WindowFrame'
import { AppLayout } from '@/app/AppLayout'
import { ProjectLayout } from '@/app/ProjectLayout'
import { HomeView } from '@/features/home/HomeView'
import { ConversationsView } from '@/features/chat/ConversationsView'
import { ActivityView } from '@/features/activity/ActivityView'
import { ProjectSettingsView } from '@/features/projects/ProjectSettingsView'
import { SearchView } from '@/features/search/SearchView'
import { ModelsView } from '@/features/models/ModelsView'
import { KnowledgeView } from '@/features/knowledge/KnowledgeView'
import { SkillsView } from '@/features/skills/SkillsView'
import { ResourcesView } from '@/features/resources/ResourcesView'
import { SettingsView } from '@/features/settings/SettingsView'
import { SetupWizard } from '@/features/setup/SetupWizard'
import { RestoreScreen } from '@/features/setup/RestoreScreen'
import { CannotOpenScreen } from '@/features/setup/CannotOpenScreen'
import { GlobalDialogs } from '@/app/GlobalDialogs'
import { Toaster } from '@/app/Toaster'
import { SpikeScreen } from '@/features/spike' // SPIKE-D04

/** Old links to the per-project record keep working under its new name. */
function EvidenceRedirect() {
  const { projectId } = useParams()
  const { search } = useLocation()
  return <Navigate to={`/projects/${projectId}/activity${search}`} replace />
}

/**
 * Start-up gate. Setup comes first; if Windows no longer holds the keys the
 * app cannot open its data and says so instead of showing an empty shell.
 */
function StartGate({ children }: { children: React.ReactNode }) {
  const done = useStore((s) => s.ui.firstRunComplete)
  const keysMissing = useStore((s) => s.sim.keysMissing)
  if (!done) return <Navigate to="/setup" replace />
  if (keysMissing) return <CannotOpenScreen />
  return <>{children}</>
}

export default function App() {
  const navigate = useNavigate()

  // Toast actions and other non-React callers navigate through this event.
  useEffect(() => {
    const onNav = (e: Event) => {
      const href = (e as CustomEvent<string>).detail
      if (href) navigate(href)
    }
    window.addEventListener('aios:navigate', onNav)
    return () => window.removeEventListener('aios:navigate', onNav)
  }, [navigate])

  return (
    <>
      <WindowFrame>
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="/setup/restore" element={<RestoreScreen />} />
        <Route
          path="/"
          element={
            <StartGate>
              <AppLayout />
            </StartGate>
          }
        >
          <Route index element={<HomeView />} />
          <Route path="activity" element={<ActivityView />} />
          <Route path="projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<ConversationsView />} />
            <Route path="c/:conversationId" element={<ConversationsView />} />
            <Route path="activity" element={<ActivityView />} />
            <Route path="evidence" element={<EvidenceRedirect />} />
            <Route path="settings" element={<ProjectSettingsView />} />
          </Route>
          <Route path="search" element={<SearchView />} />
          <Route path="knowledge" element={<KnowledgeView />} />
          <Route path="models" element={<ModelsView />} />
          <Route path="skills" element={<SkillsView />} />
          <Route path="resources" element={<ResourcesView />} />
          <Route path="settings/:section?" element={<SettingsView />} />
          <Route path="spike" element={<SpikeScreen />} /> {/* SPIKE-D04: temporary */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </WindowFrame>
      <GlobalDialogs />
      <Toaster />
    </>
  )
}
