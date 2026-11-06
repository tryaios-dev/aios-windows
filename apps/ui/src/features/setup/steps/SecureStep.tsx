import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { api } from "@/bridge/api";
import { useStore } from "@/bridge/sim/store";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Checkbox, Label } from "@/components/ui/fields";
import { Callout } from "@/components/ui/feedback";
import { SectionLabel, useCopy } from "@/components/ui/layout";
import { Plate, Sequence, StepBody, StepFooter, StepHeading } from "../SetupFrame";
import { useSequence } from "../useSequence";
import { platform } from "@/lib/platform";

const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1];

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
  const key = useStore((s) => s.recoveryKey);
  const issued = useRef(false);
  const { done, finished } = useSequence([640, 720, 620], prepared);
  const { copied, copy } = useCopy();
  const [issue, setIssue] = useState<{ error: string; alreadyIssued: boolean } | null>(null);

  // The key is issued exactly once for this installation (in the desktop app, the backend
  // creates the store and returns it once). The store keeps it, so Back and forth within the
  // wizard never issues a second one.
  const requestKey = () => {
    issued.current = true;
    setIssue(null);
    void api.firstRun.issueRecoveryKey().then((r) => {
      if (!r.ok) setIssue({ error: r.error, alreadyIssued: r.alreadyIssued });
    });
  };
  useEffect(() => {
    if (!key && !issued.current) requestKey();
  }, [key]);

  useEffect(() => {
    if (finished && !prepared) onPrepared();
  }, [finished, prepared, onPrepared]);

  const ready = finished && !!key;
  // A store made earlier in this setup (for example before a reload) already showed its key.
  const alreadyIssued = finished && !key && !!issue?.alreadyIssued;
  const groups = key ? key.split("-") : [];

  return (
    <>
      <StepBody>
        <StepHeading
          eyebrow={eyebrow}
          title="Secure your data"
          lede={`Your conversations live in an encrypted database on this device. The keys stay in ${platform.keyStore}; a recovery key lets you reopen a backup on another computer.`}
        />

        <SectionLabel right={finished ? "Done" : "In progress"}>Preparing the store</SectionLabel>
        <Plate tone="paper" className="mt-3 py-1 sm:py-1">
          <Sequence
            label="Store preparation"
            done={done}
            items={[
              { label: "Generate the database key", detail: "chats.db · SQLCipher" },
              { label: `Store keys in ${platform.keyStore}`, detail: `Bound to this ${platform.account}` },
              { label: "Write Recovery Package v1", detail: platform.folders.recoveryPackage },
            ]}
          />
        </Plate>

        {finished && issue && (
          <Callout
            tone={issue.alreadyIssued ? "caution" : "deny"}
            className="mt-6 animate-rise"
            title={issue.alreadyIssued ? "Recovery key already shown" : "The store could not be created"}
            action={
              issue.alreadyIssued ? undefined : (
                <Button variant="secondary" size="sm" onClick={requestKey}>
                  Try again
                </Button>
              )
            }
          >
            {issue.alreadyIssued
              ? `${issue.error} AIOS does not keep a copy, so it cannot be shown again. You can continue; without that key a backup of this installation cannot be reopened elsewhere.`
              : issue.error}
          </Callout>
        )}

        {ready && (
          <motion.div
            className="mt-6 flex flex-col gap-6"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: EASE }}
          >
            <Plate className="p-1.5 sm:p-1.5">
              <div className="rounded-[7px] border border-line-soft px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
                <SectionLabel right="Shown once">Recovery key</SectionLabel>
                <div
                  className="mt-5 grid grid-cols-2 gap-y-3 sm:grid-cols-4"
                  aria-label={`Recovery key ${key}`}
                  role="group"
                >
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
                    {groups.length} groups · {groups.join("").length} characters
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
              A backup of your data folder plus this key reopens your conversations on a new computer. Without both,
              they cannot be recovered; AIOS does not keep a copy.
            </p>

            <label
              htmlFor="recovery-key-saved"
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-[border-color,background-color] duration-(--duration-micro)",
                acknowledged
                  ? "border-green bg-white shadow-[0_0_0_1px_var(--color-green)]"
                  : "border-line bg-paper-raised hover:border-line-strong hover:bg-white",
              )}
            >
              <Checkbox
                id="recovery-key-saved"
                checked={acknowledged}
                onCheckedChange={(v) => onAcknowledge(v === true)}
                className="mt-0.5"
              />
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
      <StepFooter
        onBack={onBack}
        primary={{
          label: "Continue",
          onClick: onContinue,
          disabled: !alreadyIssued && (!ready || !acknowledged),
          loading: !finished || (!key && !issue),
        }}
      />
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
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-ink-50 transition-transform duration-(--duration-panel) ease-(--ease-out)",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div id="setup-limits" className="border-t border-line-soft px-4 pb-4 pt-3 animate-rise">
          <ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm leading-5 text-ink-soft marker:text-ink-50">
            <li>
              Software running as the same {platform.os} user can read your data. AIOS cannot stop a program you run
              yourself.
            </li>
            <li>
              A lost or stolen device is protected only if the {platform.account} is locked and full-disk encryption is
              on.
            </li>
            <li>
              The evidence log is kept on this device with no external anchor. It shows when records change; it cannot
              stop them changing.
            </li>
          </ul>
          <p className="mt-3 text-sm leading-5 text-ink">
            Recommended: turn on {platform.diskEncryption} in {platform.diskEncryptionSettings}.
          </p>
        </div>
      )}
    </div>
  );
}
