import { Cloud, Lock } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/ui/layout'
import { EmptyState } from '@/components/ui/feedback'

/**
 * Add resources to my AI. The backend has no resource catalogue, prices, linking or consent step yet
 * (proposed: GET /resources, POST /resources/{id}/link, DELETE /resources/{id}/link), so nothing is listed.
 */
export function ResourcesView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Add resources to my AI" description="Some jobs need more power than this computer has. You can borrow it when you need it, and you only pay for what you use.">
        <p className="flex items-center gap-2.5 pb-3.5 text-sm font-medium leading-5 text-ink">
          <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green text-white">
            <Lock className="size-3" strokeWidth={2.25} />
          </span>
          Nothing leaves this computer unless you say so.
        </p>
      </PageHeader>
      <PageBody>
        <EmptyState
          icon={<Cloud />}
          title="No resources to add yet"
          description="Resources come in a later version of AIOS. When they do, each one is listed here with its price, and nothing is sent until you agree."
        />
      </PageBody>
    </div>
  )
}
