import { useNavigate } from "react-router";
import { KeyRound, Lock, RotateCcw } from "lucide-react";
import { useStore } from "@/bridge/sim/store";
import { Button } from "@/components/ui/button";
import { Hash } from "@/components/ui/layout";
import {
  Ledger,
  NumberedList,
  PanelNote,
  PathValue,
  SettingGroup,
  SettingPanel,
  SettingRow,
} from "@/components/app/SettingRow";
import { platform } from "@/lib/platform";

const DATA_ROOT = platform.folders.root;
const DATA_FOLDER = platform.folders.data;

const PATHS: Array<{ path: string; purpose: string }> = [
  { path: "data\\chats.db", purpose: "Projects, conversations, messages and summaries. Encrypted with SQLCipher." },
  { path: "data\\evidence.db", purpose: "The append-only evidence log. Commitments and hashes, never content." },
  {
    path: "data\\recovery.pkg",
    purpose: "Recovery Package v1. With your recovery key, what a clean machine needs to restore.",
  },
  { path: "models\\", purpose: "Downloaded and imported model files. They hold no data of yours." },
  { path: "backups\\", purpose: "A copy of the database taken before every migration." },
  { path: "logs\\", purpose: "Operational logs. Kept for 14 days or 20 MB." },
];

/** Data and recovery: where data lives, backing up, the recovery key and restore (M-15, M-16, E-04). */
export function DataSection() {
  const stream = useStore((s) => s.stream);
  const navigate = useNavigate();

  return (
    <>
      <SettingGroup
        title="Where your data lives"
        description={
          <>
            Everything is under <PathValue value={DATA_ROOT} /> on this device.
          </>
        }
      >
        <SettingPanel>
          <Ledger
            cols="grid-cols-[minmax(160px,34%)_1fr]"
            rows={PATHS.map((p) => ({
              rawKey: true,
              k: <PathValue value={p.path} copyValue={DATA_ROOT + p.path} />,
              v: <span className="text-ink-soft">{p.purpose}</span>,
            }))}
          />
          <PanelNote tone="green" icon={<Lock />}>
            Conversations are encrypted at rest with SQLCipher. The key lives in {platform.keyStore} and never in a
            file.
          </PanelNote>
        </SettingPanel>
      </SettingGroup>

      <SettingGroup
        title="Back up"
        description="Three steps. A backup is only useful together with the recovery key that was shown during setup."
      >
        <SettingPanel>
          <NumberedList
            items={[
              { title: "Quit AIOS", text: "Both databases are then closed and consistent." },
              {
                title: "Copy the data folder",
                text: (
                  <>
                    Copy <PathValue value={DATA_FOLDER} /> to your backup location. Model files can be left out; they
                    hold no data of yours.
                  </>
                ),
              },
              {
                title: "Keep your recovery key with it",
                text: "Stored separately from this device, where you will find it when the device is gone.",
              },
            ]}
          />
          <PanelNote>A backup is also taken before every migration and kept in backups\.</PanelNote>
        </SettingPanel>
      </SettingGroup>

      <SettingGroup title="Recovery key">
        <SettingPanel>
          <PanelNote icon={<KeyRound />} className="bg-white py-3 text-sm leading-5">
            Shown once during setup. AIOS does not store it and cannot show it again. If you have lost it, a backup of
            this installation cannot be reopened on another machine. Ask pilot support before relying on a backup.
          </PanelNote>
        </SettingPanel>
      </SettingGroup>

      <SettingGroup title="Restore">
        <SettingPanel>
          <SettingRow
            label="Restore from a backup"
            hint="Bring a backup from this or another machine into this installation."
            control={
              <Button leading={<RotateCcw className="size-3.5" />} onClick={() => navigate("/setup/restore")}>
                Restore from a backup
              </Button>
            }
          />
          <PanelNote tone="caution">
            Restoring replaces this installation's store and starts a new evidence epoch.
          </PanelNote>
          <Ledger
            dense
            rows={[
              { k: "Current epoch", v: stream.epoch, mono: true },
              { k: "Evidence stream", v: <Hash value={stream.stream_id} /> },
            ]}
          />
        </SettingPanel>
      </SettingGroup>
    </>
  );
}
