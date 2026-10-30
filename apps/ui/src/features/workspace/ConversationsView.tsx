import { Navigate, useParams } from "react-router";
import { MessageSquarePlus, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/cn";
import { BP, useMediaQuery } from "@/lib/useMediaQuery";
import { Button, IconButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { selectProject, useWorkspaceStore } from "./store";

/**
 * The Conversations tab before any conversation exists: the list column on
 * the left and the "Start your first conversation" pane on the right. The
 * chat feature replaces the right pane once it is built.
 */
export function ConversationsView() {
  const { projectId } = useParams();
  const project = useWorkspaceStore(selectProject(projectId));
  const count = useWorkspaceStore((s) => (projectId ? (s.conversationCounts[projectId] ?? 0) : 0));
  const single = useMediaQuery(BP.singleColumn);

  if (!project) return <Navigate to="/" replace />;
  const hasConversations = count > 0;

  return (
    <div className="flex min-h-0 flex-1">
      <section className={cn("flex h-full shrink-0 flex-col bg-paper", single ? "w-full" : "w-[300px] border-r border-line-soft")} aria-label="Conversations">
        <div className="flex h-10 items-center justify-between pl-4 pr-2">
          <span className="label-mono">Conversations</span>
          {!project.archived && (
            <IconButton label="New conversation" size="sm">
              <MessageSquarePlus />
            </IconButton>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {!hasConversations && (
            <EmptyState
              compact
              title="No conversations yet"
              description={project.archived ? "Restore the project to start one." : "Start one and it will appear here with the project’s class recorded on it."}
              action={
                !project.archived && (
                  <Button size="sm" variant="primary">
                    Start a conversation
                  </Button>
                )
              }
            />
          )}
        </div>
      </section>

      {!single && (
        <div className="flex min-w-0 flex-1 flex-col bg-white">
          <EmptyState
            display
            icon={<MessagesSquare />}
            title={hasConversations ? "Pick up where you left off" : "Start your first conversation"}
            description={
              hasConversations
                ? "Choose a conversation on the left, or start a new one. Everything you type stays on this device."
                : "Ask the model on this machine anything. Your messages stay on this device, and every answer is recorded in the evidence log as a commitment, never as content."
            }
            action={
              !project.archived && (
                <Button variant="primary" leading={<MessageSquarePlus className="size-4" />}>
                  New conversation
                </Button>
              )
            }
            className="flex-1"
          />
        </div>
      )}
    </div>
  );
}
