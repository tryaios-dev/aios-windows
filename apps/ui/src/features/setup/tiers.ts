import type { ModelTier } from "@/lib/types";

/** Default catalogue entry per tier (local model catalogue v3, 2026-11: Small → MiniCPM5 2B,
 * Medium → Ornith 1.5 9B; MVP 4.1 named Qwen3 4B / 8B). */
export const TIER_ENTRY: Record<ModelTier, string> = {
  small: "minicpm5-2b-q4_k_m-openbmb-gguf",
  medium: "ornith-1.5-9b-q4_k_m-ornith-gguf",
};

export const TIER_LABEL: Record<ModelTier, string> = { small: "Small", medium: "Medium" };

export const TIER_EXPECTATION: Record<ModelTier, string> = {
  small: "Usable; roughly 5 to 15 words per second on a modern CPU",
  medium: "Good quality; fast on a GPU",
};
