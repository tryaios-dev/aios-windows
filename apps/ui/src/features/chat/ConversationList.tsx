import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Archive, ArchiveRestore, ChevronDown, MessageSquarePlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { api } from "@/bridge/api";
import { useStore, useStoreShallow } from "@/bridge/sim/store";
import type { Conversation, Project } from "@/lib/types";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { Button, IconButton } from "@/components/ui/button";
import { ProviderBadge, StatusDot } from "@/components/ui/chips";
import { EmptyState } from "@/components/ui/feedback";
import { ConfirmDialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";
import { RenameDialog } from "@/components/app/RenameDialog";

export function ConversationList({
  project,
  activeId,
  full,
}: {
  project: Project;
  activeId?: string | undefined;
  full?: boolean | undefined;
}) {
  const conversations = useStoreShallow((s) => s.conversations.filter((c) => c.project_id === project.id));
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);

  const active = useMemo(
    () => conversations.filter((c) => !c.archived).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [conversations],
  );
  const archived = useMemo(
    () => conversations.filter((c) => c.archived).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [conversations],
  );

  const newConversation = async () => {
    const conv = await api.conversations.create(project.id);
    if (conv) navigate(`/projects/${project.id}/c/${conv.id}`);
  };

  return (
    <section
      className={cn("flex h-full shrink-0 flex-col bg-paper", full ? "w-full" : "w-[300px] border-r border-line-soft")}
      aria-label="Conversations"
    >
      <div className="flex h-10 items-center justify-between pl-4 pr-2">
        <span className="label-mono">Conversations</span>
        {!project.archived && (
          <IconButton label="New conversation" size="sm" onClick={newConversation}>
            <MessageSquarePlus />
          </IconButton>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {active.length === 0 && archived.length === 0 ? (
          <EmptyState
            compact
            title="No conversations yet"
            description={
              project.archived
                ? "Restore the project to start one."
                : "Start one and it will appear here with the project’s class recorded on it."
            }
            action={
              !project.archived && (
                <Button size="sm" variant="primary" onClick={newConversation}>
                  Start a conversation
                </Button>
              )
            }
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {active.map((c) => (
              <ConversationRow key={c.id} conversation={c} active={c.id === activeId} projectId={project.id} />
            ))}
          </ul>
        )}
        {archived.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs text-ink-50 hover:bg-ink-6 hover:text-ink"
              aria-expanded={showArchived}
            >
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-(--duration-micro)",
                  !showArchived && "-rotate-90",
                )}
              />
              <span className="label-mono">Archived</span>
              <span className="ml-auto font-mono text-2xs text-ink-50">{archived.length}</span>
            </button>
            {showArchived && (
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {archived.map((c) => (
                  <ConversationRow key={c.id} conversation={c} active={c.id === activeId} projectId={project.id} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ConversationRow({
  conversation: c,
  active,
  projectId,
}: {
  conversation: Conversation;
  active: boolean;
  projectId: string;
}) {
  const navigate = useNavigate();
  const [rename, setRename] = useState(false);
  const [del, setDel] = useState(false);
  const generating = useStore((s) => s.generation?.conversation_id === c.id);
  const modelName = useStore((s) =>
    c.current_provider === "company"
      ? s.health.company.model_name
      : (s.installedModels.find((m) => m.id === c.model_id)?.name ?? "no model"),
  );

  return (
    <li className="group relative">
      <button
        onClick={() => navigate(`/projects/${projectId}/c/${c.id}`)}
        className={cn(
          "flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors duration-(--duration-micro)",
          active ? "bg-white shadow-[0_1px_0_rgba(22,33,27,0.05)] ring-1 ring-line" : "hover:bg-ink-6",
          c.archived && "opacity-70",
        )}
        aria-current={active ? "true" : undefined}
      >
        <span className="flex items-center justify-between gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", active ? "font-medium text-ink" : "text-ink")}>
            {c.title}
          </span>
          <span className="shrink-0 font-mono text-2xs text-ink-50 group-hover:opacity-0">
            {generating ? <StatusDot tone="green" pulse label="Generating" /> : relativeTime(c.updated_at)}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <ProviderBadge provider={c.current_provider} model={modelName} muted={!active} />
        </span>
        {c.last_message_preview && (
          <span className="line-clamp-1 text-xs leading-4 text-ink-50">{c.last_message_preview}</span>
        )}
      </button>
      <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Menu>
          <MenuTrigger asChild>
            <IconButton label={`Actions for ${c.title}`} size="sm" className="bg-white">
              <MoreHorizontal />
            </IconButton>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Pencil />} onSelect={() => setRename(true)}>
              Rename
            </MenuItem>
            {c.archived ? (
              <MenuItem icon={<ArchiveRestore />} onSelect={() => api.conversations.archive(c.id, false)}>
                Restore
              </MenuItem>
            ) : (
              <MenuItem icon={<Archive />} onSelect={() => api.conversations.archive(c.id, true)}>
                Archive
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} destructive onSelect={() => setDel(true)}>
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <RenameDialog
        open={rename}
        onOpenChange={setRename}
        title="Rename conversation"
        label="Title"
        initial={c.title}
        onSubmit={(t) => api.conversations.rename(c.id, t)}
      />
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={`Delete "${c.title}"?`}
        description="The conversation and its summaries are removed from this device. A deletion event is recorded in the evidence log; it never stores content."
        confirmLabel="Delete conversation"
        confirmVariant="destructive"
        onConfirm={() => {
          api.conversations.remove(c.id);
          setDel(false);
          if (active) navigate(`/projects/${projectId}`);
        }}
      />
    </li>
  );
}
