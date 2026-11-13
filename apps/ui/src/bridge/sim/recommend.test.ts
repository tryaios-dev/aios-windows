import { describe, expect, it } from "vitest";
import type { Hardware } from "@/lib/types";
import { DEFAULT_HARDWARE, recommendFor } from "./catalogue";

/** Same rule as the backend (services/backend/aios_backend/apps/models/hardware.py). */
function machine(ram_gb: number, vram_gb: number | null, free_disk_gb = 500, driver_ok = true): Hardware {
  const { gpu: _gpu, ...rest } = DEFAULT_HARDWARE;
  const base: Hardware = { ...rest, ram_gb, free_disk_gb };
  return vram_gb === null ? base : { ...base, gpu: { name: "GPU", vram_gb, driver_ok } };
}

describe("ac-02 one model suggested per catalogue v3 Windows profile", () => {
  it.each([
    [8, null, "minicpm5-2b-q4_k_m-openbmb-gguf"],
    [16, null, "minicpm5-2b-q4_k_m-openbmb-gguf"],
    [16, 1, "minicpm5-2b-q4_k_m-openbmb-gguf"], // integrated graphics
    [16, 8, "ornith-1.5-9b-q4_k_m-ornith-gguf"],
    // The large picks need a passed review first (MVP 9.6): until then Ornith is suggested.
    [32, 8, "ornith-1.5-9b-q4_k_m-ornith-gguf"],
    [64, 24, "ornith-1.5-9b-q4_k_m-ornith-gguf"],
  ])("%i GB RAM, %s GB GPU -> %s", (ram, vram, expected) => {
    expect(recommendFor(machine(ram, vram))?.entry_id).toBe(expected);
  });

  it("suggests nothing below the minimum", () => {
    expect(recommendFor(machine(4, null))).toBeNull();
    expect(recommendFor(machine(16, null, 9))).toBeNull();
  });

  it("treats a GPU without a driver as no GPU", () => {
    expect(recommendFor(machine(16, 8, 500, false))?.entry_id).toBe("minicpm5-2b-q4_k_m-openbmb-gguf");
  });
});
