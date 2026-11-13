import { Navigate, useNavigate, useParams } from 'react-router'
import { MessageSquarePlus, MessagesSquare } from 'lucide-react'
import { api } from '@/lib/api'
import { selectConversation, selectProject, useStore } from '@/lib/store'
import { BP, useMediaQuery } from '@/lib/useMediaQuery'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { ConversationList } from './ConversationList'
import { ChatPane } from './ChatPane'

export function ConversationsView() {
  const { projectId, conversationId } = useParams()
  const project = useStore(selectProject(projectId))
  const conversation = useStore(selectConversation(conversationId))
  const navigate = useNavigate()
  const single = useMediaQuery(BP.singleColumn)
  const hasConversations = useStore((s) => s.conversations.some((c) => c.project_id === projectId))
  // Lab builds only: a project can start its new conversations on the company server.
  const startsOnCompany = useStore((s) => s.sim.companyFlag && s.sim.companyReachable) && !!project?.company_ai_enabled

  if (!project) return <Navigate to="/" replace />
  if (conversationId && (!conversation || conversation.project_id !== project.id)) return <Navigate to={`/projects/${project.id}`} replace />

  return (
    <div className="flex min-h-0 flex-1">
      {(!single || !conversation) && <ConversationList project={project} activeId={conversationId} full={single} />}
      {(!single || conversation) && (
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        {conversation ? (
          <ChatPane key={conversation.id} conversation={conversation} project={project} onBack={single ? () => navigate(`/projects/${project.id}`) : undefined} />
        ) : (
          <EmptyState
            display
            icon={<MessagesSquare />}
            title={hasConversations ? 'Pick up where you left off' : 'Start your first conversation'}
            description={project.archived ? 'This project is archived. Choose a conversation to read it.' : hasConversations ? 'Choose a conversation, or start a new one.' : startsOnCompany ? 'New conversations in this project run on the company server.' : 'Nothing leaves this computer unless you say so.'}
            action={
              !project.archived && (
                <Button
                  variant="primary"
                  leading={<MessageSquarePlus className="size-4" />}
                  onClick={() => {
                    const conv = api.conversations.create(project.id)
                    navigate(`/projects/${project.id}/c/${conv.id}`)
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
  )
}
