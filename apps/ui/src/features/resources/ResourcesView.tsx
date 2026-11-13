import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Lock } from 'lucide-react'
import { api } from '@/lib/api'
import { useExtras } from '@/lib/extras'
import type { ResourceEntry } from '@/lib/types'
import { RESOURCES } from '@/data/resources'
import { PageBody, PageHeader } from '@/components/ui/layout'
import { SectionHeading } from '@/features/skills/shared'
import { useSubject } from '@/features/skills/useSubject'
import { Guide } from './Guide'
import { LinkDialog, UnlinkDialog } from './LinkDialog'
import { LinkedPanel } from './LinkedPanel'
import { ResourceGroup } from './ResourceList'

const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1]

const MODELS = RESOURCES.filter((r) => r.kind === 'model')
const COMPUTE = RESOURCES.filter((r) => r.kind === 'compute')

/**
 * Add resources to my AI. The page starts from the job: the guide works out
 * whether this computer can already do it and, only if it cannot, what to
 * add. Below it is everything that can be linked, with the provider's usual
 * price beside the AIOS price. Linking sends nothing, and the dialog that
 * links a resource shows the question AIOS will ask before anything leaves.
 */
export function ResourcesView() {
  const linked = useExtras((s) => s.linkedResources)
  const linkedIds = useMemo(() => new Set(linked.map((l) => l.id)), [linked])
  // Linked on this visit: their ticks draw themselves. Ticks for older links are already there.
  const [linkedHere, setLinkedHere] = useState<ReadonlySet<string>>(() => new Set())
  const linking = useSubject<ResourceEntry>()
  const unlinking = useSubject<ResourceEntry>()

  const link = (resource: ResourceEntry, monthlyLimit: number | null) => {
    setLinkedHere((prev) => new Set(prev).add(resource.id))
    api.resources.link(resource.id, monthlyLimit)
    linking.setOpen(false)
  }

  const unlink = () => {
    if (unlinking.subject) api.resources.unlink(unlinking.subject.id)
    unlinking.setOpen(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Add resources to my AI" description="Some jobs need more power than this computer has. You can borrow it when you need it, and you only pay for what you use.">
        {/* The promise stays in view while the prices scroll beneath it. */}
        <p className="flex items-center gap-2.5 pb-3.5 text-sm font-medium leading-5 text-ink">
          <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green text-white">
            <Lock className="size-3" strokeWidth={2.25} />
          </span>
          Nothing leaves this computer unless you say so.
        </p>
      </PageHeader>

      <PageBody>
        <div className="pb-6">
          <Guide linkedIds={linkedIds} linkedHere={linkedHere} onLink={linking.show} />

          {/* Appears when the first resource is linked, and goes when the last is unlinked. */}
          <AnimatePresence initial={false}>
            {linked.length > 0 && (
              <motion.div
                key="linked"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="-mx-3 -mb-6 overflow-hidden px-3 pb-6"
              >
                <div className="pt-10">
                  <LinkedPanel linked={linked} onUnlink={unlinking.show} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <section aria-labelledby="resources-all" className="mt-10">
            <SectionHeading id="resources-all" title="Everything you can add" right={`${RESOURCES.length} resources`}>
              The crossed-out figure is the provider’s usual price. The figure beside it is what you pay through AIOS.
            </SectionHeading>
            <div className="mt-4 flex flex-col gap-4">
              <ResourceGroup
                id="resources-models"
                title="AI models in the cloud"
                description="Larger AI models than this computer can hold. What you ask goes to the provider and the answer comes back."
                resources={MODELS}
                linkedIds={linkedIds}
                linkedHere={linkedHere}
                onLink={linking.show}
              />
              <ResourceGroup
                id="resources-compute"
                title="Computing power by the hour"
                description="A rented computer with a large graphics card, for work this one cannot hold. You pay for the hours it runs."
                resources={COMPUTE}
                linkedIds={linkedIds}
                linkedHere={linkedHere}
                onLink={linking.show}
              />
            </div>
          </section>
        </div>
      </PageBody>

      <LinkDialog key={linking.run} open={linking.open} onOpenChange={linking.setOpen} resource={linking.subject} onLink={link} />
      <UnlinkDialog open={unlinking.open} onOpenChange={unlinking.setOpen} resource={unlinking.subject} onConfirm={unlink} />
    </div>
  )
}
