import { useStore } from '@/lib/store'
import { ToastCard } from '@/components/ui/feedback'

export function Toaster() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-16 right-4 z-[70] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} kind={t.kind} title={t.title} description={t.description} action={t.action} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  )
}
