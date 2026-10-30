import { create } from "zustand";
import type { EngineBuild } from "@/lib/types";
import { SAMPLE_HARDWARE, WORKING_SPACE_BYTES, catalogueEntry } from "./catalogue";
import type { Benchmark, DownloadState, Hardware, ModelSource } from "./types";

/**
 * First-run state for the wizard.
 *
 * Everything here is SIMULATED so the screens can be built and reviewed before
 * the backend exposes setup on the bridge. Each action is the seam to replace
 * with a `window.aios` call (through src/bridge): hardware probe, model
 * download and import (I-03, I-04), recovery key issue (E-03), and the engine
 * benchmark. The recovery key in particular must come from the backend; the
 * renderer must never generate or keep it in the real build.
 */

interface SetupState {
  hardware: Hardware;
  engineBuild: EngineBuild;
  downloads: Record<string, DownloadState>;
  installed: Record<string, ModelSource>;
  recoveryKey: string | null;
  benchmark: Benchmark | null;

  startDownload: (entryId: string) => void;
  pauseDownload: (entryId: string) => void;
  resumeDownload: (entryId: string) => void;
  importOffline: (entryId: string) => void;
  issueRecoveryKey: () => void;
  runBenchmark: () => Promise<void>;
  reset: () => void;
}

const TICK_MS = 250;
const MIRROR_SPEED_BPS = 520_000_000;
const VERIFY_MS = 1_800;

const downloadTimers: Record<string, ReturnType<typeof setInterval>> = {};
const verifyTimers: Record<string, ReturnType<typeof setTimeout>> = {};

const initial = () => ({
  hardware: SAMPLE_HARDWARE,
  engineBuild: (SAMPLE_HARDWARE.gpu ? "vulkan" : "cpu") as EngineBuild,
  downloads: {},
  installed: {},
  recoveryKey: null,
  benchmark: null,
});

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 8 groups of 4 characters from an unambiguous alphabet. Placeholder for the backend-issued key. */
function placeholderRecoveryKey(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
  return chars.match(/.{4}/g)!.join("-");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const useSetupStore = create<SetupState>()((set, get) => {
  const patchDownload = (entryId: string, patch: Partial<DownloadState>) =>
    set((s) => {
      const current = s.downloads[entryId];
      return current ? { downloads: { ...s.downloads, [entryId]: { ...current, ...patch } } } : s;
    });

  const finishInstall = (entryId: string, source: ModelSource) =>
    set((s) => {
      const downloads = { ...s.downloads };
      delete downloads[entryId];
      return { downloads, installed: { ...s.installed, [entryId]: source } };
    });

  const runDownload = (entryId: string) => {
    clearInterval(downloadTimers[entryId]);
    downloadTimers[entryId] = setInterval(() => {
      const d = get().downloads[entryId];
      if (!d || d.status !== "downloading") {
        clearInterval(downloadTimers[entryId]);
        return;
      }
      const speed = MIRROR_SPEED_BPS * (0.82 + Math.random() * 0.36);
      const received = Math.min(d.total_bytes, d.received_bytes + speed * (TICK_MS / 1000));
      if (received >= d.total_bytes) {
        clearInterval(downloadTimers[entryId]);
        patchDownload(entryId, { status: "verifying", received_bytes: d.total_bytes, speed_bps: 0 });
        verifyTimers[entryId] = setTimeout(() => finishInstall(entryId, "mirror"), VERIFY_MS);
        return;
      }
      patchDownload(entryId, { received_bytes: received, speed_bps: speed });
    }, TICK_MS);
  };

  return {
    ...initial(),

    startDownload: (entryId) => {
      const entry = catalogueEntry(entryId);
      const s = get();
      if (!entry || s.downloads[entryId]?.status === "downloading") return;
      if (s.hardware.free_disk_gb * 1024 ** 3 < entry.size_bytes + WORKING_SPACE_BYTES) return;
      set({
        downloads: {
          ...s.downloads,
          [entryId]: { entry_id: entryId, status: "downloading", received_bytes: s.downloads[entryId]?.received_bytes ?? 0, total_bytes: entry.size_bytes, speed_bps: 0 },
        },
      });
      runDownload(entryId);
    },

    pauseDownload: (entryId) => {
      clearInterval(downloadTimers[entryId]);
      patchDownload(entryId, { status: "paused", speed_bps: 0 });
    },

    resumeDownload: (entryId) => {
      patchDownload(entryId, { status: "downloading" });
      runDownload(entryId);
    },

    importOffline: (entryId) => {
      const entry = catalogueEntry(entryId);
      if (!entry) return;
      set((s) => ({
        downloads: { ...s.downloads, [entryId]: { entry_id: entryId, status: "verifying", received_bytes: entry.size_bytes, total_bytes: entry.size_bytes, speed_bps: 0 } },
      }));
      verifyTimers[entryId] = setTimeout(() => finishInstall(entryId, "offline"), VERIFY_MS + 400);
    },

    issueRecoveryKey: () => {
      if (get().recoveryKey) return;
      set({ recoveryKey: placeholderRecoveryKey() });
    },

    runBenchmark: async () => {
      await sleep(2_600);
      const cpu = get().engineBuild === "cpu";
      set({
        benchmark: {
          engine: get().engineBuild,
          tokens_per_second: cpu ? 9.2 + Math.random() : 36 + Math.random() * 5,
          time_to_first_token_ms: cpu ? 3_900 + Math.round(Math.random() * 600) : 380 + Math.round(Math.random() * 90),
        },
      });
    },

    reset: () => {
      for (const t of Object.values(downloadTimers)) clearInterval(t);
      for (const t of Object.values(verifyTimers)) clearTimeout(t);
      set(initial());
    },
  };
});
