import { Puzzle } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/ui/layout'
import { EmptyState } from '@/components/ui/feedback'

/**
 * Add skills to my AI. The backend has no skill catalogue, package format or runtime yet
 * (proposed: GET /skills, POST /skills/{id}/install, DELETE /skills/{id}), so nothing is listed.
 */
export function SkillsView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Add skills to my AI" description="A skill is an extra ability, like reading spreadsheets or translating, that runs on this computer." />
      <PageBody>
        <EmptyState
          icon={<Puzzle />}
          title="No skills to add yet"
          description="Skills come in a later version of AIOS. When they do, the ones you can add are listed here, each with what it may use before you add it."
        />
      </PageBody>
    </div>
  )
}
