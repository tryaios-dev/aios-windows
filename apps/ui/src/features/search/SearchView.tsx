import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Archive, ArrowUpRight, MessageSquare, Search, X } from "lucide-react";
import { useSearch } from "@/bridge/useSearch";
import { useStore } from "@/bridge/sim/store";
import type { Conversation, MessageRole, Project, SearchHit } from "@/lib/types";
import { cn } from "@/lib/cn";
import { formatDateTime, pluralise, relativeTime } from "@/lib/format";
import { Button, IconButton } from "@/components/ui/button";
import { Badge, ClassChip } from "@/components/ui/chips";
import { Input, Label, Select, Switch } from "@/components/ui/fields";
import { EmptyState } from "@/components/ui/feedback";
import { PageBody, PageHeader, SectionLabel } from "@/components/ui/layout";
import { Highlight, RoleLabel } from "./highlight";
import { useDebounced } from "./useDebounced";

const MIN_QUERY = 2;
/** The store caps results at this many hits (most recent first). */
const HIT_CAP = 60;

type TypeFilter = "all" | MessageRole;

interface ConversationGroup {
  conversation?: Conversation | undefined;
  conversationId: string;
  hits: SearchHit[];
}

interface ProjectGroup {
  project?: Project | undefined;
  projectId: string;
  count: number;
  conversations: ConversationGroup[];
}

/** /search?q= — full-text search across every conversation, grouped by project and conversation. */
export function SearchView() {
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const navigate = useNavigate();

  // The input owns the text; the URL follows it (replace) and feeds it back when changed from elsewhere.
  const [draft, setDraft] = useState(urlQuery);
  const lastWritten = useRef(urlQuery);
  useEffect(() => {
    if (urlQuery !== lastWritten.current) {
      lastWritten.current = urlQuery;
      setDraft(urlQuery);
    }
  }, [urlQuery]);

  const setQuery = (value: string) => {
    setDraft(value);
    lastWritten.current = value;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set("q", value);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  };

  const debounced = useDebounced(draft.trim(), 120);
  const pending = draft.trim() !== debounced;

  const [projectFilter, setProjectFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [includeArchived, setIncludeArchived] = useState(true);

  /* ---------------- data ---------------- */

  const projects = useStore((s) => s.projects);
  const conversations = useStore((s) => s.conversations);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const conversationById = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations]);

  const hits = useSearch(debounced.length < MIN_QUERY ? "" : debounced);

  const filtered = useMemo(
    () =>
      hits.filter((h) => {
        if (projectFilter !== "all" && h.project_id !== projectFilter) return false;
        if (typeFilter !== "all" && h.role !== typeFilter) return false;
        if (
          !includeArchived &&
          (conversationById.get(h.conversation_id)?.archived || projectById.get(h.project_id)?.archived)
        )
          return false;
        return true;
      }),
    [hits, projectFilter, typeFilter, includeArchived, conversationById, projectById],
  );

  const groups = useMemo<ProjectGroup[]>(() => {
    const byProject = new Map<string, ProjectGroup>();
    for (const h of filtered) {
      let pg = byProject.get(h.project_id);
      if (!pg) {
        pg = { project: projectById.get(h.project_id), projectId: h.project_id, count: 0, conversations: [] };
        byProject.set(h.project_id, pg);
      }
      pg.count++;
      let cg = pg.conversations.find((c) => c.conversationId === h.conversation_id);
      if (!cg) {
        cg = { conversation: conversationById.get(h.conversation_id), conversationId: h.conversation_id, hits: [] };
        pg.conversations.push(cg);
      }
      cg.hits.push(h);
    }
    return [...byProject.values()];
  }, [filtered, projectById, conversationById]);

  const conversationCount = useMemo(() => groups.reduce((n, g) => n + g.conversations.length, 0), [groups]);
  const hidden = hits.length - filtered.length;
  const filtersActive = projectFilter !== "all" || typeFilter !== "all" || !includeArchived;

  const clearFilters = () => {
    setProjectFilter("all");
    setTypeFilter("all");
    setIncludeArchived(true);
  };

  const projectOptions = useMemo(
    () => [
      { value: "all", label: "All projects" },
      ...projects.map((p) => ({ value: p.id, label: p.archived ? `${p.name} (archived)` : p.name })),
    ],
    [projects],
  );

  /* ---------------- render ---------------- */

  let body: React.ReactNode;
  if (!debounced) {
    body = (
      <EmptyState
        icon={<Search />}
        title="Search your conversations"
        description="Type a word or phrase to find it inside every message in every project. Results open at the exact message, and nothing is sent anywhere."
      />
    );
  } else if (debounced.length < MIN_QUERY) {
    body = <EmptyState compact title="Keep typing" description={`Search needs at least ${MIN_QUERY} characters.`} />;
  } else if (hits.length === 0 && !pending) {
    body = (
      <EmptyState
        icon={<Search />}
        title={`No messages match '${debounced}'`}
        description="Try fewer words, or a different spelling. Search looks for the exact phrase inside every message, in every project."
      />
    );
  } else if (filtered.length === 0 && !pending) {
    body = (
      <EmptyState
        compact
        title="No matches with these filters"
        description={`${pluralise(hits.length, "match", "matches")} ${hits.length === 1 ? "is" : "are"} hidden by the project, type or archived filter.`}
        action={
          <Button size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        }
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <p className="label-mono tabular" aria-live="polite">
            {pluralise(filtered.length, "match", "matches")} in {pluralise(conversationCount, "conversation")}
            {hidden > 0 && <span className="text-ink-50"> · {hidden} hidden by filters</span>}
          </p>
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>

        {groups.map((g, gi) => (
          <section
            key={g.projectId}
            className="animate-rise"
            style={{ animationDelay: `${Math.min(gi, 8) * 20}ms` }}
            aria-labelledby={`search-project-${g.projectId}`}
          >
            <SectionLabel right={pluralise(g.count, "match", "matches")}>
              <span id={`search-project-${g.projectId}`} className="flex items-center gap-2">
                <span className="truncate">{g.project?.name ?? "Project removed"}</span>
                {g.project && (
                  <ClassChip
                    value={g.project.classification}
                    size="xs"
                    className="font-sans normal-case tracking-normal"
                  />
                )}
                {g.project?.archived && <span className="text-ink-50">archived</span>}
              </span>
            </SectionLabel>

            <div className="mt-2 flex flex-col gap-2">
              {g.conversations.map((cg) => (
                <ConversationBlock
                  key={cg.conversationId}
                  group={cg}
                  query={debounced}
                  onOpenConversation={() => navigate(`/projects/${g.projectId}/c/${cg.conversationId}`)}
                  onOpenHit={(h) => navigate(`/projects/${h.project_id}/c/${h.conversation_id}?m=${h.message_id}`)}
                />
              ))}
            </div>
          </section>
        ))}

        {hits.length >= HIT_CAP && (
          <p className="text-xs leading-4.5 text-ink-50">
            Showing the {HIT_CAP} most recent matches. Add a word to narrow the search.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Search"
        description="Full-text search across all conversations in all projects, inside the encrypted store."
      >
        <div className="flex flex-col gap-3 pb-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-50"
              aria-hidden
            />
            <Input
              id="search-query"
              type="text"
              autoFocus
              value={draft}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search every message"
              aria-label="Search every message"
              autoComplete="off"
              spellCheck={false}
              className="h-11 pl-10 pr-10 text-md"
            />
            {draft && (
              <IconButton
                label="Clear search"
                size="sm"
                className="absolute right-1.5 top-1/2 -translate-y-1/2"
                onClick={() => setQuery("")}
              >
                <X />
              </IconButton>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              size="sm"
              className="w-56"
              aria-label="Project"
              value={projectFilter}
              onValueChange={setProjectFilter}
              options={projectOptions}
            />
            <Select
              size="sm"
              className="w-40"
              aria-label="Type"
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(v as TypeFilter)}
              options={[
                { value: "all", label: "Everything" },
                { value: "user", label: "Your messages" },
                { value: "assistant", label: "Answers" },
              ]}
            />
            <div className="ml-auto flex items-center gap-2">
              <Switch id="search-include-archived" checked={includeArchived} onCheckedChange={setIncludeArchived} />
              <Label htmlFor="search-include-archived" className="cursor-pointer text-sm font-normal text-ink-soft">
                Include archived
              </Label>
            </div>
          </div>
        </div>
      </PageHeader>
      <PageBody>{body}</PageBody>
    </div>
  );
}

function ConversationBlock({
  group,
  query,
  onOpenConversation,
  onOpenHit,
}: {
  group: ConversationGroup;
  query: string;
  onOpenConversation: () => void;
  onOpenHit: (h: SearchHit) => void;
}) {
  const c = group.conversation;
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-paper-raised">
      <button
        type="button"
        onClick={onOpenConversation}
        className={cn(
          "group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-(--duration-micro) hover:bg-ink-6",
          c?.archived && "text-ink-soft",
        )}
        aria-label={`Open conversation ${c?.title ?? ""}`.trim()}
      >
        <MessageSquare className="size-3.5 shrink-0 text-ink-50" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {c?.title ?? "Conversation removed"}
        </span>
        {c?.archived && (
          <Badge tone="neutral" icon={<Archive />}>
            Archived
          </Badge>
        )}
        <span className="font-mono text-2xs tabular text-ink-50">
          {pluralise(group.hits.length, "match", "matches")}
        </span>
        <ArrowUpRight
          className="size-3.5 shrink-0 text-ink-50 opacity-0 transition-opacity duration-(--duration-micro) group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden
        />
      </button>
      <ul className="divide-y divide-line-soft border-t border-line-soft bg-white">
        {group.hits.map((h) => (
          <li key={h.message_id}>
            <button
              type="button"
              onClick={() => onOpenHit(h)}
              className="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors duration-(--duration-micro) hover:bg-ink-6"
              aria-label={`Open ${h.role === "user" ? "your message" : "the answer"} from ${formatDateTime(h.created_at)}`}
            >
              <RoleLabel role={h.role} className="mt-0.5 w-12 justify-center" />
              <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-5 text-ink-soft">
                <Highlight text={h.snippet} query={query} />
              </span>
              <time
                dateTime={h.created_at}
                title={formatDateTime(h.created_at)}
                className="mt-0.5 w-14 shrink-0 text-right font-mono text-2xs tabular text-ink-50"
              >
                {relativeTime(h.created_at)}
              </time>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
