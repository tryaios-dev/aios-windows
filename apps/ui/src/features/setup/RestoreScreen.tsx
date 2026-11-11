import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, FolderOpen, KeyRound } from "lucide-react";
import type { BackupFolder } from "@aios/bridge-contract";
import { api } from "@/bridge/api";
import { useStore } from "@/bridge/sim/store";
import { ZERO_HASH } from "@/lib/hash";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/fields";
import { Callout } from "@/components/ui/feedback";
import { ConfirmDialog } from "@/components/ui/overlays";
import { Hash, KeyValue, Mono, SectionLabel } from "@/components/ui/layout";
import { DrawnCheck, Plate, Sequence, SetupFrame, StepBody, StepHeading } from "./SetupFrame";

/**
 * Restore from a backup (MVP 4.5; tickets K-03, E-04). Renders without the
 * app shell. In the desktop app the folder comes from the system dialog and the restore runs
 * in the backend; in a plain browser the picker offers two sample folders.
 */

const FOLDERS = [
  {
    value: "C:\\Users\\pilot\\Backups\\AIOS 2026-10-20",
    description: "recovery.pkg present · 412 MB",
    hasPackage: true,
  },
  { value: "C:\\Users\\pilot\\Backups\\AIOS old copy 2026-09-02", description: "no recovery.pkg", hasPackage: false },
];

const STEPS = [
  "Derive the key with Argon2id",
  "Verify the Recovery Package tag",
  "Unwrap the keys and open the store",
  "Verify the evidence chain reaches the recorded tip",
  "Write a continuation event under a new epoch",
];

/** Cumulative moments (ms) at which the first four steps tick while the store works. */
const MARKS = [900, 2300, 3100, 3600];
const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1];

/** Uppercase, letters and digits only, a hyphen after every four characters. */
function formatKey(raw: string, KEY_LENGTH: number): string {
  const clean = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, KEY_LENGTH);
  return clean.match(/.{1,4}/g)?.join("-") ?? "";
}

type Phase = "idle" | "running" | "failed" | "done";

export function RestoreScreen() {
  const navigate = useNavigate();
  const stream = useStore((s) => s.stream);
  const KEY_LENGTH = api.backup.keyLength();
  const GROUPS = KEY_LENGTH / 4;
  const pickFolder = api.backup.canChooseFolder();
  const [folder, setFolder] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<BackupFolder | null>(null);
  const [key, setKey] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState(0);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState<number | null>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const clearTimers = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const keyLength = key.replace(/-/g, "").length;
  const keyComplete = keyLength === KEY_LENGTH;
  const running = phase === "running";
  const finished = phase === "done";
  const canSubmit = !!folder && keyComplete && !running && !finished;

  const resetOutcome = () => {
    if (phase === "failed") {
      setPhase("idle");
      setFailedAt(null);
      setDone(0);
      setError(null);
    }
  };

  const [confirmOpen, setConfirmOpen] = useState(false);
  const chosen = picked
    ? {
        hasPackage: picked.has_recovery_package && picked.has_database,
        description: [
          picked.has_recovery_package ? "recovery.pkg present" : "no recovery.pkg",
          picked.has_database ? "chats.db present" : "no chats.db",
        ].join(" · "),
      }
    : FOLDERS.find((f) => f.value === folder);
  const choose = async () => {
    const result = await api.backup.chooseFolder();
    if (!result) return;
    setPicked(result);
    setFolder(result.path);
    resetOutcome();
  };
  const hasInstallation = useStore((s) => s.ui.firstRunComplete);
  /** Opened from Settings > Data on a finished installation: the way out is back to Settings. */
  const leave = () => navigate(hasInstallation ? "/settings/data" : "/setup");
  const currentEpoch = useStore((s) => s.stream.epoch);

  const submit = async () => {
    if (!canSubmit || !folder) return;
    const target = chosen;
    clearTimers();
    setPhase("running");
    setDone(0);
    setFailedAt(null);
    setError(null);
    MARKS.forEach((ms, i) => timers.current.push(setTimeout(() => setDone(i + 1), ms)));
    const result = await api.restore({
      backup_path: folder,
      recovery_key: key,
      has_package: target?.hasPackage ?? false, // used by the browser simulation only
    });
    clearTimers();
    if (result.ok) {
      setDone(STEPS.length);
      setEpoch(result.epoch);
      setPhase("done");
    } else {
      // Both failures the store knows about stop at the package check.
      setDone(1);
      setFailedAt(1);
      setError(result.error);
      setPhase("failed");
    }
  };

  const errorText = error
    ? error.toLowerCase().includes("nothing was changed")
      ? error
      : `${error} Nothing was changed.`
    : null;

  return (
    <SetupFrame eyebrow="Restore">
      <StepBody className="lg:pt-20">
        {!finished && (
          <Button
            type="button"
            variant="ghost"
            leading={<ArrowLeft className="size-3.5" />}
            onClick={leave}
            disabled={running}
            className="-ml-2.5 mb-6"
          >
            {hasInstallation ? "Back to settings" : "Back to setup"}
          </Button>
        )}
        <StepHeading
          title="Restore from a backup"
          lede="Point AIOS at a backup of your data folder and enter the recovery key that was shown once when that installation was set up. Nothing is written until both check out."
        />

        {!finished && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (hasInstallation) setConfirmOpen(true);
              else void submit();
            }}
          >
            <Plate className="flex flex-col gap-6">
              <Field
                label="Backup folder"
                htmlFor="backup-folder"
                hint="A copy of your AIOS data folder. It must contain recovery.pkg, written when that installation was set up."
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line-soft bg-paper-raised text-ink-soft"
                    aria-hidden
                  >
                    <FolderOpen className="size-4" strokeWidth={1.75} />
                  </span>
                  {pickFolder ? (
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Mono className="min-w-0 flex-1 truncate text-sm text-ink">{folder ?? "No folder chosen"}</Mono>
                      <Button id="backup-folder" variant="secondary" disabled={running} onClick={() => void choose()}>
                        {folder ? "Change…" : "Choose folder…"}
                      </Button>
                    </div>
                  ) : (
                    <Select
                      id="backup-folder"
                      value={folder}
                      onValueChange={(v) => {
                        setFolder(v);
                        resetOutcome();
                      }}
                      placeholder="Choose a folder"
                      disabled={running}
                      options={FOLDERS.map((f) => ({
                        value: f.value,
                        label: <span className="font-mono text-sm">{f.value}</span>,
                        description: f.description,
                      }))}
                    />
                  )}
                </div>
                {chosen && (
                  <p
                    className={cn(
                      "mt-2 pl-12 font-mono text-xs leading-4.5 tabular",
                      chosen.hasPackage ? "text-ink-50" : "text-brass-text",
                    )}
                    aria-live="polite"
                  >
                    {chosen.description}
                  </p>
                )}
              </Field>

              <div className="h-px bg-line-soft" role="separator" />

              <Field
                label="Recovery key"
                htmlFor="recovery-key"
                hint={`${GROUPS === 9 ? "Nine" : "Eight"} groups of four characters. Letters and digits only; hyphens are added as you type.`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line-soft bg-paper-raised text-ink-soft"
                    aria-hidden
                  >
                    <KeyRound className="size-4" strokeWidth={1.75} />
                  </span>
                  <div className="relative flex-1">
                    <Input
                      id="recovery-key"
                      mono
                      value={key}
                      onChange={(e) => {
                        setKey(formatKey(e.target.value, KEY_LENGTH));
                        resetOutcome();
                      }}
                      placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      disabled={running}
                      aria-invalid={phase === "failed" || undefined}
                      aria-describedby="recovery-key-count"
                      className="h-12 pr-16 text-md tracking-[0.08em]"
                    />
                    <span
                      id="recovery-key-count"
                      className={cn(
                        "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-2xs tabular",
                        keyComplete ? "text-green" : "text-ink-50",
                      )}
                    >
                      {keyLength}/{KEY_LENGTH}
                    </span>
                  </div>
                </div>
                <div className="mt-2.5 flex gap-1 pl-12" aria-hidden>
                  {Array.from({ length: GROUPS }, (_, i) => {
                    const fill = Math.max(0, Math.min(1, (keyLength - i * 4) / 4));
                    return (
                      <span key={i} className="relative h-1 flex-1 overflow-hidden rounded-[1px] bg-ink-12">
                        <span
                          className={cn(
                            "absolute inset-y-0 left-0 transition-[width,background-color] duration-(--duration-micro)",
                            phase === "failed" ? "bg-deny" : "bg-green",
                          )}
                          style={{ width: `${fill * 100}%` }}
                        />
                      </span>
                    );
                  })}
                </div>
              </Field>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-5">
                <Button type="button" variant="link" onClick={leave} disabled={running}>
                  {hasInstallation ? "Cancel and go back to settings" : "Set up a new installation instead"}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={!canSubmit}
                  loading={running}
                  trailing={running ? undefined : <ArrowRight className="size-3.5" />}
                >
                  Restore
                </Button>
              </div>
            </Plate>
          </form>
        )}

        {phase !== "idle" && (
          <motion.section
            className="mt-6"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: EASE }}
          >
            <SectionLabel right={running ? "In progress" : finished ? "Complete" : "Stopped"}>Restoring</SectionLabel>
            <Plate tone="paper" className="mt-3 py-1 sm:py-1">
              <Sequence
                label="Restore progress"
                items={STEPS.map((label) => ({ label }))}
                done={done}
                failedAt={failedAt}
              />
            </Plate>
          </motion.section>
        )}

        {phase === "failed" && errorText && (
          <Callout tone="deny" className="mt-5 animate-rise" title="Restore did not complete">
            {errorText}
          </Callout>
        )}

        {finished && (
          <motion.div
            className="mt-6 flex flex-col gap-6"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: EASE }}
          >
            <Plate tone="success" as="section" aria-labelledby="restore-complete">
              <div className="flex items-start gap-4">
                <span
                  className="mt-px flex size-7 shrink-0 items-center justify-center rounded-full bg-green text-white"
                  aria-hidden
                >
                  <DrawnCheck className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h2 id="restore-complete" className="text-lg font-semibold text-ink">
                      Restore complete
                    </h2>
                    {epoch !== null && <Mono className="tabular text-ink">epoch {epoch}</Mono>}
                  </div>
                  <p className="mt-2 text-sm leading-5 text-ink-soft">
                    {epoch !== null
                      ? `This installation now writes epoch ${epoch} with a new signing key; a signed continuation event references the restored tip.`
                      : "The backup is open on this installation and a continuation event is queued for the evidence log."}{" "}
                    If the original device keeps writing to its own copy, the stream has two branches from that tip. The
                    verifier reports both branches and never merges them.
                  </p>
                </div>
              </div>
            </Plate>
            <section>
              <SectionLabel right={`Epoch ${stream.epoch}`}>Evidence stream</SectionLabel>
              <Plate tone="paper" className="mt-3 py-1 sm:py-1">
                <KeyValue
                  dense
                  rows={[
                    { k: "Stream", v: <Hash value={stream.stream_id} /> },
                    { k: "Restored tip", v: <Hash value={stream.prior_tip_hash ?? ZERO_HASH} /> },
                    { k: "New signing key", v: <Hash value={stream.signer_key_id} /> },
                    { k: "Backup", v: <Mono className="break-all text-ink">{folder}</Mono> },
                  ]}
                />
              </Plate>
            </section>
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="lg"
                trailing={<ArrowRight className="size-3.5" />}
                onClick={() => navigate("/")}
              >
                Open AIOS
              </Button>
            </div>
          </motion.div>
        )}
      </StepBody>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        eyebrow="Replaces this installation"
        title="Restore over the current installation?"
        description={`This installation's store (epoch ${currentEpoch}) is replaced by the backup. Conversations created here since that backup are lost. The evidence stream continues under a new epoch with a continuation event.`}
        confirmLabel="Replace and restore"
        confirmVariant="destructive"
        onConfirm={() => {
          setConfirmOpen(false);
          void submit();
        }}
      />
    </SetupFrame>
  );
}
