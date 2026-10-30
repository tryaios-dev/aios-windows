import { create } from "zustand";
import type { EngineBuild, InstalledModelRef, Project } from "@/lib/types";

/**
 * Workspace state behind the shell: projects, counts and the status strip.
 *
 * SIMULATED until the backend exposes projects, conversations, evidence and
 * /health on the bridge. `seed` is called once by the app when first-run
 * completes; replace it with bridge queries (src/bridge) feature by feature.
 */

export type EngineState = "not_started" | "no_model" | "loading" | "ready" | "generating" | "idle_unloaded" | "failed";

export interface WorkspaceHealth {
  engine: EngineState;
  engineBuild: EngineBuild;
  model: InstalledModelRef | null;
  writer: "ok" | "unavailable";
  evidencePending: number;
}

interface WorkspaceState {
  projects: Project[];
  conversationCounts: Record<string, number>;
  /** Evidence events visible from a project: its own plus stream-wide ones. */
  evidenceCounts: Record<string, number>;
  health: WorkspaceHealth;
  sidebarCollapsed: boolean;
  lastProjectId: string | null;

  seed: (input: { project: Project; installedModel: InstalledModelRef | null }) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setLastProject: (id: string | null) => void;
}

/** Events first run appends (MVP 4.1): install, store, recovery package, recovery key, model, project. */
const firstRunEventCount = (withModel: boolean) => (withModel ? 6 : 5);

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  projects: [],
  conversationCounts: {},
  evidenceCounts: {},
  health: { engine: "no_model", engineBuild: "vulkan", model: null, writer: "ok", evidencePending: 0 },
  sidebarCollapsed: false,
  lastProjectId: null,

  seed: ({ project, installedModel }) =>
    set({
      projects: [project],
      conversationCounts: { [project.id]: 0 },
      evidenceCounts: { [project.id]: firstRunEventCount(!!installedModel) },
      health: { engine: installedModel ? "idle_unloaded" : "no_model", engineBuild: "vulkan", model: installedModel, writer: "ok", evidencePending: 0 },
      lastProjectId: project.id,
    }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setLastProject: (lastProjectId) => set({ lastProjectId }),
}));

export const selectProject = (id: string | undefined) => (s: WorkspaceState) => s.projects.find((p) => p.id === id);
