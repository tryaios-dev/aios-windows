import { Link } from 'react-router'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/feedback'

/** The one notice for the switch from the graphics card to the processor, shared by chat, AI models and Settings (AC-09, D-06). */
export function FallbackNotice({ className }: { className?: string }) {
  const fallback = useStore((s) => s.fallbackNotice)
  const compatibilityMode = useStore((s) => s.settings.safe_mode_cpu)
  if (!fallback || fallback.dismissed) return null
  return (
    <Callout
      tone="caution"
      className={className}
      title="AIOS switched to a slower, more reliable mode."
      action={
        <div className="flex items-center gap-2">
          {!compatibilityMode && (
            <Button size="sm" variant="outline" onClick={() => { api.settings.update({ safe_mode_cpu: true }); api.system.dismissFallbackNotice() }}>
              Turn on Compatibility mode
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => api.system.dismissFallbackNotice()}>Dismiss</Button>
        </div>
      }
    >
      Your graphics card stopped responding, so AIOS is using your processor. Answers are slower until you restart AIOS.
      {!compatibilityMode && (
        <>
          {' '}If it keeps happening, turn on{' '}
          <Link to="/settings/computer" className="font-medium text-ink underline decoration-ink-30 underline-offset-2 hover:decoration-ink">
            Compatibility mode
          </Link>
          .
        </>
      )}
    </Callout>
  )
}
