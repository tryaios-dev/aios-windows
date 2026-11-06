import type { ModelTier } from "@/lib/types";

/** Default catalogue entry per tier (MVP 4.1: Medium → Qwen3 8B, Small → Qwen3 4B). */
export const TIER_ENTRY: Record<ModelTier, string> = { small: "qwen3-4b-q4km", medium: "qwen3-8b-q4km" };

export const TIER_LABEL: Record<ModelTier, string> = { small: "Small", medium: "Medium" };

export const TIER_EXPECTATION: Record<ModelTier, string> = {
  small: "Usable; roughly 5 to 15 words per second on a modern CPU",
  medium: "Good quality; fast on a GPU",
};
