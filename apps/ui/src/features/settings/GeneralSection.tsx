import { useState } from "react";
import { Check, Download, RefreshCw } from "lucide-react";
import { api } from "@/bridge/api";
import { useStore } from "@/bridge/sim/store";
import type { Settings } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/fields";
import { Callout } from "@/components/ui/feedback";
import { Ledger, SettingGroup, SettingPanel, SettingRow } from "@/components/app/SettingRow";

/** General: update and catalogue checks (M-18, M-21), update readiness notice (assumption A-07), version. */
export function GeneralSection() {
  const settings = useStore((s) => s.settings);
  return (
    <>
      {settings.update_available && <UpdateReady update={settings.update_available} />}
      <UpdatesGroup settings={settings} />
      <VersionGroup settings={settings} />
    </>
  );
}

/* ---------------- Update ready ---------------- */

/** The feed reports sizes in decimal megabytes, which is how the release notes quote them. */
function updateSize(bytes: number) {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function UpdateReady({ update }: { update: { version: string; size_bytes: number } }) {
  const [scheduled, setScheduled] = useState(false);
  return (
    <Callout
      tone="info"
      title={`AIOS ${update.version} is ready to install (${updateSize(update.size_bytes)})`}
      action={
        scheduled ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green animate-in">
            <Check className="size-3.5" aria-hidden /> Installs when you quit AIOS
          </span>
        ) : (
          <Button
            variant="primary"
            size="sm"
            leading={<Download className="size-3.5" />}
            onClick={() => {
              api.settings.installUpdate();
              setScheduled(true);
            }}
          >
            Install when I quit
          </Button>
        )
      }
    >
      Signature verified. It installs when you quit AIOS. A backup of the database is taken before any migration, and a
      failed migration restores it.
    </Callout>
  );
}

/* ---------------- Updates ---------------- */

function lastChecked(iso: string | null) {
  return iso ? `Checked ${relativeTime(iso)}` : "Never checked";
}

function UpdatesGroup({ settings }: { settings: Settings }) {
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<"idle" | "current" | "failed">("idle");

  const checkNow = async () => {
    setChecking(true);
    setOutcome("idle");
    try {
      await api.settings.checkForUpdates();
      // The notice above takes over when an update is waiting.
      setOutcome(useStore.getState().settings.update_available ? "idle" : "current");
    } catch {
      setOutcome("failed");
    } finally {
      setChecking(false);
    }
  };

  return (
    <SettingGroup
      title="Updates"
      description="Both checks contact only the hosts listed under Network, at the times shown there."
    >
      <SettingPanel>
        <SettingRow
          htmlFor="settings-update-check"
          label="Check for updates"
          hint="At application start and at most once a day, from the signed update feed. Turn off for air-gapped machines."
          control={
            <Switch
              id="settings-update-check"
              checked={settings.update_check}
              onCheckedChange={(v) => api.settings.update({ update_check: v })}
            />
          }
        />
        <SettingRow
          htmlFor="settings-catalogue-check"
          label="Check the model catalogue"
          hint="At application start and at most once a day, from the model mirror. Nothing is downloaded until you choose a model."
          control={
            <Switch
              id="settings-catalogue-check"
              checked={settings.catalogue_check}
              onCheckedChange={(v) => api.settings.update({ catalogue_check: v })}
            />
          }
        />
        <SettingRow
          label="Check now"
          hint="Checking now contacts the update feed and the model mirror once, even when the automatic checks are off."
          control={
            <Button leading={<RefreshCw className="size-3.5" />} loading={checking} onClick={checkNow}>
              {checking ? "Checking" : "Check now"}
            </Button>
          }
        >
          <div className="empty:hidden" aria-live="polite">
            {outcome === "current" && (
              <span className="inline-flex items-center gap-1.5 text-xs leading-4.5 text-green animate-in">
                <Check className="size-3 shrink-0" aria-hidden />
                No update is waiting. AIOS {settings.app_version} and catalogue {settings.catalogue_version} are
                current.
              </span>
            )}
            {outcome === "failed" && (
              <Callout tone="deny" compact title="The check did not complete">
                AIOS could not reach the update feed. Check the connection and try again. Nothing else is affected.
              </Callout>
            )}
          </div>
        </SettingRow>
        <Ledger
          dense
          rows={[
            {
              k: "Update feed",
              v: <span className="tabular text-ink-soft">{lastChecked(settings.last_update_check)}</span>,
            },
            {
              k: "Model catalogue",
              v: <span className="tabular text-ink-soft">{lastChecked(settings.last_catalogue_check)}</span>,
            },
          ]}
        />
      </SettingPanel>
    </SettingGroup>
  );
}

/* ---------------- Version ---------------- */

function VersionGroup({ settings }: { settings: Settings }) {
  return (
    <SettingGroup title="Version">
      <SettingPanel>
        <Ledger
          rows={[
            { k: "AIOS", v: settings.app_version, mono: true, hint: "Internal pilot build" },
            { k: "Model catalogue", v: settings.catalogue_version, mono: true, hint: "Model Catalogue v1" },
            {
              k: "Database schema",
              v: settings.schema_version,
              mono: true,
              hint: "Migrations run at start, after a backup",
            },
          ]}
        />
      </SettingPanel>
    </SettingGroup>
  );
}
