import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Check, Download, Pause, Play, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "@/bridge/api";
import { useStore } from "@/bridge/sim/store";
import type { CatalogueEntry, DownloadState, Hardware, InstalledModel } from "@/lib/types";
import { cn } from "@/lib/cn";
import { formatBytes, formatDate, formatSpeed, relativeTime } from "@/lib/format";
import { hardwareSupports } from "@/bridge/sim/catalogue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/chips";
import { Callout, Progress } from "@/components/ui/feedback";
import { Card, Hash, KeyValue, Mono } from "@/components/ui/layout";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { DeleteModelDialog } from "./DeleteModelDialog";
import {
  contextLabel,
  diskFits,
  freeSpaceText,
  machineHas,
  memoryFits,
  remainingLabel,
  requirementText,
  sourceLabel,
  tierLabel,
} from "./modelHelpers";

/** One catalogue entry with its install state (MVP 4.3, 9.6; K-06, I-03, I-04). */
export function ModelCard({
  entry,
  installed,
  index,
}: {
  entry: CatalogueEntry;
  installed?: InstalledModel | undefined;
  index: number;
}) {
  const hardware = useStore((s) => s.hardware);
  const download = useStore((s) => s.downloads[entry.entry_id]);
  const isDefault = useStore((s) => s.settings.default_model_id === entry.entry_id);
  const [del, setDel] = useState(false);

  const supported = hardwareSupports(entry, hardware);
  const memOk = memoryFits(entry, hardware);
  const active = download && download.status !== "done" ? download : null;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index, 8) * 0.02, ease: [0.2, 0.7, 0.2, 1] }}
    >
      <Card padded={false} raised={!!installed} className="flex flex-col sm:flex-row">
        <div className="min-w-0 flex-1 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-md font-semibold leading-6 text-ink">{entry.name}</h3>
            <Badge tone="neutral">{tierLabel(entry.tier)}</Badge>
            {installed && isDefault && <Badge tone="green">Default</Badge>}
          </div>
          <p className="mt-1 text-sm leading-5 text-ink-soft">{entry.description}</p>

          <SpecsRow entry={entry} />
          <ProvenanceLine entry={entry} />

          {memOk ? (
            <p className="mt-2 text-xs leading-4.5 text-ink-50">{requirementText(entry)}</p>
          ) : (
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-4.5 text-brass-text">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-medium">Not supported on this machine.</span> {requirementText(entry)}; this
                machine has {machineHas(hardware)}.
              </span>
            </p>
          )}
        </div>

        <div className="flex w-full shrink-0 flex-col justify-center border-t border-line-soft p-5 sm:w-64 sm:border-l sm:border-t-0">
          {active ? (
            <DownloadArea entry={entry} download={active} />
          ) : installed ? (
            <InstalledArea model={installed} onDelete={() => setDel(true)} />
          ) : (
            <InstallArea entry={entry} hardware={hardware} supported={supported} />
          )}
        </div>
      </Card>
      {installed && <DeleteModelDialog open={del} onOpenChange={setDel} model={installed} />}
    </motion.div>
  );
}

/* ---------------- Left column pieces ---------------- */

function SpecsRow({ entry }: { entry: CatalogueEntry }) {
  const specs = [
    formatBytes(entry.size_bytes),
    entry.quantisation_method,
    contextLabel(entry.context_length),
    entry.licence,
    entry.publisher,
  ];
  return (
    <p
      className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-xs tabular tracking-[0.02em] text-ink-50"
      aria-label="Specifications"
    >
      {specs.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden className="text-ink-50">
              ·
            </span>
          )}
          {s}
        </span>
      ))}
    </p>
  );
}

function ProvenanceLine({ entry }: { entry: CatalogueEntry }) {
  const approval = entry.deviation_approval;
  const rows: Array<{ k: ReactNode; v: ReactNode }> = [
    {
      k: "Upstream",
      v: (
        <Mono className="text-ink">
          {entry.upstream_model} @ {entry.upstream_revision}
        </Mono>
      ),
    },
    {
      k: "Conversion",
      v: (
        <span className="text-xs leading-4.5">
          {entry.conversion_tool} · <Mono>{entry.conversion_version}</Mono>
        </span>
      ),
    },
    { k: "Quantisation", v: <Mono className="text-ink">{entry.quantisation_method}</Mono> },
    {
      k: "Source weights",
      v: entry.source_weight_digest ? (
        <Hash value={entry.source_weight_digest} head={10} tail={6} />
      ) : (
        <span className="text-xs leading-4.5">Not published upstream; covered by the deviation approval</span>
      ),
    },
    { k: "Artefact digest", v: <Hash value={entry.artifact_digest} head={10} tail={6} /> },
    {
      k: "Licence",
      v: (
        <span className="text-xs leading-4.5">
          {entry.licence} · <Mono>{entry.licence_reference}</Mono>
        </span>
      ),
    },
    { k: "Publisher", v: <span className="text-xs leading-4.5">{entry.publisher}</span> },
    {
      k: "Pipeline",
      v: (
        <span className="text-xs leading-4.5">
          {entry.pipeline === "own" ? "Own quantisation pipeline" : "Third-party artefact, reviewed before listing"}
        </span>
      ),
    },
  ];
  if (approval) {
    rows.push({
      k: "Deviation approval",
      v: (
        <span className="flex flex-col gap-0.5 text-xs leading-4.5">
          <span>
            {approval.reviewer} · {formatDate(approval.date)}
          </span>
          <span className="text-ink-50">{approval.quality_threshold_result}</span>
        </span>
      ),
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-4.5 text-ink-50">
      <ShieldCheck className="size-3.5 shrink-0 text-ink-50" aria-hidden />
      {entry.pipeline === "own" ? (
        <span>
          Upstream <Mono className="text-ink-soft">{entry.upstream_model}</Mono> @{" "}
          <Mono className="text-ink-soft">{entry.upstream_revision}</Mono> · own quantisation pipeline
        </span>
      ) : (
        <span>
          Community quantisation · deviation approved by {approval?.reviewer ?? "a reviewer"}
          {approval ? ` on ${formatDate(approval.date)}` : ""}
        </span>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="rounded-xs text-xs font-medium text-green hover:underline">
            Provenance record
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[460px] max-w-[calc(100vw-32px)]">
          <div className="label-mono mb-1">Provenance record · {entry.name}</div>
          <KeyValue dense rows={rows} />
          <p className="mt-2 text-2xs leading-4 text-ink-50">
            Both digests are checked against the signed catalogue before the file is used.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ---------------- Right column states ---------------- */

function InstalledArea({ model, onDelete }: { model: InstalledModel; onDelete: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="green" icon={<Check />}>
          Installed
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          leading={<Trash2 className="size-3.5" />}
          className="-mr-2 text-ink-50 hover:bg-deny-soft hover:text-deny"
          onClick={onDelete}
          aria-label={`Delete ${model.name}`}
        >
          Delete
        </Button>
      </div>
      <dl className="flex flex-col gap-0.5 text-xs leading-4.5 text-ink-50">
        <div className="flex gap-1.5">
          <dt className="sr-only">Installed</dt>
          <dd>Installed {relativeTime(model.installed_at)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="sr-only">Source</dt>
          <dd>{sourceLabel(model.source)}</dd>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <dt>Digest</dt>
          <dd className="min-w-0">
            <Hash value={model.artifact_digest} head={8} tail={4} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function InstallArea({
  entry,
  hardware,
  supported,
}: {
  entry: CatalogueEntry;
  hardware: Hardware;
  supported: boolean;
}) {
  const diskOk = diskFits(entry, hardware);
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        size="sm"
        className="w-full"
        leading={<Download className="size-3.5" />}
        disabled={!supported}
        onClick={() => api.models.download(entry.entry_id)}
      >
        Download
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        disabled={!supported}
        onClick={() => api.models.importOffline(entry.entry_id)}
      >
        Import from offline package
      </Button>
      <p className={cn("text-xs leading-4.5", diskOk ? "text-ink-50" : "text-brass-text")}>
        {freeSpaceText(entry, hardware)}
      </p>
    </div>
  );
}

function DownloadArea({ entry, download }: { entry: CatalogueEntry; download: DownloadState }) {
  const id = entry.entry_id;
  const pct = download.total_bytes > 0 ? (download.received_bytes / download.total_bytes) * 100 : 0;
  const received = formatBytes(download.received_bytes);
  const total = formatBytes(download.total_bytes);

  if (download.status === "verifying") {
    return (
      <div className="flex flex-col gap-2">
        <span className="label-mono">Verifying</span>
        <Progress value={100} indeterminate label={`Verifying ${entry.name}`} />
        <p className="text-xs leading-4.5 text-ink-50">
          Checking digest and provenance record against the signed catalogue
        </p>
      </div>
    );
  }

  if (download.status === "failed") {
    return (
      <Callout
        tone="deny"
        compact
        title="Download interrupted"
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="primary"
              leading={<Play className="size-3.5" />}
              onClick={() => api.models.resume(id)}
            >
              Resume download
            </Button>
            <Button size="sm" variant="ghost" onClick={() => api.models.cancel(id)}>
              Cancel
            </Button>
          </div>
        }
      >
        {download.error ?? "The connection to the model mirror dropped."} {received} of {total} is kept.
      </Callout>
    );
  }

  if (download.status === "paused") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="label-mono">Paused</span>
          <span className="font-mono text-xs tabular text-ink-50">{Math.round(pct)}%</span>
        </div>
        <Progress value={pct} className="opacity-60" label={`${entry.name} download paused`} />
        <p className="text-xs leading-4.5 tabular text-ink-50">
          Paused at {received} of {total}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="primary"
            leading={<Play className="size-3.5" />}
            onClick={() => api.models.resume(id)}
          >
            Resume
          </Button>
          <Button size="sm" variant="ghost" onClick={() => api.models.cancel(id)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // queued or downloading
  const remaining = remainingLabel(download.total_bytes - download.received_bytes, download.speed_bps);
  const detail =
    download.speed_bps > 0
      ? `${received} of ${total} · ${formatSpeed(download.speed_bps)}${remaining ? ` · ${remaining}` : ""}`
      : `${received} of ${total} · starting`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="label-mono">{download.status === "queued" ? "Waiting" : "Downloading"}</span>
        <span className="font-mono text-xs tabular text-ink-50">{Math.round(pct)}%</span>
      </div>
      <Progress value={pct} label={`Downloading ${entry.name}`} />
      <p className="text-xs leading-4.5 tabular text-ink-50">{detail}</p>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          leading={<Pause className="size-3.5" />}
          onClick={() => api.models.pause(id)}
        >
          Pause
        </Button>
        <Button size="sm" variant="ghost" onClick={() => api.models.cancel(id)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
