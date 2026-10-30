import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { InstalledModelRef, Project } from "@/lib/types";
import { EASE } from "@/lib/motion";
import { CLASS_META, ClassChip } from "@/components/ui/chips";
import { Callout } from "@/components/ui/feedback";
import { SectionLabel } from "@/components/ui/layout";
import { Plate, Sequence, Stat, StepBody, StepFooter, StepHeading } from "../SetupFrame";
import { useSetupStore } from "../store";

function expectation(tps: number): string {
  if (tps >= 25) return "Answers should arrive faster than you can read them.";
  if (tps >= 8) return 'Expect a sentence every few seconds. Long answers take a while, and a long conversation shows "Preparing context" before the first word.';
  return "Answers will be slow on this machine. Keep prompts short; the Small tier is the better fit.";
}

export function EngineStep({
  eyebrow,
  model,
  project,
  networkUsed,
  onOpen,
}: {
  eyebrow: string;
  model: InstalledModelRef | null;
  project: Project;
  networkUsed: boolean;
  onOpen: () => void;
}) {
  const build = useSetupStore((s) => s.engineBuild);
  const benchmark = useSetupStore((s) => s.benchmark);
  const hasModel = !!model;
  const [done, setDone] = useState(hasModel ? 0 : 2);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!hasModel) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        if (cancelled) return;
        setDone(1);
        void useSetupStore
          .getState()
          .runBenchmark()
          .then(() => {
            if (!cancelled) setDone(2);
          });
      },
      build === "cpu" ? 1_800 : 1_200,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasModel, build]);

  const finished = done >= 2;
  const buildLabel = build === "cpu" ? "CPU build" : "GPU build";
  const meta = CLASS_META[project.classification];

  const open = () => {
    setOpening(true);
    onOpen();
  };

  return (
    <>
      <StepBody>
        <StepHeading
          eyebrow={eyebrow}
          title="Start the engine"
          lede={hasModel ? "A short test shows what to expect from this machine. The engine runs only on this device." : "No model is installed, so the engine stays off for now. Everything else is ready."}
        />

        {model ? (
          <>
            <SectionLabel right={finished ? "Done" : "In progress"}>Engine</SectionLabel>
            <Plate tone="paper" className="mt-3 py-1 sm:py-1">
              <Sequence
                label="Engine start"
                done={done}
                items={[
                  { label: `Starting llama-server on the ${buildLabel}`, detail: `${model.name} · loaded into memory once per session` },
                  { label: "Running a short benchmark", detail: "A fixed prompt, timed on this machine" },
                ]}
              />
            </Plate>
            {finished && benchmark && (
              <motion.section className="mt-6 flex flex-col gap-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE }} aria-label="Benchmark result">
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Tokens per second" value={benchmark.tokens_per_second.toFixed(1)} unit="tok/s" hint="How quickly words arrive once an answer starts." />
                  <Stat label="Time to first word" value={(benchmark.time_to_first_token_ms / 1000).toFixed(1)} unit="s" hint="The pause before the first word of an answer." />
                </div>
                <p className="text-sm leading-5 text-ink-soft">{expectation(benchmark.tokens_per_second)}</p>
                <p className="label-mono">
                  {model.name} · {benchmark.engine === "cpu" ? "CPU build" : "GPU build (Vulkan)"} · llama-server
                </p>
              </motion.section>
            )}
          </>
        ) : (
          <Callout tone="neutral" title="No model installed">
            The engine starts when a model is installed. Until then chat shows the same notice; history, search and export work now. Install a model later from Models.
          </Callout>
        )}

        {finished && (
          <motion.div className="mt-6" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE, delay: hasModel ? 0.08 : 0 }}>
            <SectionLabel>What opens next</SectionLabel>
            <Plate as="section" className="mt-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-lg font-semibold text-ink">{project.name}</span>
                <ClassChip value={project.classification} />
              </div>
              <p className="mt-3 text-sm leading-5 text-ink-soft">
                Your first project, classified {meta.label} by default. {meta.summary} The evidence log already holds the installation{hasModel ? ", store and model" : " and store"} events,
                and every request from here on is appended to the same chain.
              </p>
            </Plate>
          </motion.div>
        )}
      </StepBody>
      <StepFooter
        note={networkUsed ? "During setup this computer contacted only the model mirror." : "Nothing left this computer during setup."}
        primary={{ label: "Open AIOS", onClick: open, disabled: !finished, loading: !finished || opening, arrow: false }}
      />
    </>
  );
}
