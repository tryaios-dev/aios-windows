import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { motion } from "motion/react";
import { FileDown, X } from "lucide-react";
import { selectProject, useStore, useStoreShallow } from "@/bridge/sim/store";
import type { EvidenceEvent } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/fields";
import { EVENT_META, FILTER_GROUPS, formatSeq, type FilterGroup } from "./eventMeta";
import { useEventLookups } from "./useEventLookups";
import { EvidenceSummary } from "./EvidenceSummary";
import { EvidenceTimeline } from "./EvidenceTimeline";
import { EventDetailSheet } from "./EventDetailSheet";
import { EvidenceExportDialog } from "./EvidenceExportDialog";

interface Notice {
  text: string;
  href?: string | undefined;
  hrefLabel?: string | undefined;
}

/** Route /projects/:projectId/evidence. Keyed by project so filters and selection reset when the project changes. */
export function EvidenceView() {
  const { projectId } = useParams();
  return <ProjectEvidence key={projectId ?? "none"} projectId={projectId} />;
}

/** Timeline, filters, detail sheet and export for one project (S10, S11). */
function ProjectEvidence({ projectId }: { projectId: string | undefined }) {
  const project = useStore(selectProject(projectId));
  // Project events plus stream-level events (installs, store, restore, continuation, shutdown): MVP 4.4 lists them in the per-project view.
  const events = useStoreShallow((s) =>
    s.events.filter((e) => e.project_id === projectId || e.project_id === undefined),
  );
  const allEvents = useStore((s) => s.events);
  const stream = useStore((s) => s.stream);
  const checkpoints = useStoreShallow((s) => s.checkpoints);
  const lookups = useEventLookups();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [groups, setGroups] = useState<Set<FilterGroup>>(() => new Set());
  const [gotoText, setGotoText] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  /** A row the user opened by clicking; `open` false keeps it highlighted and lets the sheet animate out. */
  const [manual, setManual] = useState<{ seq: number; open: boolean } | null>(null);
  /** The ?seq= value whose sheet or notice the user has closed, so it does not reopen on re-render. */
  const [dismissedParam, setDismissedParam] = useState<string | null>(null);

  const newestFirst = useMemo(() => [...events].sort((a, b) => b.seq - a.seq), [events]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(FILTER_GROUPS.map((g) => [g.key, 0])) as Record<FilterGroup, number>;
    for (const e of events) c[EVENT_META[e.event_type].group] += 1;
    return c;
  }, [events]);
  const filtered = useMemo(
    () => (groups.size ? newestFirst.filter((e) => groups.has(EVENT_META[e.event_type].group)) : newestFirst),
    [newestFirst, groups],
  );
  const lastSeq = allEvents.length ? allEvents.at(-1)!.seq : 0;
  const minProjectSeq = newestFirst.length ? newestFirst.at(-1)!.seq : 0;
  const latestCheckpoint = useMemo(
    () => (checkpoints.length ? ([...checkpoints].sort((a, b) => b.seq_to - a.seq_to)[0] ?? null) : null),
    [checkpoints],
  );
  // Checkpoint markers only make sense against the unfiltered chain.
  const visibleCheckpoints = useMemo(
    () => (groups.size ? [] : checkpoints.filter((c) => c.seq_to >= minProjectSeq)),
    [checkpoints, groups, minProjectSeq],
  );

  /* ----- ?seq= deep link, derived during render ----- */
  const seqParam = params.get("seq");
  const paramSeq = seqParam !== null ? Number(seqParam) : null;
  const paramActive = seqParam !== null && dismissedParam !== seqParam;
  const paramInProject = paramSeq !== null && Number.isInteger(paramSeq) && events.some((e) => e.seq === paramSeq);
  const paramNotice =
    paramActive && paramSeq !== null && !paramInProject
      ? describeMissing(paramSeq, allEvents, projectId, lookups.projectName, lastSeq)
      : null;

  const detailSeq = manual ? manual.seq : paramInProject ? paramSeq : null;
  const detailEvent = detailSeq === null ? null : (events.find((e) => e.seq === detailSeq) ?? null);
  const sheetOpen = manual ? manual.open : paramActive && paramInProject;
  const highlightSeq = detailSeq;
  const shownNotice = notice ?? paramNotice;

  // Bring the deep-linked row into view once it is on screen. The DOM is the external system here.
  useEffect(() => {
    if (!paramActive || !paramInProject || paramSeq === null) return;
    const el = document.getElementById(`ev-${paramSeq}`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [paramSeq, paramActive, paramInProject]);

  const openDetail = (e: EvidenceEvent) => setManual({ seq: e.seq, open: true });

  const closeDetail = () => {
    if (manual) setManual({ ...manual, open: false });
    else setDismissedParam(seqParam);
  };

  const dismissNotice = () => {
    if (notice) setNotice(null);
    else setDismissedParam(seqParam);
  };

  const toggleGroup = (g: FilterGroup) => {
    setGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const goTo = () => {
    const raw = gotoText.trim().replace(/^#/, "");
    const n = Number(raw);
    if (!raw || !Number.isInteger(n) || n < 1) {
      setNotice({ text: "Enter a sequence number, for example 42." });
      return;
    }
    if (events.some((e) => e.seq === n)) {
      // Route through the query param so the search box and a deep link behave the same way.
      setNotice(null);
      setGotoText("");
      setGroups(new Set());
      setManual(null);
      setDismissedParam(null);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("seq", String(n));
          return next;
        },
        { replace: true },
      );
      return;
    }
    setNotice(describeMissing(n, allEvents, projectId, lookups.projectName, lastSeq));
  };

  if (!project) return null;

  const hasEvents = events.length > 0;
  const anyFilter = groups.size > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper">
      <motion.div
        className="mx-auto flex w-full max-w-[1280px] min-h-0 flex-1 flex-col px-6 pt-6 pb-6"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.2, 0.7, 0.2, 1] }}
      >
        <EvidenceSummary
          stream={stream}
          projectCount={events.length}
          totalCount={allEvents.length}
          latestCheckpoint={latestCheckpoint}
        />

        {hasEvents ? (
          <>
            {/* Toolbar: filters, go-to and export on one line, hairline beneath */}
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft pb-4">
              <div
                className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
                role="group"
                aria-label="Filter by event type"
              >
                {FILTER_GROUPS.map((g) => (
                  <FilterChip
                    key={g.key}
                    label={g.label}
                    count={counts[g.key]}
                    active={groups.has(g.key)}
                    onToggle={() => toggleGroup(g.key)}
                  />
                ))}
                {anyFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    leading={<X className="size-3" aria-hidden />}
                    onClick={() => setGroups(new Set())}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <form
                  className="flex items-center"
                  onSubmit={(e) => {
                    e.preventDefault();
                    goTo();
                  }}
                >
                  <label htmlFor="evidence-goto" className="sr-only">
                    Go to sequence number
                  </label>
                  <Input
                    id="evidence-goto"
                    mono
                    inputMode="numeric"
                    autoComplete="off"
                    value={gotoText}
                    onChange={(e) => {
                      setGotoText(e.target.value);
                      if (notice) setNotice(null);
                    }}
                    placeholder="Go to #seq"
                    className="h-8 w-32 text-xs"
                  />
                </form>
                <Button
                  variant="primary"
                  size="sm"
                  leading={<FileDown className="size-3.5" aria-hidden />}
                  onClick={() => setExportOpen(true)}
                >
                  Export evidence
                </Button>
              </div>
            </div>

            {/* Status line */}
            <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
              <span className="label-mono tabular">
                {anyFilter ? `${filtered.length} of ${events.length}` : events.length}{" "}
                {events.length === 1 && !anyFilter ? "event" : "events"} · newest first
              </span>
              {shownNotice && (
                <span className="flex items-center gap-2 text-xs text-ink-soft" role="status">
                  <span>{shownNotice.text}</span>
                  {shownNotice.href && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-xs"
                      onClick={() => navigate(shownNotice.href!)}
                    >
                      {shownNotice.hrefLabel ?? "Open"}
                    </Button>
                  )}
                  <IconButton label="Dismiss" size="sm" className="-my-1" onClick={dismissNotice}>
                    <X />
                  </IconButton>
                </span>
              )}
            </div>

            <EvidenceTimeline
              events={filtered}
              checkpoints={visibleCheckpoints}
              lookups={lookups}
              highlightSeq={highlightSeq}
              onSelect={openDetail}
              filtered={anyFilter}
              onClearFilters={() => setGroups(new Set())}
            />
          </>
        ) : (
          <section
            className="mt-6 flex flex-1 flex-col items-center justify-center rounded-lg border border-line bg-white px-6 py-16 text-center shadow-card"
            aria-labelledby="evidence-empty-title"
          >
            <h2 id="evidence-empty-title" className="font-display text-3xl text-ink">
              No events yet
            </h2>
            <p className="mt-4 max-w-md text-base leading-6 text-ink-soft">
              The first request, export or class change in this project will appear here.
              <br />
              Each entry is a commitment to what was sent and received, never the content itself.
            </p>
            <p className="label-mono mt-6 text-brass-text">Self-custodied Local · no anchor</p>
            <Button
              variant="secondary"
              className="mt-8"
              leading={<FileDown className="size-4" aria-hidden />}
              onClick={() => setExportOpen(true)}
            >
              Export evidence
            </Button>
          </section>
        )}
      </motion.div>

      <EventDetailSheet
        event={detailEvent}
        open={sheetOpen && detailEvent !== null}
        onOpenChange={(o) => !o && closeDetail()}
        lookups={lookups}
      />
      <EvidenceExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        project={project}
        projectEvents={newestFirst}
      />
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onToggle,
}: {
  label: string;
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={count === 0 && !active}
      onClick={onToggle}
      className={cn(
        "inline-flex h-7 select-none items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-colors duration-(--duration-micro) ease-(--ease-out) disabled:cursor-not-allowed disabled:opacity-40",
        active ? "bg-green-tint text-green-dark" : "text-ink-soft hover:bg-ink-6 hover:text-ink",
      )}
    >
      {label}
      <span className={cn("font-mono text-2xs tabular", active ? "text-green-dark/70" : "text-ink-50")}>{count}</span>
    </button>
  );
}

/** Explains why a requested sequence number is not in this project's view. */
function describeMissing(
  n: number,
  allEvents: EvidenceEvent[],
  projectId: string | undefined,
  projectName: (id: string) => string | undefined,
  lastSeq: number,
): Notice {
  if (!Number.isInteger(n) || n < 1) return { text: "Enter a sequence number, for example 42." };
  const elsewhere = allEvents.find((e) => e.seq === n);
  if (!elsewhere)
    return {
      text: lastSeq
        ? `No event ${formatSeq(n)} in this stream. The latest is ${formatSeq(lastSeq)}.`
        : `No event ${formatSeq(n)} in this stream yet.`,
    };
  if (elsewhere.project_id && elsewhere.project_id !== projectId) {
    const name = projectName(elsewhere.project_id);
    return name
      ? {
          text: `${formatSeq(n)} belongs to "${name}".`,
          href: `/projects/${elsewhere.project_id}/evidence?seq=${n}`,
          hrefLabel: "Open there",
        }
      : { text: `${formatSeq(n)} belongs to a project that has been removed from this device.` };
  }
  return {
    text: `${formatSeq(n)} is a ${EVENT_META[elsewhere.event_type].label.toLowerCase()} event outside any project. Export a date range to include it.`,
  };
}
