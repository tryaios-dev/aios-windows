import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/bridge/api";
import { selectRecommendedTier, useStore } from "@/bridge/sim/store";
import type { ModelTier } from "@/lib/types";
import { SetupFrame, type RailStep } from "./SetupFrame";
import { WelcomeStep } from "./steps/WelcomeStep";
import { MachineStep } from "./steps/MachineStep";
import { ModelStep, type ModelSource } from "./steps/ModelStep";
import { VerifiedStep } from "./steps/VerifiedStep";
import { SecureStep } from "./steps/SecureStep";
import { EngineStep } from "./steps/EngineStep";

/**
 * First-run wizard (MVP 4.1; tickets K-05, K-03, I-02). Renders without the
 * app shell. Steps 3 and 4 are skipped on a below-minimum machine; step 4 is
 * skipped whenever no model was installed.
 */

type StepId = "welcome" | "machine" | "model" | "verified" | "secure" | "engine";

const ORDER: StepId[] = ["welcome", "machine", "model", "verified", "secure", "engine"];

const LABELS: Record<StepId, string> = {
  welcome: "Welcome",
  machine: "Your machine",
  model: "Get a model",
  verified: "Verified",
  secure: "Secure your data",
  engine: "Start the engine",
};

export function SetupWizard() {
  // Setup is always a fresh install: clear the sample data so the app starts empty
  // once setup is complete. A setup already in progress (e.g. after a reload) is kept.
  useEffect(() => api.firstRun.begin(), []);

  const recommended = useStore(selectRecommendedTier);
  const [step, setStep] = useState<StepId>("welcome");
  const [tier, setTier] = useState<ModelTier | null>(null);
  const [machineChecked, setMachineChecked] = useState(false);
  const [source, setSource] = useState<ModelSource>("mirror");
  const [skippedModel, setSkippedModel] = useState(false);
  const [installedModelId, setInstalledModelId] = useState<string | null>(null);
  const [prepared, setPrepared] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const belowMinimum = machineChecked && recommended === null;
  const noModel = belowMinimum || (skippedModel && !installedModelId);

  const isSkipped = (id: StepId) => (id === "model" && belowMinimum) || (id === "verified" && noModel);

  const index = ORDER.indexOf(step);
  const total = ORDER.length;

  const move = (dir: 1 | -1) => {
    let i = index + dir;
    while (i >= 0 && i < total && isSkipped(ORDER[i]!)) i += dir;
    if (i >= 0 && i < total) setStep(ORDER[i]!);
  };
  const back = () => move(-1);
  const next = () => move(1);

  const onInstalled = useCallback((id: string) => {
    setInstalledModelId(id);
    setSkippedModel(false);
  }, []);
  const onChecked = useCallback(() => setMachineChecked(true), []);
  const onPrepared = useCallback(() => setPrepared(true), []);
  const onTierChange = useCallback((t: ModelTier) => setTier(t), []);

  const rail: RailStep[] = ORDER.map((id, i) => ({
    id,
    label: LABELS[id],
    state: isSkipped(id) ? "skipped" : i < index ? "done" : i === index ? "current" : "todo",
  }));

  const eyebrow = `Step ${index + 1} of ${total} · ${LABELS[step]}`;

  let content: ReactNode;
  switch (step) {
    case "welcome":
      content = <WelcomeStep onContinue={next} />;
      break;
    case "machine":
      content = (
        <MachineStep
          eyebrow={eyebrow}
          tier={tier}
          onTierChange={onTierChange}
          checked={machineChecked}
          onChecked={onChecked}
          onBack={back}
          onContinue={next}
        />
      );
      break;
    case "model":
      content = (
        <ModelStep
          eyebrow={eyebrow}
          tier={tier ?? recommended ?? "small"}
          source={source}
          onSourceChange={setSource}
          installedModelId={installedModelId}
          onInstalled={onInstalled}
          onSkip={() => {
            setSkippedModel(true);
            setStep("secure");
          }}
          onBack={back}
          onContinue={next}
        />
      );
      break;
    case "verified":
      content = <VerifiedStep eyebrow={eyebrow} entryId={installedModelId ?? ""} onBack={back} onContinue={next} />;
      break;
    case "secure":
      content = (
        <SecureStep
          eyebrow={eyebrow}
          acknowledged={acknowledged}
          onAcknowledge={setAcknowledged}
          prepared={prepared}
          onPrepared={onPrepared}
          onBack={back}
          onContinue={next}
        />
      );
      break;
    case "engine":
      content = (
        <EngineStep
          eyebrow={eyebrow}
          installedModelId={noModel ? null : installedModelId}
          networkUsed={!!installedModelId && source === "mirror"}
        />
      );
      break;
  }

  return (
    <SetupFrame steps={rail} current={index}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          className="flex min-h-0 flex-1 flex-col"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3, transition: { duration: 0.12 } }}
          transition={{ duration: 0.24, ease: [0.2, 0.7, 0.2, 1] }}
        >
          {content}
        </motion.div>
      </AnimatePresence>
    </SetupFrame>
  );
}
