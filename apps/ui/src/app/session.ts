import { create } from "zustand";
import type { Project } from "@/lib/types";
import type { FirstRunResult } from "@/features/setup";
import { useWorkspaceStore } from "@/features/workspace";

/** The project every installation starts with (MVP 4.1): Restricted by default. */
export const DEFAULT_PROJECT: Project = { id: "my-workspace", name: "My workspace", classification: "restricted", archived: false };

interface SessionState {
  firstRunComplete: boolean;
  completeFirstRun: (result: FirstRunResult) => void;
}

/**
 * App-level session: whether first run is done. The app owns this so the
 * setup and workspace features never import each other.
 * Held in memory for now; the backend becomes the source of truth once
 * first-run status is on the bridge.
 */
export const useSession = create<SessionState>()((set) => ({
  firstRunComplete: false,
  completeFirstRun: ({ installedModel }) => {
    useWorkspaceStore.getState().seed({ project: DEFAULT_PROJECT, installedModel });
    set({ firstRunComplete: true });
  },
}));
