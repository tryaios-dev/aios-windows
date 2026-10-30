import { Navigate } from "react-router";
import { useWorkspaceStore } from "./store";

/** "/" inside the shell: open the last project, else the first active one, else Models. */
export function WorkspaceHome() {
  const lastProjectId = useWorkspaceStore((s) => s.lastProjectId);
  const projects = useWorkspaceStore((s) => s.projects);
  const target = projects.find((p) => p.id === lastProjectId && !p.archived) ?? projects.find((p) => !p.archived) ?? projects[0];
  return <Navigate to={target ? `/projects/${target.id}` : "/models"} replace />;
}
