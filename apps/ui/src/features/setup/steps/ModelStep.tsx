import type * as React from "react";
import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, Package, Pause, Play, RotateCcw } from "lucide-react";
import { api } from "@/bridge/api";
import { useStore } from "@/bridge/sim/store";
import type { DownloadState, ModelTier } from "@/lib/types";
import { formatBytes, formatDuration, formatSpeed } from "@/lib/format";
import { catalogueEntry } from "@/bridge/sim/catalogue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/chips";
import { RadioCard, RadioGroup } from "@/components/ui/fields";
import { Callout } from "@/components/ui/feedback";
import { Mono, SectionLabel } from "@/components/ui/layout";
import { DrawnCheck, Plate, SegmentedProgress, StepBody, StepFooter, StepHeading } from "../SetupFrame";
import { TIER_ENTRY } from "../tiers";
import { platform } from "@/lib/platform";

export type ModelSource = "mirror" | "offline";

const WORKING_SPACE = 2 * 1024 ** 3;
const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1];

export function ModelStep({
  eyebrow,
  tier,
  source,
  onSourceChange,
  installedModelId,
  onInstalled,
  onSkip,
  onBack,
  onContinue,
}: {
  eyebrow: string;
  tier: ModelTier;
  source: ModelSource;
  onSourceChange: (s: ModelSource) => void;
  installedModelId: string | null;
  onInstalled: (id: string) => void;
  onSkip: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const entry = catalogueEntry(TIER_ENTRY[tier])!;
  const entryId = entry.entry_id;
  const hw = useStore((s) => s.hardware);
  const download = useStore((s) => s.downloads[entryId]);
  const installed = useStore((s) => s.installedModels.some((m) => m.id === entryId));
  const installedSource = useStore((s) => s.installedModels.find((m) => m.id === entryId)?.source);

  useEffect(() => {
    if (installed && installedModelId !== entryId) onInstalled(entryId);
  }, [installed, installedModelId, entryId, onInstalled]);

  const needGb = Math.ceil((entry.size_bytes + WORKING_SPACE) / 1024 ** 3);
  const enoughDisk = hw.free_disk_gb >= needGb;
  const inFlight = !!download;
  const locked = inFlight || installed;

  const start = () => {
    if (source === "mirror") api.models.download(entryId);
    else api.models.importOffline(entryId);
  };

  return (
    <>
      <StepBody>
        <StepHeading
          eyebrow={eyebrow}
          title="Get a model"
          lede="Models come only from the signed AIOS catalogue. Choose where this one comes from; AIOS checks the file against the catalogue either way."
        />

        <SectionLabel right={<Mono className="tabular text-ink-50">{entry.name}</Mono>}>Source</SectionLabel>
        <RadioGroup
          value={source}
          onValueChange={(v) => onSourceChange(v as ModelSource)}
          className="mt-3 flex flex-col gap-3"
          aria-label="Where the model comes from"
          disabled={locked}
        >
          <RadioCard
            value="mirror"
            className="p-5 shadow-card"
            title="Download from the AIOS model mirror"
            meta={<Mono className="tabular">{formatBytes(entry.size_bytes)}</Mono>}
            description={
              <>
                {entry.name} · {entry.quantisation_method} · {entry.context_length.toLocaleString()} token context
              </>
            }
          >
            <span
              className={`mt-1.5 block font-mono text-xs leading-4.5 tabular ${enoughDisk ? "text-ink-50" : "text-deny"}`}
            >
              {hw.free_disk_gb} GB free, needs {needGb} GB including working space
            </span>
          </RadioCard>
          <RadioCard
            value="offline"
            className="p-5 shadow-card"
            title={`Use the offline package found next to ${platform.installer}`}
            meta={<Mono className="tabular">{formatBytes(entry.size_bytes)}</Mono>}
            description="Checked against the same catalogue entry. Nothing is downloaded."
          >
            <span className="mt-1.5 block font-mono text-xs leading-4.5 tabular text-ink-50">
              {`models\\${entry.file_name}`} · {formatBytes(entry.size_bytes)} · No network needed
            </span>
          </RadioCard>
        </RadioGroup>

        <section className="mt-6">
          <SectionLabel right={installed ? "Installed" : download ? statusLabel(download.status) : undefined}>
            {source === "mirror" ? "Download" : "Offline import"}
          </SectionLabel>
          <div className="mt-3">
            <AnimatePresence mode="wait" initial={false}>
              {installed ? (
                <Reveal key="installed">
                  <InstalledPanel name={entry.name} size={entry.size_bytes} source={installedSource ?? source} />
                </Reveal>
              ) : download ? (
                <Reveal key="download">
                  <DownloadPanel download={download} name={entry.name} />
                </Reveal>
              ) : (
                <Reveal key="idle">
                  <Plate className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm leading-5 text-ink-soft">
                      {source === "mirror" ? (
                        <>
                          From <Mono className="text-ink">models.aios.eu.com</Mono>, the only host AIOS contacts for
                          models. You can pause and resume.
                        </>
                      ) : (
                        <>Copies the file from the installer folder and verifies it. Takes a moment.</>
                      )}
                    </p>
                    <Button
                      variant="primary"
                      leading={
                        source === "mirror" ? <Download className="size-3.5" /> : <Package className="size-3.5" />
                      }
                      onClick={start}
                      disabled={source === "mirror" && !enoughDisk}
                      className="shrink-0"
                    >
                      {source === "mirror" ? `Download ${entry.name}` : `Import ${entry.name}`}
                    </Button>
                  </Plate>
                </Reveal>
              )}
            </AnimatePresence>
            {!installed && !download && source === "mirror" && !enoughDisk && (
              <p className="mt-2 text-xs leading-4.5 text-deny">
                Not enough free disk for this model. Free some space, use the offline package, or skip for now.
              </p>
            )}
          </div>
        </section>
      </StepBody>
      <StepFooter
        onBack={onBack}
        secondary={
          !locked && (
            <Button variant="link" onClick={onSkip} className="mr-2">
              Skip for now
            </Button>
          )
        }
        primary={{ label: "Continue", onClick: onContinue, disabled: !installed }}
      />
    </>
  );
}

function Reveal({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.24, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

function statusLabel(status: DownloadState["status"]) {
  return {
    queued: "Queued",
    downloading: "Downloading",
    paused: "Paused",
    verifying: "Verifying",
    failed: "Interrupted",
    done: "Done",
  }[status];
}

function DownloadPanel({ download, name }: { download: DownloadState; name: string }) {
  const pct = download.total_bytes ? (download.received_bytes / download.total_bytes) * 100 : 0;
  const remaining =
    download.speed_bps > 0
      ? formatDuration((download.total_bytes - download.received_bytes) / download.speed_bps)
      : null;
  const tone = download.status === "failed" ? "deny" : download.status === "paused" ? "brass" : "green";

  if (download.status === "verifying") {
    return (
      <Plate className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-medium text-ink">Verifying {name}</div>
            <div className="mt-0.5 text-sm leading-5 text-ink-soft">
              Computing the SHA-256 digest and comparing it with the signed catalogue entry.
            </div>
          </div>
          <Mono className="shrink-0 tabular">{formatBytes(download.total_bytes)}</Mono>
        </div>
        <div
          className="shimmer h-2 w-full rounded-[2px]"
          role="progressbar"
          aria-label={`Verifying ${name}`}
          aria-valuetext="Verifying"
        />
        <div className="label-mono">SHA-256 · signed catalogue</div>
      </Plate>
    );
  }

  const title =
    download.status === "paused"
      ? `Paused · ${name}`
      : download.status === "failed"
        ? `Interrupted · ${name}`
        : `Downloading ${name}`;

  return (
    <Plate className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-medium text-ink">{title}</div>
          <div className="mt-0.5 text-sm leading-5 text-ink-soft">
            {download.status === "downloading"
              ? "From the model mirror. Pause any time; what is on disk stays on disk."
              : "Resume to continue from where it stopped."}
          </div>
        </div>
        {download.status === "downloading" && (
          <Button
            size="sm"
            variant="secondary"
            leading={<Pause className="size-3.5" />}
            onClick={() => api.models.pause(download.entry_id)}
            className="shrink-0"
          >
            Pause
          </Button>
        )}
        {download.status === "paused" && (
          <Button
            size="sm"
            variant="secondary"
            leading={<Play className="size-3.5" />}
            onClick={() => api.models.resume(download.entry_id)}
            className="shrink-0"
          >
            Resume
          </Button>
        )}
      </div>

      <SegmentedProgress value={pct} tone={tone} label={`${name} download`} />

      <div className="grid grid-cols-3 gap-4 font-mono text-xs leading-4.5 tabular">
        <Figure
          label="Received"
          value={`${formatBytes(download.received_bytes)} / ${formatBytes(download.total_bytes)}`}
        />
        <Figure
          label="Speed"
          value={
            download.status === "downloading"
              ? download.speed_bps > 0
                ? formatSpeed(download.speed_bps)
                : "connecting"
              : "—"
          }
        />
        <Figure
          label="Remaining"
          value={download.status === "downloading" ? (remaining ?? "estimating") : `${Math.round(pct)}% kept on disk`}
          align="right"
        />
      </div>

      {download.status === "failed" && (
        <Callout
          tone="deny"
          compact
          title="Download interrupted"
          action={
            <Button
              size="sm"
              variant="primary"
              leading={<RotateCcw className="size-3.5" />}
              onClick={() => api.models.resume(download.entry_id)}
            >
              Resume download
            </Button>
          }
        >
          {download.error ?? "The connection to the model mirror dropped."} {Math.round(pct)}% is kept on disk, so
          nothing is downloaded twice.
        </Callout>
      )}
    </Plate>
  );
}

function Figure({ label, value, align }: { label: string; value: string; align?: "right" }) {
  return (
    <div className={align === "right" ? "text-right" : undefined}>
      <div className="label-mono">{label}</div>
      <div className="mt-1 truncate text-ink">{value}</div>
    </div>
  );
}

function InstalledPanel({
  name,
  size,
  source,
}: {
  name: string;
  size: number;
  source: "download" | "offline" | ModelSource;
}) {
  const offline = source === "offline";
  return (
    <Plate tone="success" className="flex items-start gap-4">
      <span
        className="mt-px flex size-7 shrink-0 items-center justify-center rounded-full bg-green text-white"
        aria-hidden
      >
        <DrawnCheck className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="text-base font-medium text-ink">{name} is installed</div>
          <Mono className="shrink-0 tabular text-ink">{formatBytes(size)}</Mono>
        </div>
        <div className="mt-1 text-sm leading-5 text-ink-soft">
          {offline ? "Imported from the offline package" : "Downloaded from the model mirror"} · digest and provenance
          record verified against the signed catalogue.
        </div>
        <div className="mt-3">
          <Badge tone="green">Verified</Badge>
        </div>
      </div>
    </Plate>
  );
}
