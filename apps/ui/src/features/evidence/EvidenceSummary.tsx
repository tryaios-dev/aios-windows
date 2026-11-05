import type { ReactNode } from "react";
import { Info } from "lucide-react";
import type { Checkpoint, EvidenceStream } from "@/lib/types";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { shortHash } from "@/lib/hash";
import { useWriterStatus } from "@/components/app/useEngineStatus";
import { StatusDot } from "@/components/ui/chips";
import { Card, Hash } from "@/components/ui/layout";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";

/**
 * The stream plate: one raised card that states the ledger's identity.
 * Top tier: stream id and epoch set large, a hairline, then the running figures.
 * Bottom tier: the custody statement, which is the honesty line of the product.
 */
export function EvidenceSummary({
  stream,
  projectCount,
  totalCount,
  latestCheckpoint,
}: {
  stream: EvidenceStream;
  projectCount: number;
  totalCount: number;
  latestCheckpoint: Checkpoint | null;
}) {
  const writer = useWriterStatus();

  return (
    <Card raised padded={false} className="overflow-hidden">
      {/* Tier one: identity and figures */}
      <div className="flex flex-col gap-6 px-6 pt-5 pb-5 md:flex-row md:items-stretch md:gap-0">
        {/* Identity */}
        <div className="flex min-w-0 items-start gap-8 md:pr-8">
          <Figure caption="Stream" sub={`device ${stream.device_id}`}>
            <Hash value={stream.stream_id} head={8} tail={6} className="text-xl leading-7 tracking-[0.01em] text-ink" />
          </Figure>
          <Figure
            caption="Epoch"
            sub={
              stream.prior_tip_hash
                ? `continued from ${shortHash(stream.prior_tip_hash, 6, 4)}`
                : `signer ${shortHash(stream.signer_key_id, 6, 4)}`
            }
          >
            <span className="font-mono text-3xl leading-7 tabular text-ink">{stream.epoch}</span>
          </Figure>
        </div>

        {/* Hairline between identity and figures */}
        <div className="hidden w-px shrink-0 self-stretch bg-line-soft md:block" aria-hidden />
        <div className="h-px w-full bg-line-soft md:hidden" aria-hidden />

        {/* Figures */}
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3 md:pl-8">
          <Figure caption="Events" sub="this project / stream total">
            <span className="font-mono text-xl leading-7 tabular text-ink">{projectCount}</span>
            <span className="font-mono text-base leading-7 text-ink-30">/</span>
            <span className="font-mono text-base leading-7 tabular text-ink-50">{totalCount}</span>
          </Figure>

          <Figure
            caption="Latest checkpoint"
            sub={
              latestCheckpoint
                ? `seq ${latestCheckpoint.seq_from}–${latestCheckpoint.seq_to} · ${relativeTime(latestCheckpoint.created_at)}`
                : "Signed at each clean shutdown"
            }
          >
            {latestCheckpoint ? (
              <span className="font-mono text-xl leading-7 tabular text-ink">{latestCheckpoint.id}</span>
            ) : (
              <span className="font-mono text-xl leading-7 text-ink-50">none yet</span>
            )}
          </Figure>

          <Figure caption="Writer" sub={writer.detail}>
            <StatusDot tone={writer.tone} pulse={writer.tone === "brass"} className="mt-2.5" />
            <span className="truncate text-base leading-7 font-medium text-ink">{writer.label}</span>
          </Figure>
        </div>
      </div>

      {/* Tier two: custody statement */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-soft bg-paper-raised px-6 py-3">
        <span className="label-mono shrink-0">Custody</span>
        <span className="label-mono text-brass-text">Self-custodied Local · no anchor</span>
        <WhatThisProves className="ml-auto" />
      </div>
    </Card>
  );
}

function Figure({
  caption,
  sub,
  children,
  className,
}: {
  caption: string;
  sub?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <div className="label-mono">{caption}</div>
      <div className="mt-2 flex min-h-7 min-w-0 items-baseline gap-1.5">{children}</div>
      {sub && <div className="mt-1 truncate font-mono text-2xs leading-4 text-ink-50">{sub}</div>}
    </div>
  );
}

function WhatThisProves({ className }: { className?: string | undefined }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs font-medium text-green transition-colors duration-(--duration-micro) hover:bg-green-wash",
            className,
          )}
        >
          <Info className="size-3.5" aria-hidden />
          What this proves
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="label-mono mb-2">What this proves</div>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-sm leading-5 text-ink marker:text-ink-50">
          <li>Integrity, order and continuity of events on this device.</li>
          <li>Branches after a restore are reported, not hidden.</li>
        </ul>
        <div className="label-mono mt-3 mb-2">What it does not prove</div>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-sm leading-5 text-ink marker:text-ink-50">
          <li>Who was at the keyboard.</li>
          <li>Anything outside this device. The log is not independently anchored in this version.</li>
        </ul>
        <p className="mt-3 border-t border-line-soft pt-2.5 text-xs leading-4.5 text-ink-50">
          Content never enters the log. Commitments bind each event to the exact input and output without storing
          either.
        </p>
      </PopoverContent>
    </Popover>
  );
}
