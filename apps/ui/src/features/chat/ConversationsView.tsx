import { Navigate, useNavigate, useParams } from "react-router";
import { MessageSquarePlus, MessagesSquare } from "lucide-react";
import { api } from "@/bridge/api";
import { selectConversation, selectProject, useStore } from "@/bridge/sim/store";
import { BP, useMediaQuery } from "@/lib/useMediaQuery";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { ConversationList } from "./ConversationList";
import { ChatPane } from "./ChatPane";

export function ConversationsView() {
  const { projectId, conversationId } = useParams();
  const project = useStore(selectProject(projectId));
  const conversation = useStore(selectConversation(conversationId));
  const navigate = useNavigate();
  const single = useMediaQuery(BP.singleColumn);
  const hasConversations = useStore((s) => s.conversations.some((c) => c.project_id === projectId));

  if (!project) return <Navigate to="/" replace />;
  if (conversationId && (!conversation || conversation.project_id !== project.id))
    return <Navigate to={`/projects/${project.id}`} replace />;

  return (
    <div className="flex min-h-0 flex-1">
      {(!single || !conversation) && <ConversationList project={project} activeId={conversationId} full={single} />}
      {(!single || conversation) && (
        <div className="flex min-w-0 flex-1 flex-col bg-white">
          {conversation ? (
            <ChatPane
              key={conversation.id}
              conversation={conversation}
              project={project}
              onBack={single ? () => navigate(`/projects/${project.id}`) : undefined}
            />
          ) : (
            <EmptyState
              display
              icon={<MessagesSquare />}
              title={hasConversations ? "Pick up where you left off" : "Start your first conversation"}
              description={
                project.archived
                  ? "This project is archived. Choose a conversation to read it."
                  : hasConversations
                    ? "Choose a conversation on the left, or start a new one. Everything you type stays on this device."
                    : "Ask the model on this machine anything. Your messages stay on this device, and every answer is recorded in the evidence log as a commitment, never as content."
              }
              action={
                !project.archived && (
                  <Button
                    variant="primary"
                    leading={<MessageSquarePlus className="size-4" />}
                    onClick={async () => {
                      const conv = await api.conversations.create(project.id);
                      if (conv) navigate(`/projects/${project.id}/c/${conv.id}`);
                    }}
                  >
                    New conversation
                  </Button>
                )
              }
              className="flex-1"
            />
          )}
        </div>
      )}
    </div>
  );
}
