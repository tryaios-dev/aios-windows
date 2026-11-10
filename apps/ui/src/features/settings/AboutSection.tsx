import { useNavigate } from "react-router";
import { ArrowRight } from "lucide-react";
import { useStore } from "@/bridge/sim/store";
import { Wordmark } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/chips";
import { Ledger, NumberedList, SettingGroup, SettingPanel, SettingRow } from "@/components/app/SettingRow";
import { platform } from "@/lib/platform";

const LIMITS: Array<{ title: string; text: string }> = [
  {
    title: `Malware running as your ${platform.os} user`,
    text: `Anything that runs as you can read what you can read, including open conversations and the keys ${platform.os} holds for you.`,
  },
  {
    title: "A lost device without full-disk encryption",
    text: `The conversation database is encrypted, but its key is protected only by your ${platform.signIn}. Turn on ${platform.diskEncryption}.`,
  },
  {
    title: "An owner who holds every key",
    text: "Someone with all the keys could rebuild a history that was never exported, and nothing outside this device would show the difference.",
  },
  {
    title: "Restoring while the original device keeps writing",
    text: "Two branches of the evidence log result. The verifier reports both; it cannot say which one is right.",
  },
];

const LICENCES: Array<{ name: string; role: string; licence: string }> = [
  { name: "llama.cpp", role: "Local inference engine", licence: "MIT" },
  { name: "MiniCPM5 2B", role: "Model weights (Small)", licence: "Apache-2.0" },
  { name: "Ornith 1.5 9B", role: "Model weights (Medium)", licence: "MIT" },
  { name: "SQLCipher", role: "Encrypted database", licence: "BSD-style" },
  { name: "Electron", role: "Desktop shell", licence: "MIT" },
];

/** About: build identity, honest limits (MVP 8.1, PR-10), licences, pilot support. */
export function AboutSection() {
  const version = useStore((s) => s.settings.app_version);
  const navigate = useNavigate();

  return (
    <>
      <div className="flex flex-col gap-3 px-1 pt-2 pb-2">
        <Wordmark height={22} />
        <p className="font-mono text-xs tracking-[0.02em] text-ink-soft tabular">
          <span className="text-ink">{version}</span>
          <span className="mx-2 text-ink-30">·</span>internal pilot build
          <span className="mx-2 text-ink-30">·</span>
          {platform.osVersions}
        </p>
      </div>

      <SettingGroup
        title="What this build does not protect against"
        description="Evidence in this version is self-custodied and Local, with no anchor outside the device. These limits follow from that."
      >
        <SettingPanel>
          <NumberedList items={LIMITS} />
        </SettingPanel>
      </SettingGroup>

      <SettingGroup
        title="Licences"
        description="Open-source components in this build and the model weights it can install."
      >
        <SettingPanel>
          <Ledger
            dense
            rows={LICENCES.map((l) => ({
              rawKey: true,
              k: l.name,
              v: (
                <span className="flex items-center justify-between gap-4">
                  <span className="text-ink-soft">{l.role}</span>
                  <Badge mono>{l.licence}</Badge>
                </span>
              ),
            }))}
          />
        </SettingPanel>
      </SettingGroup>

      <SettingGroup title="Pilot support">
        <SettingPanel>
          <SettingRow
            label="Pilot support · shared channel #aios-pilot"
            hint="Logs stay on this device unless you send them."
            control={
              <Button trailing={<ArrowRight className="size-3.5" />} onClick={() => navigate("/settings/health")}>
                Create a support bundle in Health
              </Button>
            }
          />
        </SettingPanel>
      </SettingGroup>
    </>
  );
}
