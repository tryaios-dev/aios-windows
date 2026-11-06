import type * as React from "react";
import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Cpu, HardDrive, MemoryStick, Monitor } from "lucide-react";
import { selectRecommendedTier, useStore } from "@/bridge/sim/store";
import type { CatalogueEntry, Hardware, ModelTier } from "@/lib/types";
import { formatBytes } from "@/lib/format";
import { catalogueEntry, hardwareSupports, MINIMUM_PROFILE } from "@/bridge/sim/catalogue";
import { Badge } from "@/components/ui/chips";
import { RadioCard, RadioGroup } from "@/components/ui/fields";
import { Callout } from "@/components/ui/feedback";
import { Mono, SectionLabel } from "@/components/ui/layout";
import { Plate, Sequence, StepBody, StepFooter, StepHeading } from "../SetupFrame";
import { useSequence } from "../useSequence";
import { TIER_ENTRY, TIER_EXPECTATION, TIER_LABEL } from "../tiers";

const CHECKS = [
  { icon: Cpu, label: "Processor" },
  { icon: MemoryStick, label: "Memory" },
  { icon: Monitor, label: "Graphics" },
  { icon: HardDrive, label: "Free disk" },
];

/** Why an entry cannot run here, in one sentence. Null when it can. */
function unsupportedReason(entry: CatalogueEntry, hw: Hardware): string | null {
  if (hardwareSupports(entry, hw)) return null;
  const needDisk = Math.ceil((entry.size_bytes + 2 * 1024 ** 3) / 1024 ** 3);
  if (hw.free_disk_gb < needDisk)
    return `Needs ${needDisk} GB free disk including working space; ${hw.free_disk_gb} GB is free.`;
  if (entry.min_vram_gb > 0) {
    const has = hw.gpu
      ? `${hw.ram_gb} GB memory and a GPU with ${hw.gpu.vram_gb} GB`
      : `${hw.ram_gb} GB memory and no supported GPU`;
    return `Needs ${entry.min_ram_gb} GB memory or a GPU with ${entry.min_vram_gb} GB; this machine has ${has}.`;
  }
  return `Needs ${entry.min_ram_gb} GB memory; this machine has ${hw.ram_gb} GB.`;
}

/** What each detection row reports once it has ticked, in the mono register. */
function checkDetail(label: string, hw: Hardware): string {
  switch (label) {
    case "Processor":
      return `${hw.cores} cores`;
    case "Memory":
      return `${hw.ram_gb} GB`;
    case "Graphics":
      return hw.gpu
        ? `${hw.gpu.vram_gb} GB · ${hw.gpu.driver_ok ? "driver OK" : "driver needs updating"}`
        : "none supported";
    default:
      return `${hw.free_disk_gb} GB free`;
  }
}

export function MachineStep({
  eyebrow,
  tier,
  onTierChange,
  checked,
  onChecked,
  onBack,
  onContinue,
}: {
  eyebrow: string;
  tier: ModelTier | null;
  onTierChange: (t: ModelTier) => void;
  checked: boolean;
  onChecked: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const hw = useStore((s) => s.hardware);
  const recommended = useStore(selectRecommendedTier);
  const { done, finished } = useSequence([420, 380, 440, 380], checked);
  const belowMinimum = recommended === null;

  useEffect(() => {
    if (finished && !checked) onChecked();
  }, [finished, checked, onChecked]);

  // Preselect the recommendation once the check has finished.
  useEffect(() => {
    if (finished && tier === null && recommended) onTierChange(recommended);
  }, [finished, tier, recommended, onTierChange]);

  const small = catalogueEntry(TIER_ENTRY.small)!;
  const medium = catalogueEntry(TIER_ENTRY.medium)!;

  return (
    <>
      <StepBody>
        <StepHeading
          eyebrow={eyebrow}
          title="Your machine"
          lede="AIOS looks at this computer to recommend a model size. Nothing is sent anywhere."
        />

        <AnimatePresence mode="wait" initial={false}>
          {!finished ? (
            <motion.section key="checking" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
              <SectionLabel right="Reading only">Checking this computer</SectionLabel>
              <Plate className="mt-3 py-2 sm:py-2">
                <Sequence
                  label="Hardware checks"
                  done={done}
                  items={CHECKS.map(({ icon: Icon, label }) => ({
                    label: (
                      <span className="inline-flex items-center gap-2.5">
                        <Icon className="size-3.5 text-ink-50" aria-hidden strokeWidth={1.75} />
                        {label}
                      </span>
                    ),
                    detail: checkDetail(label, hw),
                  }))}
                />
              </Plate>
            </motion.section>
          ) : (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: [0.2, 0.7, 0.2, 1] }}
              className="flex flex-col gap-6"
            >
              <section>
                <SectionLabel right={hw.gpu ? "GPU build" : "CPU build"}>Detected</SectionLabel>
                <Plate className="mt-3 p-0 sm:p-0">
                  <dl className="grid grid-cols-1 divide-y divide-line-soft sm:grid-cols-2 sm:divide-y-0">
                    <SpecCell
                      label="Processor"
                      value={hw.cpu}
                      meta={`${hw.cores} cores`}
                      className="sm:border-b sm:border-r sm:border-line-soft"
                    />
                    <SpecCell
                      label="Memory"
                      value={<Mono className="text-xl text-ink">{hw.ram_gb} GB</Mono>}
                      className="sm:border-b sm:border-line-soft"
                    />
                    <SpecCell
                      label="Graphics"
                      value={hw.gpu ? hw.gpu.name : "No supported GPU"}
                      meta={
                        hw.gpu
                          ? `${hw.gpu.vram_gb} GB · ${hw.gpu.driver_ok ? "driver OK" : "driver needs updating"}`
                          : "the CPU build will be used"
                      }
                      className="sm:border-r sm:border-line-soft"
                    />
                    <SpecCell
                      label="Free disk"
                      value={<Mono className="text-xl text-ink">{hw.free_disk_gb} GB</Mono>}
                      meta={hw.os}
                    />
                  </dl>
                </Plate>
              </section>

              <section>
                <SectionLabel right={recommended ? `Recommended: ${TIER_LABEL[recommended]}` : "Below minimum"}>
                  Model size
                </SectionLabel>
                {belowMinimum ? (
                  <Callout tone="caution" className="mt-3" title="No model fits this machine">
                    This machine is below the minimum ({MINIMUM_PROFILE.ram_gb} GB memory and{" "}
                    {MINIMUM_PROFILE.free_disk_gb} GB free disk). AIOS works without chat: history, search and export
                    still run.
                  </Callout>
                ) : (
                  <>
                    <p className="mt-3 text-sm leading-5 text-ink-soft">
                      Recommended: <span className="font-medium text-ink">{TIER_LABEL[recommended]}</span>. You can
                      change the model later in Models.
                    </p>
                    <RadioGroup
                      value={tier ?? ""}
                      onValueChange={(v) => onTierChange(v as ModelTier)}
                      className="mt-3 flex flex-col gap-3"
                      aria-label="Model size"
                    >
                      {(
                        [
                          ["small", small],
                          ["medium", medium],
                        ] as Array<[ModelTier, CatalogueEntry]>
                      ).map(([t, entry]) => {
                        const reason = unsupportedReason(entry, hw);
                        return (
                          <RadioCard
                            key={t}
                            value={t}
                            disabled={!!reason}
                            className="p-5 shadow-card"
                            title={
                              <span className="inline-flex items-center gap-2">
                                {TIER_LABEL[t]}
                                {recommended === t && <Badge tone="green">Recommended</Badge>}
                              </span>
                            }
                            meta={
                              <Mono className="tabular">
                                {entry.name} · {formatBytes(entry.size_bytes)}
                              </Mono>
                            }
                            description={TIER_EXPECTATION[t]}
                          >
                            {reason && (
                              <span className="mt-1.5 block text-xs leading-4.5 text-brass-text">
                                Not supported on this machine. {reason}
                              </span>
                            )}
                          </RadioCard>
                        );
                      })}
                    </RadioGroup>
                  </>
                )}
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </StepBody>
      <StepFooter
        onBack={onBack}
        primary={{
          label: belowMinimum && finished ? "Continue without a model" : "Continue",
          onClick: onContinue,
          disabled: !finished || (!belowMinimum && tier === null),
          loading: !finished,
        }}
      />
    </>
  );
}

/** One cell of the spec plate: mono label, the figure or name, a mono footnote. */
function SpecCell({
  label,
  value,
  meta,
  className,
}: {
  label: string;
  value: React.ReactNode;
  meta?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={`flex flex-col gap-1.5 px-5 py-4 ${className ?? ""}`}>
      <dt className="label-mono">{label}</dt>
      <dd className="min-w-0">
        <div className="truncate text-base font-medium text-ink">{value}</div>
        {meta && <div className="mt-0.5 font-mono text-xs leading-4.5 tabular text-ink-50">{meta}</div>}
      </dd>
    </div>
  );
}
