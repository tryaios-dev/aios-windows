/** Domain types shared by more than one feature. Field names follow MVP 9.1. */

export type Classification = "restricted" | "internal" | "public";
export type ProviderType = "local" | "company";
export type ModelTier = "small" | "medium";
export type EngineBuild = "cpu" | "vulkan";

export interface Project {
  id: string;
  name: string;
  classification: Classification;
  archived: boolean;
}

/** The model the first-run wizard installed, if any. */
export interface InstalledModelRef {
  id: string;
  name: string;
}
