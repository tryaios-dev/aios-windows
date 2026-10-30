import type * as React from "react";
import { motion } from "motion/react";
import { formatDate } from "@/lib/format";
import { EASE } from "@/lib/motion";
import { Callout } from "@/components/ui/feedback";
import { KeyValue, Mono, SectionLabel } from "@/components/ui/layout";
import { catalogueEntry } from "../catalogue";
import { DrawnCheck, Plate, StepBody, StepFooter, StepHeading } from "../SetupFrame";
import { useSequence } from "../useSequence";

export function VerifiedStep({ eyebrow, entryId, onBack, onContinue }: { eyebrow: string; entryId: string; onBack: () => void; onContinue: () => void }) {
  const entry = catalogueEntry(entryId);
  const { done, finished } = useSequence([720, 820]);

  if (!entry) {
    return (
      <>
        <StepBody>
          <StepHeading eyebrow={eyebrow} title="Verified" />
          <Callout tone="caution" title="Nothing to verify">
            The installed model is not in the current catalogue, so its record cannot be checked here. Continue; Models lists what is installed.
          </Callout>
        </StepBody>
        <StepFooter onBack={onBack} primary={{ label: "Continue", onClick: onContinue }} />
      </>
    );
  }

  const own = entry.pipeline === "own";
  const provenance = own ? "own quantisation pipeline" : "third-party artefact, deviation approved";

  return (
    <>
      <StepBody>
        <StepHeading
          eyebrow={eyebrow}
          title="Verified"
          lede={`${entry.name} was checked against the signed catalogue before anything can load it. Both checks must pass; a mismatch would have stopped the install.`}
        />

        <ol className="flex flex-col gap-3" role="status" aria-live="polite" aria-label="Verification checks">
          <CheckRow index={0} done={done} title="SHA-256 digest matches the signed catalogue" caption="Digest">
            <span className="break-all font-mono text-xs leading-4.5 tracking-[0.02em] text-ink">{entry.artifact_digest}</span>
          </CheckRow>
          <CheckRow index={1} done={done} title="Provenance record complete" caption="Record">
            <span className="font-mono text-xs leading-4.5 text-ink">
              {provenance} · {entry.licence}
              <span className="text-ink-50">
                {" "}
                · {entry.publisher} · {entry.conversion_tool} {entry.conversion_version}
              </span>
            </span>
          </CheckRow>
        </ol>

        {finished && (
          <motion.div className="mt-6 flex flex-col gap-6" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE }}>
            {!own && entry.deviation_approval && (
              <Callout tone="caution" title="Third-party quantisation with a recorded deviation approval">
                Approved by {entry.deviation_approval.reviewer} on {formatDate(entry.deviation_approval.date)}. {entry.deviation_approval.quality_threshold_result}.
              </Callout>
            )}
            <section>
              <SectionLabel right="Catalogue entry">
                <span className="normal-case tracking-normal">{entry.entry_id}</span>
              </SectionLabel>
              <Plate tone="paper" className="mt-3 py-1 sm:py-1">
                <KeyValue
                  dense
                  rows={[
                    { k: "Upstream model", v: <Mono className="text-ink">{entry.upstream_model}</Mono> },
                    { k: "Revision", v: <Mono className="text-ink">{entry.upstream_revision}</Mono> },
                    { k: "Quantisation", v: <Mono className="text-ink">{entry.quantisation_method}</Mono> },
                    {
                      k: "Converted with",
                      v: (
                        <Mono className="text-ink">
                          {entry.conversion_tool} · {entry.conversion_version}
                        </Mono>
                      ),
                    },
                    { k: "Publisher", v: entry.publisher },
                    {
                      k: "Licence",
                      v: (
                        <>
                          {entry.licence} <Mono>· {entry.licence_reference}</Mono>
                        </>
                      ),
                    },
                    { k: "Context", v: <Mono className="text-ink">{entry.context_length.toLocaleString("en-GB")} tokens</Mono> },
                    { k: "Installed to", v: <Mono className="break-all text-ink">{`%LOCALAPPDATA%\\AIOS\\models\\${entry.file_name}`}</Mono> },
                  ]}
                />
              </Plate>
            </section>
            <p className="text-xs leading-4.5 text-ink-50">
              The install is recorded in the evidence log as a model_installed event carrying this digest. The log holds the digest, never the file.
            </p>
          </motion.div>
        )}
      </StepBody>
      <StepFooter onBack={onBack} primary={{ label: "Continue", onClick: onContinue, disabled: !finished, loading: !finished }} />
    </>
  );
}

/** One large verification row: a 28px mark that fills and draws when its check passes. */
function CheckRow({ index, done, title, caption, children }: { index: number; done: number; title: string; caption: string; children: React.ReactNode }) {
  const state = index < done ? "done" : index === done ? "current" : "todo";
  return (
    <motion.li initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE, delay: index * 0.04 }}>
      <Plate className={state === "todo" ? "opacity-60" : undefined}>
        <div className="flex items-start gap-4">
          <span
            className={`mt-px flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-(--duration-micro) ${
              state === "done" ? "border-green bg-green text-white" : state === "current" ? "border-green/40 bg-white" : "border-line bg-paper-raised"
            }`}
            aria-hidden
          >
            {state === "done" && <DrawnCheck className="size-3.5" strokeWidth={2.5} />}
            {state === "current" && <span className="size-2 animate-pulse rounded-full bg-green" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className={`text-base font-medium leading-6 ${state === "done" ? "text-ink" : "text-ink-soft"}`}>
              {title}
              <span className="sr-only">{state === "done" ? " (passed)" : state === "current" ? " (checking)" : " (waiting)"}</span>
            </div>
            {state === "done" ? (
              <motion.div className="mt-3 border-t border-line-soft pt-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                <div className="label-mono mb-1.5">{caption}</div>
                {children}
              </motion.div>
            ) : (
              <div className="mt-1 text-sm leading-5 text-ink-50">{state === "current" ? "Checking" : "Waiting"}</div>
            )}
          </div>
        </div>
      </Plate>
    </motion.li>
  );
}
