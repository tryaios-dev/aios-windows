import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Gauge } from "lucide-react";
import { api } from "@/bridge/api";
import { selectRecommendedTier, useStore } from "@/bridge/sim/store";
import { relativeTime } from "@/lib/format";
import { catalogueEntry, MINIMUM_PROFILE } from "@/bridge/sim/catalogue";
import { useEngineStatus } from "@/components/app/useEngineStatus";
import { Button } from "@/components/ui/button";
import { Badge, StatusDot } from "@/components/ui/chips";
import { Callout } from "@/components/ui/feedback";
import { Card, CardHeader, KeyValue } from "@/components/ui/layout";
import { engineBuildLabel, tierLabel, timeToFirstWord } from "./modelHelpers";
import { platform } from "@/lib/platform";

/** Ledger register for figures: sizes, counts, versions. */
function Fig({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs tabular tracking-[0.02em] text-ink">{children}</span>;
}

/** "This machine": what AIOS found on this computer and how the engine is running (MVP 4.3, I-02). */
export function MachineCard() {
  const hardware = useStore((s) => s.hardware);
  const build = useStore((s) => s.health.engine_build);
  const safeMode = useStore((s) => s.settings.safe_mode_cpu);
  const tier = useStore(selectRecommendedTier);
  const hasModel = useStore((s) => s.installedModels.length > 0);
  const engine = useEngineStatus();
  const [running, setRunning] = useState(false);

  const runBenchmark = async () => {
    setRunning(true);
    try {
      await api.system.benchmark();
      const result = useStore.getState().hardware.benchmark;
      if (result) {
        useStore.getState().toast({
          kind: "success",
          title: "Benchmark finished",
          description: `${result.tokens_per_second.toFixed(1)} tokens per second, ${timeToFirstWord(result.time_to_first_token_ms)} to first word on the ${engineBuildLabel(result.engine)} build.`,
        });
      }
    } catch {
      useStore.getState().toast({
        kind: "deny",
        title: "Benchmark did not finish",
        description: "The engine did not answer. Try again; if it keeps failing, restart AIOS.",
      });
    } finally {
      setRunning(false);
    }
  };

  const benchmark = hardware.benchmark;
  const benchmarkModel = benchmark ? (catalogueEntry(benchmark.model_id)?.name ?? benchmark.model_id) : null;

  const hardwareRows = [
    { k: "Processor", v: <span>{hardware.cpu}</span> },
    { k: "Cores", v: <Fig>{hardware.cores}</Fig> },
    { k: "Memory", v: <Fig>{hardware.ram_gb} GB</Fig> },
    {
      k: "Graphics",
      v: hardware.gpu ? (
        <span className="flex flex-col gap-0.5">
          <span>
            {hardware.gpu.name} · <Fig>{hardware.gpu.vram_gb} GB VRAM</Fig>
          </span>
          {!hardware.gpu.driver_ok && (
            <span className="text-xs text-brass-text">
              Graphics driver not responding. The CPU build is used until the driver is updated.
            </span>
          )}
        </span>
      ) : (
        <span className="text-ink-50">No GPU detected</span>
      ),
    },
    { k: "Free disk", v: <Fig>{hardware.free_disk_gb} GB</Fig> },
    { k: `${platform.os} build`, v: <Fig>{hardware.os}</Fig> },
  ];

  const engineRows = [
    {
      k: "State",
      v: (
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <StatusDot tone={engine.tone} pulse={engine.pulse} />
            {engine.label}
          </span>
          <span className="text-xs text-ink-50">{engine.detail}</span>
        </span>
      ),
    },
    {
      k: "Recommended tier",
      v:
        tier === null ? (
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="brass">Below minimum</Badge>
            <span className="text-xs text-ink-50">No tier fits this machine</span>
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="green">{tierLabel(tier)}</Badge>
            <span className="text-xs text-ink-50">
              {tier === "medium" ? "Both tiers run here" : "Medium models need 16 GB memory or a GPU with 8 GB"}
            </span>
          </span>
        ),
    },
    {
      k: "Engine build",
      v: (
        <span>
          {engineBuildLabel(build)}
          <span className="text-ink-50">
            {" "}
            · {build === "cpu" ? "runs on the processor" : "Vulkan, runs on the graphics card"}
          </span>
        </span>
      ),
    },
    {
      k: "Safe mode",
      v: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>{safeMode ? "On" : "Off"}</span>
          <span className="text-xs text-ink-50">
            {safeMode ? "The engine stays on the CPU build" : "The GPU build is used when a GPU is present"}
          </span>
          <Link to="/settings/engine" className="text-sm font-medium text-green hover:underline">
            Change in Settings
          </Link>
        </span>
      ),
    },
    {
      k: "Last benchmark",
      v: benchmark ? (
        <span className="flex flex-col gap-0.5">
          <span>
            <Fig>{benchmark.tokens_per_second.toFixed(1)}</Fig> tokens per second ·{" "}
            <Fig>{timeToFirstWord(benchmark.time_to_first_token_ms)}</Fig> to first word
          </span>
          <span className="text-xs text-ink-50">
            {benchmarkModel} on the {engineBuildLabel(benchmark.engine)} build · {relativeTime(benchmark.run_at)}
          </span>
        </span>
      ) : (
        <span className="text-ink-50">Not run yet</span>
      ),
    },
  ];

  return (
    <Card className="animate-rise">
      <CardHeader
        title="This machine"
        description="What AIOS found on this computer and how the engine is running. Nothing here leaves the device."
        action={
          <Button
            variant="secondary"
            size="sm"
            leading={<Gauge className="size-3.5" />}
            loading={running}
            disabled={!hasModel}
            onClick={runBenchmark}
            title={hasModel ? undefined : "Install a model to run a benchmark"}
          >
            {running ? "Running benchmark" : "Run benchmark"}
          </Button>
        }
      />
      {tier === null && (
        <Callout tone="caution" className="mt-4" title="This machine is below the minimum for running a model">
          AIOS needs at least {MINIMUM_PROFILE.ram_gb} GB memory and {MINIMUM_PROFILE.free_disk_gb} GB free disk. This
          machine has {hardware.ram_gb} GB memory and {hardware.free_disk_gb} GB free. Projects, search, export and the
          evidence log work without a model.
        </Callout>
      )}
      <div className="mt-4 grid gap-x-10 gap-y-5 md:grid-cols-2">
        <section aria-labelledby="machine-hardware">
          <h4 id="machine-hardware" className="label-mono mb-1">
            Hardware
          </h4>
          <KeyValue dense rows={hardwareRows} />
        </section>
        <section aria-labelledby="machine-engine">
          <h4 id="machine-engine" className="label-mono mb-1">
            Engine
          </h4>
          <KeyValue dense rows={engineRows} />
        </section>
      </div>
    </Card>
  );
}
