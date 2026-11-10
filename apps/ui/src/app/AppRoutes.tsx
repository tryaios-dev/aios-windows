import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { useStore } from "@/bridge/sim/store";
import { ConversationsView } from "@/features/chat";
import { EvidenceView } from "@/features/evidence";
import { ModelsView } from "@/features/models";
import { ProjectSettingsView } from "@/features/projects";
import { SearchView } from "@/features/search";
import { SettingsView } from "@/features/settings";
import { SpikeScreen } from "@/features/spike"; // SPIKE-D04
import { RestoreScreen, SetupWizard } from "@/features/setup";
import { AppLayout } from "./AppLayout";
import { GlobalDialogs } from "./GlobalDialogs";
import { ProjectLayout } from "./ProjectLayout";
import { Toaster } from "./Toaster";

/** "/" opens the last project, else the first active one, else Models. */
function HomeRedirect() {
  const lastProjectId = useStore((s) => s.ui.lastProjectId);
  const projects = useStore((s) => s.projects);
  const target =
    projects.find((p) => p.id === lastProjectId && !p.archived) ?? projects.find((p) => !p.archived) ?? projects[0];
  return <Navigate to={target ? `/projects/${target.id}` : "/models"} replace />;
}

/** Everything outside /setup waits until first run is complete. */
function RequireFirstRun({ children }: { children: React.ReactNode }) {
  const done = useStore((s) => s.ui.firstRunComplete);
  const location = useLocation();
  if (!done && !location.pathname.startsWith("/setup")) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

export function AppRoutes() {
  const navigate = useNavigate();

  // Toast actions and other non-React callers navigate through this event.
  useEffect(() => {
    const onNav = (e: Event) => {
      const href = (e as CustomEvent<string>).detail;
      if (href) navigate(href);
    };
    window.addEventListener("aios:navigate", onNav);
    return () => window.removeEventListener("aios:navigate", onNav);
  }, [navigate]);

  return (
    <>
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="/setup/restore" element={<RestoreScreen />} />
        <Route
          path="/"
          element={
            <RequireFirstRun>
              <AppLayout />
            </RequireFirstRun>
          }
        >
          <Route index element={<HomeRedirect />} />
          <Route path="projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<ConversationsView />} />
            <Route path="c/:conversationId" element={<ConversationsView />} />
            <Route path="evidence" element={<EvidenceView />} />
            <Route path="settings" element={<ProjectSettingsView />} />
          </Route>
          <Route path="search" element={<SearchView />} />
          <Route path="models" element={<ModelsView />} />
          <Route path="spike" element={<SpikeScreen />} /> {/* SPIKE-D04: temporary */}
          <Route path="settings/:section?" element={<SettingsView />} />
          <Route path="*" element={<HomeRedirect />} />
        </Route>
      </Routes>
      <GlobalDialogs />
      <Toaster />
    </>
  );
}
