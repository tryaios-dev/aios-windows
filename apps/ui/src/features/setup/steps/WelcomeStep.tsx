import { useNavigate } from "react-router";
import { ArrowRight, FileSignature, Lock, WifiOff } from "lucide-react";
import { motion } from "motion/react";
import { APP_VERSION } from "@/bridge/sim/store";
import { Button } from "@/components/ui/button";
import { Plate, StepBody, StepHeading } from "../SetupFrame";

const PROMISES = [
  { icon: Lock, text: "Conversations stay on this device." },
  { icon: FileSignature, text: "Every request is recorded in an evidence log you can verify." },
  { icon: WifiOff, text: "Works with no internet." },
];

export function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  const navigate = useNavigate();
  return (
    <StepBody className="flex min-h-full flex-col lg:pt-20">
      <StepHeading title="Private AI on this computer." rule className="mb-10" />

      <Plate className="p-0 sm:p-0">
        <ul className="divide-y divide-line-soft">
          {PROMISES.map(({ icon: Icon, text }, i) => (
            <motion.li
              key={text}
              className="flex items-center gap-4 px-5 py-4 sm:px-6"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: [0.2, 0.7, 0.2, 1], delay: 0.08 + i * 0.04 }}
            >
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line-soft bg-paper-raised text-ink-soft"
                aria-hidden
              >
                <Icon className="size-4" strokeWidth={1.75} />
              </span>
              <span className="text-md leading-6 text-ink">{text}</span>
            </motion.li>
          ))}
        </ul>
      </Plate>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" onClick={onContinue} trailing={<ArrowRight className="size-3.5" />}>
          Set up AIOS
        </Button>
        <Button variant="secondary" size="lg" onClick={() => navigate("/setup/restore")}>
          Restore from a backup
        </Button>
      </div>

      <p className="label-mono mt-auto pt-16">AIOS {APP_VERSION} · internal pilot build</p>
    </StepBody>
  );
}
