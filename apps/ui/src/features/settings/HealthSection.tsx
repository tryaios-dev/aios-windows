import { useEffect, useState } from "react";
import { api } from "@/bridge/api";
import { FileArchive } from "lucide-react";
import { useStore } from "@/bridge/sim/store";
import { useEngineStatus, useWriterStatus } from "@/components/app/useEngineStatus";
import type { DotTone } from "@/components/ui/chips";
import { Button } from "@/components/ui/button";
import { Ledger, PanelNote, PathValue, SettingGroup, SettingPanel, SettingRow } from "@/components/app/SettingRow";
import { ComponentRow } from "./shared";
import { platform } from "@/lib/platform";

const LOG_FOLDER = platform.folders.logs;

const BACKEND: Record<
  "ok" | "starting" | "down",
  { tone: DotTone; pulse?: boolean | undefined; status: string; detail: string }
> = {
  ok: {
    tone: "green",
    status: "Running",
    detail: "Local API on this device. Loopback only; it never listens on the network.",
  },
  starting: { tone: "brass", pulse: true, status: "Starting", detail: "Give it a few seconds." },
  down: {
    tone: "deny",
    status: "Not running",
    detail: "Restart AIOS. If it keeps happening, create a support bundle below.",
  },
};

/** Health: component state, evidence-pending count (F-05), logs and support bundle (L-03). */
export function HealthSection() {
  const health = useStore((s) => s.health);
  const companyFlag = useStore((s) => s.health.company.enabled);
  const logFolder = useStore((s) => s.liveInfo?.data_paths.logs) ?? LOG_FOLDER;
  const engine = useEngineStatus();
  const writer = useWriterStatus();
  const [bundling, setBundling] = useState(false);

  const backend = BACKEND[health.backend];
  const writerDown = health.writer === "unavailable";

  // Opening Health reads the components again, so the rows are current.
  useEffect(() => void api.system.refresh(), []);

  const createBundle = async () => {
    setBundling(true);
    // Zipping the log folder takes a moment; the toast reports where it went.
    const result = await api.system.supportBundle();
    setBundling(false);
    if (!result.ok) {
      if (!result.cancelled)
        useStore.getState().toast({ kind: "deny", title: "Support bundle not created", description: result.error });
      return;
    }
    useStore.getState().toast({
      kind: "info",
      title: `Support bundle saved to ${result.path}`,
      description: "It contains logs only, never databases. Send it only if you choose to.",
    });
  };

  return (
    <>
      <SettingGroup title="Components" description="What is running on this device right now.">
        <SettingPanel>
          <ul className="divide-y divide-line-soft">
            <ComponentRow
              tone={backend.tone}
              pulse={backend.pulse}
              name="Backend"
              status={backend.status}
              detail={backend.detail}
            />
            <ComponentRow
              tone={engine.tone}
              pulse={engine.pulse}
              name="Local engine"
              status={engine.label}
              detail={engine.detail}
            />
            <ComponentRow
              tone={writer.tone}
              name="Evidence writer"
              status={writerDown ? "Unavailable" : "Recording"}
              detail={writer.detail}
              figure={
                writerDown ? <span className="text-brass-text">{health.evidence_pending} pending</span> : undefined
              }
            >
              {writerDown && (
                <p className="mt-1.5 text-xs leading-4.5 text-ink-soft">
                  Events wait in the outbox and are appended exactly once when the writer is back. Chat keeps working;
                  each answer is marked pending until it is appended.
                </p>
              )}
            </ComponentRow>
            {companyFlag && (
              <ComponentRow
                tone={health.company.reachable ? "green" : "deny"}
                name="Company AI"
                status={health.company.reachable ? "Reachable" : "Not reachable"}
                detail={
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span>{health.company.model_name}</span>
                    <span className="font-mono tracking-[0.02em]">{health.company.base_url}</span>
                  </span>
                }
              />
            )}
          </ul>
        </SettingPanel>
      </SettingGroup>

      <SettingGroup
        title="Logs and support"
        description="Logs stay on this device. They record operations, errors and timings, never message content, prompts or keys. Kept for 14 days or 20 MB, whichever comes first."
      >
        <SettingPanel>
          <Ledger rows={[{ k: "Log folder", v: <PathValue value={logFolder} /> }]} />
          <SettingRow
            label="Support bundle"
            hint="A support bundle is a zip of the log folder and nothing more. Share it with pilot support only if you choose to."
            control={
              <Button leading={<FileArchive className="size-3.5" />} loading={bundling} onClick={createBundle}>
                {bundling ? "Creating" : "Create support bundle"}
              </Button>
            }
          />
          <PanelNote>Saved to Documents as a zip. Nothing is sent anywhere.</PanelNote>
        </SettingPanel>
      </SettingGroup>
    </>
  );
}
