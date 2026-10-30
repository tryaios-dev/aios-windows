import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { EASE } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Checkbox, Label } from "@/components/ui/fields";
import { SectionLabel, useCopy } from "@/components/ui/layout";
import { Plate, Sequence, StepBody, StepFooter, StepHeading } from "../SetupFrame";
import { useSetupStore } from "../store";
import { useSequence } from "../useSequence";

export function SecureStep({
  eyebrow,
  acknowledged,
  onAcknowledge,
  prepared,
  onPrepared,
  onBack,
  onContinue,
}: {
  eyebrow: string;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
  prepared: boolean;
  onPrepared: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const key = useSetupStore((s) => s.recoveryKey);
  const { done, finished } = useSequence([640, 720, 620], prepared);
  const { copied, copy } = useCopy();

  // Issued exactly once per installation; Back and forth never issues a second key.
  useEffect(() => {
    useSetupStore.getState().issueRecoveryKey();
  }, []);

  useEffect(() => {
    if (finished && !prepared) onPrepared();
  }, [finished, prepared, onPrepared]);

  const ready = finished && !!key;
  const groups = key ? key.split("-") : [];

  return (
    <>
      <StepBody>
        <StepHeading
          eyebrow={eyebrow}
          title="Secure your data"
          lede="Your conversations live in an encrypted database on this device. The keys stay in Windows Credential Manager; a recovery key lets you reopen a backup on another computer."
        />

        <SectionLabel right={finished ? "Done" : "In progress"}>Preparing the store</SectionLabel>
        <Plate tone="paper" className="mt-3 py-1 sm:py-1">
          <Sequence
            label="Store preparation"
            done={done}
            items={[
              { label: "Generate the database key", detail: "chats.db · SQLCipher" },
              { label: "Store keys in Windows Credential Manager", detail: "Bound to this Windows account" },
              { label: "Write Recovery Package v1", detail: "%LOCALAPPDATA%\\AIOS\\recovery.pkg" },
            ]}
          />
        </Plate>

        {ready && key && (
          <motion.div className="mt-6 flex flex-col gap-6" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE }}>
            <Plate className="p-1.5 sm:p-1.5">
              <div className="rounded-[7px] border border-line-soft px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
                <SectionLabel right="Shown once">Recovery key</SectionLabel>
                <div className="mt-5 grid grid-cols-2 gap-y-3 sm:grid-cols-4" aria-label={`Recovery key ${key}`} role="group">
                  {groups.map((group, i) => (
                    <span
                      key={i}
                      className={cn(
                        "flex items-center justify-center font-mono text-2xl leading-8 tracking-[0.1em] tabular text-ink",
                        i % 2 === 0 && "border-r border-line-soft",
                        i % 4 !== 3 && "sm:border-r sm:border-line-soft",
                        i % 4 === 3 && "sm:border-r-0",
                      )}
                    >
                      {group}
                    </span>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
                  <span className="font-mono text-xs leading-4.5 tabular text-ink-50">
                    {groups.length} groups · {key.replace(/-/g, "").length} characters
                  </span>
                  <Button
                    variant="secondary"
                    leading={copied ? <Check className="size-3.5 text-green" /> : <Copy className="size-3.5" />}
                    onClick={() => copy(key)}
                    aria-label={copied ? "Copied recovery key" : "Copy recovery key"}
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            </Plate>

            <p className="text-sm leading-5 text-ink-soft">
              A backup of your data folder plus this key reopens your conversations on a new computer. Without both, they cannot be recovered; AIOS does not keep a copy.
            </p>

            <label
              htmlFor="recovery-key-saved"
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-[border-color,background-color] duration-(--duration-micro)",
                acknowledged ? "border-green bg-white shadow-[0_0_0_1px_var(--color-green)]" : "border-line bg-paper-raised hover:border-line-strong hover:bg-white",
              )}
            >
              <Checkbox id="recovery-key-saved" checked={acknowledged} onCheckedChange={(v) => onAcknowledge(v === true)} className="mt-0.5" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <Label htmlFor="recovery-key-saved" className="cursor-pointer leading-5">
                  I have saved this key somewhere safe. AIOS will not show it again.
                </Label>
                <span className="text-xs leading-4.5 text-ink-50">Required before you can continue.</span>
              </span>
            </label>

            <Limits />
          </motion.div>
        )}
      </StepBody>
      <StepFooter onBack={onBack} primary={{ label: "Continue", onClick: onContinue, disabled: !ready || !acknowledged, loading: !finished }} />
    </>
  );
}

/** MVP 8.1 threat-model limits, in plain words. Collapsed by default. */
function Limits() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-line-soft">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left text-sm text-ink-soft transition-colors duration-(--duration-micro) hover:bg-paper-raised hover:text-ink"
        aria-expanded={open}
        aria-controls="setup-limits"
        onClick={() => setOpen((v) => !v)}
      >
        What this build does not protect against
        <ChevronDown className={cn("size-4 shrink-0 text-ink-50 transition-transform duration-(--duration-panel) ease-(--ease-out)", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div id="setup-limits" className="animate-rise border-t border-line-soft px-4 pb-4 pt-3">
          <ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm leading-5 text-ink-soft marker:text-ink-50">
            <li>Software running as the same Windows user can read your data. AIOS cannot stop a program you run yourself.</li>
            <li>A lost or stolen device is protected only if the Windows account is locked and full-disk encryption is on.</li>
            <li>The evidence log is kept on this device with no external anchor. It shows when records change; it cannot stop them changing.</li>
          </ul>
          <p className="mt-3 text-sm leading-5 text-ink">Recommended: turn on BitLocker in Windows settings.</p>
        </div>
      )}
    </div>
  );
}
