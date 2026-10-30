import type * as React from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { Cpu, FileSignature, Settings2, SlidersHorizontal } from "lucide-react";
import { RestoreScreen, SetupWizard } from "@/features/setup";
import { ComingSoon, ConversationsView, ProjectLayout, WorkspaceHome, WorkspaceLayout } from "@/features/workspace";
import { DEFAULT_PROJECT, useSession } from "./session";

/** Sends everything except /setup to the wizard until first run is complete. */
function RequireFirstRun({ children }: { children: React.ReactNode }) {
  const done = useSession((s) => s.firstRunComplete);
  const location = useLocation();
  if (!done && !location.pathname.startsWith("/setup")) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

function SetupRoute() {
  const navigate = useNavigate();
  const completeFirstRun = useSession((s) => s.completeFirstRun);
  return (
    <SetupWizard
      defaultProject={DEFAULT_PROJECT}
      onComplete={(result) => {
        completeFirstRun(result);
        navigate("/", { replace: true });
      }}
      onRestore={() => navigate("/setup/restore")}
    />
  );
}

function RestoreRoute() {
  const navigate = useNavigate();
  return <RestoreScreen onBack={() => navigate("/setup")} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupRoute />} />
      <Route path="/setup/restore" element={<RestoreRoute />} />
      <Route
        path="/"
        element={
          <RequireFirstRun>
            <WorkspaceLayout />
          </RequireFirstRun>
        }
      >
        <Route index element={<WorkspaceHome />} />
        <Route path="projects/:projectId" element={<ProjectLayout />}>
          <Route index element={<ConversationsView />} />
          <Route path="evidence" element={<ComingSoon icon={<FileSignature />} title="Evidence" description="The evidence log for this project is not built yet." />} />
          <Route path="settings" element={<ComingSoon icon={<SlidersHorizontal />} title="Project settings" description="Project settings are not built yet." />} />
        </Route>
        <Route path="models" element={<ComingSoon icon={<Cpu />} title="Models" description="The model manager is not built yet." />} />
        <Route path="settings/*" element={<ComingSoon icon={<Settings2 />} title="Settings" description="Settings are not built yet." />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
